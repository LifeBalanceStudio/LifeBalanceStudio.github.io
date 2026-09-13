export const SEOUL_WEATHER_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=37.5665&lon=126.9780';
export const WEATHER_REFRESH_MS = 60 * 60 * 1000;
export const WEATHER_MAX_AGE_MS = 12 * WEATHER_REFRESH_MS;
export const WEATHER_CACHE_KEY = 'lifebalance.seoul-weather.v1';
export const DEFAULT_WEATHER = Object.freeze({ cloudCover: 0.25, windSpeed: 1, windFromDegrees: 270, precipitationRate: 0, precipitationHours: null, condition: 'unknown', label: '날씨 확인 중', validAt: null, updatedAt: null, source: 'fallback' });

const boundedNumber = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

export function weatherEndpoint(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) ? '/api/seoul-weather' : SEOUL_WEATHER_URL;
}

export function parseSeoulForecast(payload, now = Date.now()) {
  const properties = payload?.properties;
  const updatedAt = Date.parse(properties?.meta?.updated_at);
  if (!Number.isFinite(now) || !Number.isFinite(updatedAt) || updatedAt > now + 15 * 60000 || now - updatedAt > WEATHER_MAX_AGE_MS) return null;
  const units = properties?.meta?.units;
  if (units?.cloud_area_fraction !== '%' || units?.wind_speed !== 'm/s' || units?.wind_from_direction !== 'degrees') return null;
  if (!Array.isArray(properties.timeseries)) return null;
  let entry = null, validAt = -Infinity;
  for (const candidate of properties.timeseries.slice(0, 256)) {
    const time = Date.parse(candidate?.time);
    if (time <= now + 5 * 60000 && time > validAt) { entry = candidate; validAt = time; }
  }
  if (!entry || now - validAt > 90 * 60000) return null;
  const details = entry.data?.instant?.details;
  if (!boundedNumber(details?.cloud_area_fraction, 0, 100) || !boundedNumber(details?.wind_speed, 0, 100) || !boundedNumber(details?.wind_from_direction, 0, 360)) return null;
  const cloudCover = details.cloud_area_fraction / 100;
  const symbol = String(entry.data.next_1_hours?.summary?.symbol_code || entry.data.next_6_hours?.summary?.symbol_code || '').slice(0, 80);
  let condition, label;
  if (symbol.includes('thunder')) { condition = 'storm'; label = '뇌우'; }
  else if (symbol.includes('sleet')) { condition = 'sleet'; label = '진눈깨비'; }
  else if (symbol.includes('snow')) { condition = 'snow'; label = '눈'; }
  else if (symbol.includes('rain')) { condition = 'rain'; label = '비'; }
  else if (symbol.includes('fog')) { condition = 'fog'; label = '안개'; }
  else if (cloudCover >= 0.85) { condition = 'overcast'; label = '흐림'; }
  else if (cloudCover >= 0.45) { condition = 'cloudy'; label = '구름 많음'; }
  else if (cloudCover >= 0.1) { condition = 'fair'; label = '구름 조금'; }
  else { condition = 'clear'; label = '맑음'; }
  let precipitationRate = null, precipitationHours = null;
  if (units?.precipitation_amount === 'mm') {
    for (const hours of [1, 6]) {
      const amount = entry.data?.[`next_${hours}_hours`]?.details?.precipitation_amount;
      if (boundedNumber(amount, 0, 300)) { precipitationRate = amount / hours; precipitationHours = hours; break; }
    }
  }
  return { cloudCover, windSpeed: details.wind_speed, windFromDegrees: details.wind_from_direction,
    precipitationRate, precipitationHours, condition, label, validAt, updatedAt };
}

export function createSeoulWeather({ onChange, storage = null, fetcher = globalThis.fetch, now = Date.now, url = weatherEndpoint(globalThis.location?.hostname) } = {}) {
  let cached = null, pending = null;
  let retryAt = 0;
  let state = { ...DEFAULT_WEATHER };
  try {
    const saved = JSON.parse(storage?.getItem(WEATHER_CACHE_KEY) || 'null');
    if (boundedNumber(saved?.fetchedAt, 0, now() + 5 * 60000) && parseSeoulForecast(saved.payload, now())) cached = saved;
  } catch { /* 저장이 제한되거나 손상된 자료이면 새 예보를 받는다. */ }

  function publish(source) {
    const weather = cached && parseSeoulForecast(cached.payload, now());
    state = weather ? { ...weather, source } : { ...DEFAULT_WEATHER, label: '날씨 연결 대기' };
    onChange?.(state);
    return state;
  }
  if (cached) publish('stored');
  else onChange?.(state);

  async function refresh(force = false) {
    if (pending) return pending;
    if (now() < retryAt) return publish('stored');
    if (!force && cached && now() - cached.fetchedAt < WEATHER_REFRESH_MS) return publish('stored');
    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        // 공개 예보만 요청한다. 방문자의 위치 권한이나 인증 정보는 보내지 않는다.
        const response = await fetcher(url, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) {
          if ([403, 429].includes(response.status)) retryAt = now() + WEATHER_REFRESH_MS;
          throw new Error('날씨 응답 ' + response.status);
        }
        const payload = await response.json();
        if (!parseSeoulForecast(payload, now())) throw new Error('유효한 서울 예보가 없음');
        cached = { fetchedAt: now(), payload };
        retryAt = 0;
        try { storage?.setItem(WEATHER_CACHE_KEY, JSON.stringify(cached)); } catch { /* 저장 실패와 현재 표시를 분리한다. */ }
        return publish(response.headers?.get?.('x-weather-source') === 'stored' ? 'stored' : 'live');
      } catch {
        retryAt = Math.max(retryAt, now() + 60000);
        return publish('stored');
      } finally { clearTimeout(timeout); }
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { refresh, get state() { return state; } };
}
