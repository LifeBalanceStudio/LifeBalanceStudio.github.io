import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/loading-progress-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const room = fs.readFileSync(path.join(root, 'room-preview/assets/room.glb'));
const compressed = gzipSync(room), truncated = gzipSync(room.subarray(0, room.length - 128));
const results = [];
let variant = 'gzip';

// 실제 HTTP 압축·청크 응답을 만들고 나머지 파일만 로컬 검사 서버에서 제공한다.
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/room-preview/assets/room.glb') {
    const payload = variant === 'identity' ? room : variant === 'truncated' ? truncated : compressed;
    const headers = { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store' };
    if (variant !== 'identity') headers['Content-Encoding'] = 'gzip';
    if (variant !== 'chunked') headers['Content-Length'] = payload.length;
    response.writeHead(200, headers);
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= payload.length) { clearInterval(timer); response.end(); return; }
      response.write(payload.subarray(offset, offset + 32768)); offset += 32768;
    }, 4);
    response.on('close', () => clearInterval(timer));
    return;
  }
  const target = new URL(url.pathname + url.search, base);
  const upstream = http.request(target, { method: request.method }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(502); response.end(); });
  request.pipe(upstream);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
    const row = { browser: name, version: browser.version(), cases: [], errors: [], passed: false };
    results.push(row);
    try {
      for (const encoding of ['identity', 'gzip', 'chunked', 'truncated']) {
        variant = encoding;
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        page.on('pageerror', error => row.errors.push(error.message));
        await page.addInitScript(() => {
          globalThis.__loadingStates = [];
          addEventListener('DOMContentLoaded', () => {
            const description = document.querySelector('#entry-description');
            const capture = () => globalThis.__loadingStates.push({ text: description.textContent, disabled: document.querySelector('#enter-button').disabled });
            new MutationObserver(capture).observe(description, { childList: true, characterData: true, subtree: true });
            capture();
          });
        });
        await page.route('**/api/seoul-weather', route => route.abort());
        await page.route('https://api.met.no/**', route => route.abort());
        const modelResponse = page.waitForResponse(response => response.url().endsWith('/assets/room.glb'));
        await page.goto(origin + '/room-preview/?render=original', { waitUntil: 'domcontentloaded' });
        const headers = await (await modelResponse).allHeaders();
        await page.waitForFunction(() => ['방 둘러보기', '새로고침'].includes(document.querySelector('#enter-button').textContent), null, { timeout: 45000 });
        const states = await page.evaluate(() => globalThis.__loadingStates);
        const percentages = states.map(state => state.text.match(/다운로드 (\d+)%/)).filter(Boolean).map(match => Number(match[1]));
        assert.ok(percentages.length > 0);
        assert.ok(percentages.every(value => value >= 0 && value <= 100));
        if (encoding === 'truncated') {
          assert.equal(await page.locator('#enter-button').textContent(), '새로고침');
          assert.ok(Math.max(...percentages) < 100);
        } else {
          assert.equal(await page.locator('#enter-button').textContent(), '방 둘러보기');
          assert.equal(Math.max(...percentages), 100);
          assert.ok(states.some(state => state.text === '모델과 텍스처를 준비하는 중…' && state.disabled));
        }
        row.cases.push({ encoding, contentLength: headers['content-length'] || null, contentEncoding: headers['content-encoding'] || null,
          maxPercent: Math.max(...percentages), stages: states, passed: true });
        await page.close();
      }
      assert.deepEqual(row.errors, []); row.passed = true;
    } catch (error) { row.failure = error.stack; throw error; }
    finally { await browser.close(); fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2)); }
  }
  console.log(JSON.stringify(results.map(row => ({ browser: row.browser, passed: row.passed, cases: row.cases.map(({ stages, ...rest }) => rest), errors: row.errors }))));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
