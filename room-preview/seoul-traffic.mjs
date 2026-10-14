const HOUR = 3600000;
export const TRAFFIC_REFRESH_MS = 30 * 60000;
export const TRAFFIC_CACHE_KEY = 'lifebalance.seoul-traffic.v1';
export const TRAFFIC_MAX_AGE_MS = 2 * HOUR;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function rushHour(now = Date.now()) {
  const local = new Date(now + 9 * HOUR);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
  // 사용자가 관찰한 시간의 앞뒤 한 시간 동안 부드럽게 증가·감소한다.
  const window = (start, end) => smooth((minutes - start + 60) / 60) * (1 - smooth((minutes - end) / 60));
  return { morning: window(510, 600), evening: window(990, 1230) };
}

export function completedSeoulHour(now = Date.now()) {
  const end = Math.floor(now / HOUR) * HOUR;
  const local = new Date(end - HOUR + 9 * HOUR).toISOString();
  return { ymd: local.slice(0, 10).replaceAll('-', ''), hh: local.slice(11, 13), periodEnd: end };
}

export function scheduledTraffic(now = Date.now()) {
  const local = new Date(now + 9 * HOUR), minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  // 통계 예측이 아닌 장면 연출용 패턴이다. 공휴일은 별도로 판별하지 않는다.
  const count = 1 + 2 * smooth((minutes - 300) / 180) * (1 - smooth((minutes - 1260) / 120));
  const { morning, evening } = rushHour(now), rush = Math.max(morning, evening);
  return { bridge: Math.round(count + (8 - count) * rush), road: Math.round(count + (12 - count) * rush),
    morning, evening, rush, source: 'schedule', periodEnd: null };
}

export function validTraffic(payload, now = Date.now()) {
  return payload?.station === 'C-19' && Number.isInteger(payload.volume) && payload.volume >= 0 && payload.volume <= 30000
    && Number.isInteger(payload.periodEnd) && payload.periodEnd % HOUR === 0
    && payload.periodEnd <= now && now - payload.periodEnd <= TRAFFIC_MAX_AGE_MS;
}

export function trafficState(payload, now = Date.now(), source = 'stored') {
  const state = scheduledTraffic(now);
  if (!validTraffic(payload, now)) return state;
  // 통행 대수를 세 단계의 등장량으로 압축한다. 속도나 정체 수준을 추정하지 않는다.
  const base = payload.volume < 1500 ? 1 : payload.volume < 4500 ? 2 : 3;
  return { ...state, bridge: Math.round(base + (8 - base) * state.rush),
    source, periodEnd: payload.periodEnd };
}

export function trafficEndpoint(location = globalThis.location, document = globalThis.document) {
  const configured = document?.querySelector('meta[name="seoul-traffic-endpoint"]')?.content?.trim();
  if (configured) {
    try { const url = new URL(configured, location?.href); if (url.protocol === 'https:') return url.href; } catch { /* 잘못된 설정이면 시간대 연출을 사용한다. */ }
  }
  return ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname) ? '/api/seoul-traffic' : null;
}

export function createSeoulTraffic({ fetcher = globalThis.fetch, storage = null, now = Date.now,
  url = trafficEndpoint(), onChange, timeoutMs = 5000 } = {}) {
  let cached = null, pending = null, nextAt = 0, failures = 0, disabled = !url, source = 'stored';
  try {
    const saved = JSON.parse(storage?.getItem(TRAFFIC_CACHE_KEY) || 'null');
    if (validTraffic(saved, now())) cached = saved;
  } catch { /* 손상되거나 사용할 수 없는 저장소는 건너뛴다. */ }
  let state;
  function publish() {
    const next = trafficState(cached, now(), source);
    if (!state || Object.keys(next).some(key => next[key] !== state[key])) { state = next; onChange?.(state); }
    return state;
  }
  publish();
  async function refresh() {
    publish();
    if (pending) return pending;
    if (disabled || now() < nextAt) return state;
    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 429) {
            const retry = response.headers?.get?.('retry-after');
            const until = /^\d+$/.test(retry || '') ? now() + Number(retry) * 1000 : Date.parse(retry);
            nextAt = Number.isFinite(until) ? Math.max(now() + TRAFFIC_REFRESH_MS, until) : now() + HOUR;
          }
          throw new Error('교통 자료 응답 오류');
        }
        const payload = await response.json();
        const retryAt = Number.isFinite(payload.retryAt) ? payload.retryAt : 0;
        if (['unconfigured', 'auth'].includes(payload.reason)) disabled = true;
        if (payload.source === 'schedule') {
          source = 'stored';
          nextAt = Math.max(now() + 5 * 60000, retryAt);
        } else {
          if (!['live', 'stored'].includes(payload.source) || !validTraffic(payload.data, now())) throw new Error('유효한 교통 자료가 없음');
          cached = { station: 'C-19', volume: payload.data.volume, periodEnd: payload.data.periodEnd };
          source = payload.source;
          failures = 0;
          nextAt = Math.max(now() + 60000, retryAt || now() + TRAFFIC_REFRESH_MS);
          try { storage?.setItem(TRAFFIC_CACHE_KEY, JSON.stringify(cached)); } catch { /* 저장 실패와 화면 동작은 분리한다. */ }
        }
      } catch {
        source = 'stored';
        nextAt = Math.max(nextAt, now() + [5, 15, 30][Math.min(failures++, 2)] * 60000);
      } finally { clearTimeout(timeout); }
      return publish();
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { refresh, get state() { return state; } };
}
