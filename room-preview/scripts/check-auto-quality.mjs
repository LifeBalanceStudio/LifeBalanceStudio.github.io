import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/auto-quality-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
fs.mkdirSync(output, { recursive: true });
const results = [];
const marker = '  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });';
const capture = `
  const originalLoop = renderer.setAnimationLoop.bind(renderer);
  renderer.setAnimationLoop = callback => { if (callback) globalThis.__qualityStep = callback; originalLoop(callback); };`;
const hook = `
let qualityClock = 0, qualityRenders = 0, qualityBlankFrames = 0;
globalThis.__qualityQA = {
  get ready() { return mode === 'ready'; },
  get state() {
    return { scale: autoQuality.scale, enabled: autoQualityEnabled, displayMs: autoQuality.displayMs,
      ratio: renderer.getPixelRatio(), width: canvas.width, height: canvas.height,
      cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, fpsLimit, lowPower,
      texel: texelSplat.state.enabled, targetCount: targets.length, position: camera.position.toArray(), blankFrames: qualityBlankFrames };
  },
  stop() {
    renderer.setAnimationLoop(null);
    this.realRender = texelSplat.render; this.realOutline = interactionOutline.render;
    texelSplat.render = () => { qualityRenders++; }; interactionOutline.render = () => {};
  },
  start(nextMode = 'explore', hz = 60) {
    setMode(nextMode);
    autoQuality.calibrate();
    for (let i = 0; i <= 8; i++) autoQuality.tick(i * 1000 / hz);
    qualityClock = performance.now(); previousTime = qualityClock; nextRenderAt = qualityClock;
  },
  run(hz, seconds) {
    const start = qualityClock;
    qualityRenders = 0;
    for (let i = 1; i <= hz * seconds; i++) {
      const before = qualityRenders;
      globalThis.__qualityStep(start + i * 1000 / hz);
      if (qualityRenders > before && resizeFramePending) qualityBlankFrames++;
    }
    qualityClock = start + seconds * 1000;
    return { ...this.state, renderedFps: qualityRenders / seconds };
  },
  recalibrate() {
    autoQuality.calibrate(); resize(); nextRenderAt = qualityClock;
    const before = qualityRenders;
    globalThis.__qualityStep(qualityClock += 1000 / 60);
    return { draws: qualityRenders - before, pending: resizeFramePending };
  },
  draw() {
    this.realRender.call(texelSplat, 0); this.realOutline.call(interactionOutline, 0);
    return { error: renderer.getContext().getError(), shaderErrors: renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).length };
  }
};`;
const original = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8');
assert.ok(original.includes(marker));
const source = original.replace(marker, marker + capture) + hook;

