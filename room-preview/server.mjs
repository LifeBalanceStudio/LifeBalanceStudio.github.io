import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEOUL_WEATHER_URL, parseSeoulForecast } from './seoul-weather.mjs';
import { createTrafficProxy } from './traffic-proxy.mjs';

const previewRoot = path.dirname(fileURLToPath(import.meta.url));
const fullSite = process.env.ROOM_SITE_ROOT === '1';
const root = fullSite ? path.dirname(previewRoot) : previewRoot;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
let forecast = null, weatherRequest = null;
let weatherRetryAt = 0;
const traffic = createTrafficProxy({ key: process.env.SEOUL_TRAFFIC_API_KEY || '' });

async function seoulWeather() {
  const now = Date.now();
  if (forecast && now < forecast.expiresAt) return { payload: forecast.payload, stored: Boolean(forecast.stored) };
  if (weatherRequest) return weatherRequest;
  if (now < weatherRetryAt) throw new Error('날씨 재시도 대기');
  weatherRequest = (async () => {
    const headers = { 'User-Agent': 'LifeBalanceStudioRoom/1.34 https://lifebalancestudio.github.io/' };
    if (forecast?.lastModified) headers['If-Modified-Since'] = forecast.lastModified;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(SEOUL_WEATHER_URL, { headers, signal: controller.signal });
      if (response.status !== 304 && !response.ok) throw new Error('날씨 응답 ' + response.status);
      const payload = response.status === 304 ? forecast?.payload : await response.json();
      if (!parseSeoulForecast(payload, now)) throw new Error('사용 가능한 서울 예보가 없음');
      const expires = Date.parse(response.headers.get('expires'));
      forecast = { payload, expiresAt: Number.isFinite(expires) ? Math.max(now + 60000, expires) : now + 3600000, lastModified: response.headers.get('last-modified') || forecast?.lastModified, stored: false };
      weatherRetryAt = 0;
      return { payload, stored: false };
    } catch (error) {
      weatherRetryAt = now + 15 * 60000;
      if (forecast && parseSeoulForecast(forecast.payload, now)) {
        forecast.expiresAt = weatherRetryAt;
        forecast.stored = true;
        return { payload: forecast.payload, stored: true };
      }
      throw error;
    } finally { clearTimeout(timeout); }
  })();
  try { return await weatherRequest; } finally { weatherRequest = null; }
}

const server = http.createServer((request, response) => {
  let relative;
  try { relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  if (relative === '/api/seoul-traffic') {
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
    traffic.getTraffic().then(payload => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(payload));
    }).catch(() => { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); });
    return;
  }
  if (relative === '/api/seoul-weather') {
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
    // 로컬 개발 요청은 서버에서 식별자를 붙이고 공급자의 만료 시각까지 재사용한다.
    seoulWeather().then(({ payload, stored }) => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Weather-Source': stored ? 'stored' : 'live' });
      response.end(JSON.stringify(payload));
    }).catch(() => { response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ message: '날씨를 불러오지 못했습니다.' })); });
    return;
  }
  const segments = relative.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.') || segment === 'node_modules') || /\\/.test(relative)) {
    response.writeHead(403).end(); return;
  }
  if (relative.endsWith('/')) relative += 'index.html';
  const target = path.resolve(root, '.' + relative);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.stat(target, (error, stat) => {
    if (!error && stat.isDirectory()) { response.writeHead(301, { Location: relative + '/' }).end(); return; }
    if (error || !stat.isFile()) { response.writeHead(404).end('파일을 찾을 수 없습니다.'); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': stat.size });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(target).pipe(response);
  });
});
const port = Number(process.env.ROOM_PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  const info = { pid: process.pid, url: `http://127.0.0.1:${server.address().port}/` };
  fs.writeFileSync(path.join(previewRoot, fullSite ? '.server-site.json' : '.server.json'), JSON.stringify(info));
  console.log(`방 미리보기: ${info.url}`);
});
