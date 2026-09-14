import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/movement-timing-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const results = [];
const capture = `
  const originalLoopSetter = renderer.setAnimationLoop.bind(renderer);
  renderer.setAnimationLoop = callback => {
    if (callback) globalThis.__movementStep = callback;
    originalLoopSetter(callback);
  };`;
const hook = `
globalThis.__movementQA = {
  get state() { return { mode, keys: keys.size, position: camera.position.toArray(), previousTime }; },
  stop() { renderer.setAnimationLoop(null); },
  reset() {
    setMode('explore');
    camera.position.set(START.x, START.y, START.z);
    yaw = START.yaw; pitch = START.pitch; camera.rotation.set(pitch, yaw, 0, 'YXZ');
    lowPower = false; nextRenderAt = previousTime; canvas.focus();
    setFpsLimit(120);
  },
  step(ms) { globalThis.__movementStep(previousTime + ms); },
  tickNow(ms) { globalThis.__movementStep(performance.now() + ms); },
  ageClock(ms) { previousTime = performance.now() - ms; },
  collisionFree() { return obstacles.every(obstacle => collisionPush(camera.position, obstacle, 0.179) === null); }
};`;
let source = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8');
const marker = '  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });';
assert.ok(source.includes(marker));
source = "import { collisionPush } from './world.mjs';\n" + source.replace(marker, marker + capture) + hook;

try {
  for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
    const row = { browser: name, version: browser.version(), distances: [], checks: [], errors: [], passed: false };
    results.push(row);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => row.errors.push(error.message));
      await page.addInitScript(() => Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { configurable: true, value: undefined }));
      await page.route('**/api/seoul-weather', route => route.abort());
      await page.route('https://api.met.no/**', route => route.abort());
      await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: source }));
      await page.goto(new URL('room-preview/?review=1&render=original', base).href);
      await page.waitForFunction(() => globalThis.__movementQA?.state.mode === 'ready', null, { timeout: 45000 });
      await page.evaluate(() => globalThis.__movementQA.stop());

      for (const fps of [1, 3, 5, 10, 15, 30, 60, 120]) {
        await page.evaluate(() => globalThis.__movementQA.reset());
        await page.keyboard.down('w');
        const result = await page.evaluate(fps => {
          const qa = globalThis.__movementQA, start = qa.state.position;
          for (let i = 0; i < fps; i++) qa.step(1000 / fps);
          return { distance: start[2] - qa.state.position[2], collisionFree: qa.collisionFree() };
        }, fps);
        await page.keyboard.up('w');
        assert.ok(Math.abs(result.distance - 1.45) < 1e-6, name + ': ' + fps + 'FPS');
        assert.equal(result.collisionFree, true);
        row.distances.push({ fps, meters: result.distance });
      }
      row.checks.push('실제 앱의 키보드 입력과 렌더 루프에 1~120FPS 간격을 주입했을 때 1초간 1.45m 이동한다');
      await page.evaluate(() => globalThis.__movementQA.reset());
      await page.keyboard.down('w');
      await page.evaluate(() => { for (let i = 0; i < 25; i++) globalThis.__movementQA.step(200); });
      await page.keyboard.up('w');
      const end = await page.evaluate(() => ({ ...globalThis.__movementQA.state, collisionFree: globalThis.__movementQA.collisionFree() }));
      assert.ok(end.position[2] >= -1.621);
      assert.equal(end.collisionFree, true);
      row.checks.push('5FPS에서 계속 걸어도 실제 방의 충돌체와 방 경계를 통과하지 않는다');
      await page.evaluate(() => globalThis.__movementQA.reset());
      await page.keyboard.down('w');
      const beforeStall = await page.evaluate(() => globalThis.__movementQA.state.position);
      await page.evaluate(() => globalThis.__movementQA.step(60000));
      assert.deepEqual(await page.evaluate(() => globalThis.__movementQA.state.position), beforeStall);
      await page.keyboard.up('w');
      row.checks.push('5초를 넘는 비정상 시간 간격은 한 번에 이동하지 않는다');

      for (const kind of ['일시정지', '탭 숨김', '창 포커스 이탈']) {
        await page.evaluate(() => globalThis.__movementQA.reset());
        await page.keyboard.down('w');
        await page.evaluate(() => globalThis.__movementQA.step(100));
        if (kind === '일시정지') await page.keyboard.press('Escape');
        else await page.evaluate(kind => {
          if (kind === '탭 숨김') {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
          } else dispatchEvent(new Event('blur'));
        }, kind);
        assert.equal(await page.evaluate(() => globalThis.__movementQA.state.mode), 'paused');
        assert.equal(await page.evaluate(() => globalThis.__movementQA.state.keys), 0);
        await page.keyboard.up('w');
        if (kind === '탭 숨김') await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        // 렌더가 쉬는 동안 지난 시간을 조작 재개 직전의 오래된 기준으로 주입한다.
        await page.evaluate(() => globalThis.__movementQA.ageClock(3000));
        const before = await page.evaluate(() => globalThis.__movementQA.state.position);
        await page.click('#resume-button');
        assert.deepEqual(await page.evaluate(() => globalThis.__movementQA.state.position), before);
        assert.equal(await page.evaluate(() => globalThis.__movementQA.state.keys), 0);
        await page.keyboard.down('w');
        const moved = await page.evaluate(() => {
          const qa = globalThis.__movementQA, before = qa.state.position;
          qa.tickNow(16);
          return before[2] - qa.state.position[2];
        });
        await page.keyboard.up('w');
        assert.ok(moved > 0 && moved < 0.25, kind);
        row.checks.push(kind + ' 뒤에는 키 입력과 시간 기준을 새로 시작해 갑자기 이동하지 않는다');
      }
      assert.deepEqual(row.errors, []);
      row.passed = true;
    } catch (error) { row.failure = error.stack; throw error; }
    finally {
      await browser.close();
      fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2));
    }
  }
  console.log(JSON.stringify(results));
} catch (error) { console.error(error); process.exitCode = 1; }
