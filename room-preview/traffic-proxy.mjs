import { completedSeoulHour, validTraffic, TRAFFIC_REFRESH_MS } from './seoul-traffic.mjs';

function trafficError(code) { const error = new Error('교통 자료를 사용할 수 없습니다.'); error.code = code; return error; }

export function parseTrafficXml(xml, period) {
  // 공급자의 숫자 전용 스키마만 읽는다. 엔티티·DTD와 중복 필드는 허용하지 않는다.
  if (typeof xml !== 'string' || xml.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw trafficError('invalid');
  const field = (body, tag) => {
    const matches = [...body.matchAll(new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'g'))];
    if (matches.length !== 1) throw trafficError('invalid');
    return matches[0][1].trim();
  };
  const code = field(xml, 'CODE');
  if (code !== 'INFO-000') throw trafficError(code === 'INFO-100' ? 'auth' : 'unavailable');
  if (!/^\s*(?:<\?xml[^?]*\?>)?\s*<VolInfo>[\s\S]*<\/VolInfo>\s*$/.test(xml)) throw trafficError('invalid');
  const rows = [...xml.matchAll(/<row>([\s\S]*?)<\/row>/g)];
  // C-19는 양방향 각각 3개 차로를 모두 받아야 한다. 샘플 5행과 일부 차로 누락은 합산하지 않는다.
  const lanes = new Set(['1:1', '1:2', '1:3', '2:1', '2:2', '2:3']);
  if (field(xml, 'list_total_count') !== '6' || rows.length !== 6) throw trafficError('incomplete');
  let volume = 0;
  for (const [, row] of rows) {
    if (field(row, 'spot_num') !== 'C-19' || field(row, 'ymd') !== period.ymd || field(row, 'hh').padStart(2, '0') !== period.hh) throw trafficError('mismatch');
    if (!lanes.delete(field(row, 'io_type') + ':' + field(row, 'lane_num'))) throw trafficError('incomplete');
    const count = field(row, 'vol');
    if (!/^\d+$/.test(count) || Number(count) > 5000) throw trafficError('invalid');
    volume += Number(count);
  }
  return { station: 'C-19', volume, periodEnd: period.periodEnd };
}

export function createTrafficProxy({ key = '', fetcher = globalThis.fetch, now = Date.now, timeoutMs = 4500 } = {}) {
  key = key.trim();
  let cached = null, pending = null, nextAt = 0, failures = 0;
  let reason = key && key !== 'sample' ? null : 'unconfigured';
  function result(source = 'stored') {
    return validTraffic(cached, now()) ? { source, data: cached, retryAt: nextAt, reason }
      : { source: 'schedule', reason: reason || 'unavailable', retryAt: nextAt };
  }
  async function getTraffic() {
    if (reason === 'unconfigured' || reason === 'auth') return result();
    if (pending) return pending;
    if (now() < nextAt) return result(reason ? 'stored' : 'live');
    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const period = completedSeoulHour(now());
        // 인증키는 서버 환경 변수에만 둔다. 요청 URL이나 원본 오류를 응답·로그에 노출하지 않는다.
        const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/xml/VolInfo/1/100/C-19/${period.ymd}/${period.hh}/`;
        const response = await fetcher(url, { signal: controller.signal });
        if (!response.ok) {
          if (response.status === 429) {
            const retry = response.headers?.get?.('retry-after');
            const until = /^\d+$/.test(retry || '') ? now() + Number(retry) * 1000 : Date.parse(retry);
            nextAt = Number.isFinite(until) ? Math.max(now() + TRAFFIC_REFRESH_MS, until) : now() + 3600000;
          }
          if ([401, 403].includes(response.status)) throw trafficError('auth');
          throw trafficError('unavailable');
        }
        const data = parseTrafficXml(await response.text(), period);
        if (!validTraffic(data, now())) throw trafficError('stale');
        cached = data;
        failures = 0; reason = null; nextAt = now() + TRAFFIC_REFRESH_MS;
        return result('live');
      } catch (error) {
        reason = error.code === 'auth' ? 'auth' : 'unavailable';
        nextAt = Math.max(nextAt, now() + [5, 15, 30][Math.min(failures++, 2)] * 60000);
        return result();
      } finally { clearTimeout(timeout); }
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { getTraffic };
}
