import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/completion-2026-09-12');
const origin = 'https://lifebalancestudio.github.io';
const manifest = new Set(JSON.parse(fs.readFileSync(path.join(output, 'DEPLOY_FILES.json'), 'utf8')).files.map(item => item.file));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const apiRequests = [], errors = [], weather = [];
  page.on('request', request => { if (request.url().startsWith(origin + '/api/')) apiRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith('https://api.met.no/weatherapi/locationforecast/')) weather.push({ status: response.status(), cors: response.headers()['access-control-allow-origin'] || null });
  });
  // 공개 사이트에는 쓰지 않는다. 이 독립 브라우저에서만 로컬 파일을 HTTPS 정적 응답으로 대체한다.
  await page.route(origin + '/**', route => {
    let relative = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    if (!manifest.has(relative)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: types[path.extname(relative)] || 'application/octet-stream', body: fs.readFileSync(path.join(root, relative)) });
  });
  await page.goto(origin + '/room-preview/?review=1');
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled);
  await page.waitForFunction(() => !document.querySelector('#weather-description')?.textContent.includes('날씨 확인 중'), null, { timeout: 12000 });
  const report = { checkedAt: new Date().toISOString(), roomReady: await page.locator('#enter-button').innerText() === '방 둘러보기',
    weather, weatherLabel: await page.locator('#weather-description').innerText(), trafficLabel: await page.locator('#traffic-description').innerText(),
    localApiRequests: apiRequests, reviewVisible: await page.locator('#environment-review').count() > 0, errors,
    scope: '로컬 정적 파일을 독립 브라우저의 Pages HTTPS 출처로 응답시킨 검사. 실제 사이트 배포는 하지 않았으며 MET 예보 요청만 실제 공개 API를 사용.' };
  fs.writeFileSync(path.join(output, 'static-origin-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.roomReady || errors.length || apiRequests.length || report.reviewVisible) process.exitCode = 1;
} finally { await browser.close(); }