async function fps(page, value) {
  await page.locator('#fps-limit').evaluate((input, next) => {
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
  const row = { browser: name, version: browser.version(), checks: [], states: {}, errors: [], passed: false };
  results.push(row);
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    page.on('pageerror', error => row.errors.push(error.message));
    await page.addInitScript(() => {
      const key = 'lifebalance.room.preferences.v1';
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ mouseSensitivity: 0.75, audio: { enabled: false, master: 0.42, effects: 0.55, ambience: 0.22 } }));
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/room-preview/app.mjs')) return route.fulfill({ contentType: 'text/javascript', body: source });
      if (url.origin !== new URL(base).origin) return route.abort();
      return route.continue();
    });
    await page.goto(new URL('room-preview/', base).href);
    await page.waitForFunction(() => globalThis.__qualityQA?.ready);
    await page.waitForTimeout(400);
    row.states.initial = await page.evaluate(() => globalThis.__qualityQA.state);
    assert.equal(await page.locator('#auto-quality').isChecked(), true);
    assert.equal(row.states.initial.ratio, 1.75);
    assert.ok(row.states.initial.displayMs > 3 && row.states.initial.displayMs < 40);
    row.checks.push('기존 저장 설정에 자동 조절 항목이 없어도 기본 켜짐이며 실제 주사율을 측정한다');
    await page.evaluate(() => { globalThis.__qualityQA.stop(); globalThis.__qualityQA.start(); document.querySelector('#view-settings').open = true; });

    await fps(page, 120);
    let state = await page.evaluate(() => globalThis.__qualityQA.run(60, 40));
    assert.equal(state.scale, 1);
    assert.ok(Math.abs(state.renderedFps - 60) < 0.1);
    row.checks.push('60Hz에서 120FPS를 선택해도 해상도를 낮추지 않는다');

    row.states.low = state = await page.evaluate(() => globalThis.__qualityQA.run(20, 35));
    assert.equal(state.scale, 0.6);
    assert.equal(state.width, Math.floor(state.cssWidth * 1.75 * 0.6));
    assert.equal(state.height, Math.floor(state.cssHeight * 1.75 * 0.6));
    assert.equal(state.fpsLimit, 120);
    assert.equal(state.targetCount, row.states.initial.targetCount);
    assert.match(await page.locator('#auto-quality-status').textContent(), /60%/);
    assert.deepEqual(await page.evaluate(() => globalThis.__qualityQA.draw()), { error: 0, shaderErrors: 0 });
    await page.screenshot({ path: path.join(output, name + '-60-percent.png') });
    row.checks.push('지속적인 저속 간격에서 실제 그리기 버퍼만 60%로 줄고 UI·FPS 상한·상호작용 대상은 유지된다');

    state = await page.evaluate(() => globalThis.__qualityQA.run(60, 30));
    assert.ok(state.scale > 0.6 && state.scale < 1);
    state = await page.evaluate(() => globalThis.__qualityQA.run(60, 80));
    assert.equal(state.scale, 1);
    row.checks.push('충분한 회복 시간이 지난 뒤 한 단계씩 기본 해상도로 돌아온다');
    assert.equal(state.blankFrames, 0);
    assert.deepEqual(await page.evaluate(() => globalThis.__qualityQA.recalibrate()), { draws: 1, pending: false });
    row.checks.push('해상도 변경과 주사율 재측정 때 크기를 바꾼 캔버스를 같은 프레임에 그린다');

    await fps(page, 30);
    state = await page.evaluate(() => { globalThis.__qualityQA.start(); return globalThis.__qualityQA.run(60, 40); });
    assert.equal(state.scale, 1);
    assert.ok(Math.abs(state.renderedFps - 30) < 0.1);
    await page.locator('#low-power').check();
    await fps(page, 120);
    state = await page.evaluate(() => globalThis.__qualityQA.run(60, 40));
    assert.equal(state.scale, 1);
    assert.equal(state.ratio, 1);
    assert.ok(Math.abs(state.renderedFps - 30) < 0.1);
    await page.locator('#low-power').uncheck();
    row.checks.push('사용자 30FPS와 절전 표현의 30FPS 제한을 그대로 지킨다');

    await page.evaluate(() => { globalThis.__qualityQA.start('paused'); globalThis.__qualityQA.run(20, 40); });
    assert.equal((await page.evaluate(() => globalThis.__qualityQA.state)).scale, 1);
    await page.evaluate(() => { globalThis.__qualityQA.start('explore'); globalThis.__qualityQA.run(20, 8); });
    await page.locator('#auto-quality').uncheck();
    state = await page.evaluate(() => globalThis.__qualityQA.run(20, 30));
    assert.equal(state.scale, 1);
    assert.equal(state.ratio, 1.75);
    row.checks.push('일시정지는 품질 판단에서 제외하고 자동 조절을 끄면 즉시 기본 해상도로 복원한다');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')));
    assert.equal(saved.autoQuality, false);
    assert.equal(saved.fpsLimit, 120);
    assert.equal(saved.mouseSensitivity, 0.75);
    assert.equal(saved.audio.master, 0.42);
    await page.reload();
    await page.waitForFunction(() => globalThis.__qualityQA?.ready);
    assert.equal(await page.locator('#auto-quality').isChecked(), false);
    assert.equal((await page.evaluate(() => globalThis.__qualityQA.state)).ratio, 1.75);
    row.checks.push('새로고침 뒤 자동 조절 꺼짐과 기존 감도·소리·FPS 설정을 보존한다');

    await page.evaluate(() => { globalThis.__qualityQA.stop(); globalThis.__qualityQA.start(); document.querySelector('#view-settings').open = true; });
    await page.locator('#auto-quality').check();
    await page.locator('#texel-toggle').click();
    await page.evaluate(() => globalThis.__qualityQA.start());
    state = await page.evaluate(() => globalThis.__qualityQA.run(20, 35));
    assert.equal(state.scale, 0.6);
    assert.equal(state.texel, true);
    assert.equal(await page.locator('#texel-toggle').isChecked(), true);
    assert.deepEqual(await page.evaluate(() => globalThis.__qualityQA.draw()), { error: 0, shaderErrors: 0 });
    await page.screenshot({ path: path.join(output, name + '-texel-60-percent.png') });
    row.checks.push('텍셀 설정을 유지한 채 버퍼 크기를 바꾸고 실제 텍셀·아웃라인 렌더링을 실행한다');
    assert.deepEqual(row.errors, []);
    row.passed = true;
  } catch (error) {
    row.failure = error.stack;
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2));
  }
}
console.log(JSON.stringify(results.map(row => ({ browser: row.browser, passed: row.passed, checks: row.checks.length, failure: row.failure, errors: row.errors })), null, 2));
