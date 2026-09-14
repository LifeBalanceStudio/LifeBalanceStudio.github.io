import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/fps-limit-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
fs.mkdirSync(output, { recursive: true });
const results = [];
const marker = '  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });';
const capture = `
  const originalLoop = renderer.setAnimationLoop.bind(renderer);
  renderer.setAnimationLoop = callback => { if (callback) globalThis.__fpsStep = callback; originalLoop(callback); };`;
const hook = `
globalThis.__fpsQA = {
  get ready() { return mode === 'ready'; },
  stop() {
    renderer.setAnimationLoop(null);
    this.originalRender = texelSplat.render; this.originalOutline = interactionOutline.render;
    texelSplat.render = () => {}; interactionOutline.render = () => {};
  },
  simulate(hz, seconds, nextMode = 'explore') {
    setMode(nextMode);
    const start = performance.now(); previousTime = start; nextRenderAt = start;
    globalThis.__fpsCount = 0;
    for (let i = 1; i <= hz * seconds; i++) globalThis.__fpsStep(start + i * 1000 / hz);
    return globalThis.__fpsCount / seconds;
  },
  gap() {
    setMode('explore'); globalThis.__fpsCount = 0;
    const time = performance.now() + 60000;
    for (let i = 0; i < 20; i++) globalThis.__fpsStep(time);
    return globalThis.__fpsCount;
  },
  resume() {
    texelSplat.render = this.originalRender; interactionOutline.render = this.originalOutline;
    setMode('explore'); renderer.setAnimationLoop(globalThis.__fpsStep);
  }
};`;
let source = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8');
assert.ok(source.includes(marker));
source = 'globalThis.__fpsCount = 0;\n' + source.replace(marker, marker + capture)
  .replace('    const frameMs = Math.max(0, time - previousTime);', '    globalThis.__fpsCount++;\n    const frameMs = Math.max(0, time - previousTime);') + hook;

async function choose(page, value) {
  await page.locator('#fps-limit').evaluate((input, value) => {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

try {
  for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
    const row = { browser: name, version: browser.version(), checks: [], rates: [], errors: [], passed: false };
    results.push(row);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => row.errors.push(error.message));
      await page.addInitScript(() => {
        const key = 'lifebalance.room.preferences.v1';
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ mouseSensitivity: 0.75, audio: { enabled: false, master: 0.42, effects: 0.55, ambience: 0.22 } }));
        Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { configurable: true, value: undefined });
      });
      await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: source }));
      await page.route('**/api/seoul-weather', route => route.abort());
      await page.route('https://api.met.no/**', route => route.abort());
      await page.goto(new URL('room-preview/?review=1&render=original', base).href);
      await page.waitForFunction(() => globalThis.__fpsQA?.ready, null, { timeout: 45000 });
      assert.equal(await page.inputValue('#fps-limit'), '60');
      await page.evaluate(() => globalThis.__fpsQA.stop());
      row.checks.push('기존 저장 설정에 FPS 값이 없으면 기본 60으로 시작한다');
      for (const cap of [30, 60, 75, 90, 120]) {
        await choose(page, cap);
        for (const hz of [60, 75, 120, 144]) {
          const rate = await page.evaluate(hz => globalThis.__fpsQA.simulate(hz, 10), hz);
          assert.ok(Math.abs(rate - Math.min(cap, hz)) <= 0.2, name + ': ' + cap + ' / ' + hz + 'Hz = ' + rate);
          row.rates.push({ cap, sourceHz: hz, rate });
        }
      }
      row.checks.push('30~120 설정과 60·75·120·144Hz 입력에서 선택한 평균 상한을 지킨다');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')));
      assert.equal(saved.mouseSensitivity, 0.75); assert.equal(saved.audio.master, 0.42);
      assert.equal(Object.hasOwn(saved, 'reducedMotion'), false);
      await page.click('#view-settings summary');
      await page.locator('#low-power').check();
      assert.equal(await page.inputValue('#fps-limit'), '120');
      assert.ok((await page.locator('#fps-limit-help').textContent()).includes('절전 표현 중'));
      assert.ok(Math.abs(await page.evaluate(() => globalThis.__fpsQA.simulate(144, 10)) - 30) <= 0.2);
      await page.locator('#low-power').uncheck();
      assert.ok(Math.abs(await page.evaluate(() => globalThis.__fpsQA.simulate(144, 10)) - 120) <= 0.2);
      for (const mode of ['ready', 'paused', 'tv']) assert.ok(Math.abs(await page.evaluate(mode => globalThis.__fpsQA.simulate(144, 10, mode), mode) - 30) <= 0.2);
      assert.equal(await page.evaluate(() => globalThis.__fpsQA.gap()), 1);
      row.checks.push('절전·대기·일시정지·TV는 30을 유지하고 긴 중단 후 밀린 프레임을 몰아 그리지 않는다');
      await choose(page, 90);
      await page.reload();
      await page.waitForFunction(() => globalThis.__fpsQA?.ready);
      assert.equal(await page.inputValue('#fps-limit'), '90');
      await page.click('#view-settings summary');
      await page.click('#fps-limit-reset');
      assert.equal(await page.inputValue('#fps-limit'), '60');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')).fpsLimit), 60);
      row.checks.push('FPS를 복원·초기화하며 감도·음량·동작 줄이기의 저장 의미를 보존한다');
      await page.evaluate(() => { globalThis.__fpsQA.stop(); globalThis.__fpsQA.resume(); });
      await page.waitForTimeout(1000);
      row.liveDefaultFps = await page.evaluate(async () => {
        const count = globalThis.__fpsCount, start = performance.now();
        await new Promise(resolve => setTimeout(resolve, 2000));
        return (globalThis.__fpsCount - count) * 1000 / (performance.now() - start);
      });
      assert.ok(row.liveDefaultFps <= 61);
      row.checks.push('실제 3D 렌더링에서도 기본 60 상한을 넘지 않는다');
      await page.locator('#environment-review').evaluate(element => { element.open = false; });
      await page.screenshot({ path: path.join(output, name + '-settings.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#fps-limit').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#view-settings').evaluate(element => element.scrollWidth <= element.clientWidth));
      assert.ok(await page.locator('#fps-limit').evaluate(input => {
        const rect = input.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
      }));
      await page.locator('#fps-limit').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.inputValue('#fps-limit'), '61');
      await page.click('#fps-limit-reset');
      row.checks.push('작은 화면에서도 FPS 조절이 가려지지 않고 방향키로 1FPS씩 선택할 수 있다');
      await page.screenshot({ path: path.join(output, name + '-small.png') });
      assert.deepEqual(row.errors, []); row.passed = true;
    } catch (error) { row.failure = error.stack; throw error; }
    finally { await browser.close(); fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2)); }
  }
  console.log(JSON.stringify(results));
} catch (error) { console.error(error); process.exitCode = 1; }
