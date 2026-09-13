import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/graphics-help-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const results = [];
const hook = `
globalThis.__helpQA = {
  get state() { return { mode, keys: keys.size, position: camera.position.toArray(), texel: texelSplat?.state.enabled, frames: renderer?.info.render.frame }; },
  setMode,
  renderer(name) { graphicsHelp.setRenderer({ getExtension: () => name == null ? null : { UNMASKED_RENDERER_WEBGL: 1 }, getParameter: () => name }); },
  sample(ms, count) { for (let i = 0; i < count; i++) graphicsHelp.sampleFrame(ms, true); }
};`;

async function prepare(page, noWebGL = false) {
  await page.addInitScript(noWebGL => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { configurable: true, value: undefined });
    const getContext = HTMLCanvasElement.prototype.getContext;
    if (noWebGL) HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : getContext.call(this, kind, ...args);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { globalThis.__copiedAddress = text; } } });
  }, noWebGL);
  await page.route('**/api/seoul-weather', route => route.abort());
  await page.route('https://api.met.no/**', route => route.abort());
  await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + hook }));
  await page.goto(new URL('room-preview/?review=1&render=original', base).href);
  await page.waitForFunction(() => ['ready', 'error'].includes(globalThis.__helpQA?.state.mode), null, { timeout: 45000 });
}

try {
  for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
    const checks = [], errors = [];
    const row = { browser: name, version: browser.version(), checks, errors, passed: false };
    results.push(row);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => errors.push(error.message));
      await prepare(page);
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.mode), 'ready');
      row.renderer = await page.locator('#graphics-renderer').textContent();
      assert.equal(await page.inputValue('#graphics-browser'), name);
      await page.evaluate(() => globalThis.__helpQA.renderer('ANGLE (NVIDIA GeForce RTX 3080 D3D11)'));
      assert.equal(await page.locator('#graphics-entry-warning').isVisible(), false);
      checks.push('정상 장치에 자동 경고를 표시하지 않고 브라우저를 구분한다');
      await page.evaluate(() => globalThis.__helpQA.renderer('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) D3D11)'));
      assert.equal(await page.locator('#graphics-entry-warning').isVisible(), true);
      await page.click('#enter-button');
      assert.equal(await page.locator('#graphics-warning').isVisible(), true);
      assert.equal(await page.evaluate(() => document.querySelector('#graphics-help').open), false);
      await page.locator('#graphics-warning [data-graphics-help]').click();
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.mode), 'paused');
      const position = await page.evaluate(() => globalThis.__helpQA.state.position);
      const rendered = await page.evaluate(() => globalThis.__helpQA.state.frames);
      await page.keyboard.press('KeyW');
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.keys), 0);
      assert.deepEqual(await page.evaluate(() => globalThis.__helpQA.state.position), position);
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.frames), rendered);
      checks.push('소프트웨어 감지는 비차단 안내를 띄우고 도움말에서 이동 입력과 3D 반복 그리기를 멈춘다');
      await page.selectOption('#graphics-browser', 'chrome');
      await page.locator('[data-copy-address="chrome-angle-address"]').click();
      assert.equal(await page.evaluate(() => globalThis.__copiedAddress), 'chrome://flags/#use-angle');
      await page.selectOption('#graphics-browser', 'firefox');
      await page.locator('[data-copy-address="firefox-support-address"]').click();
      assert.equal(await page.evaluate(() => globalThis.__copiedAddress), 'about:support');
      await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('클립보드 제한 상황'); }; });
      await page.locator('[data-copy-address="firefox-settings-address"]').click();
      assert.ok((await page.locator('#graphics-copy-status').textContent()).includes('직접 복사'));
      assert.deepEqual(await page.locator('#firefox-settings-address').evaluate(input => [input.selectionStart, input.selectionEnd]), [0, 'about:preferences'.length]);
      checks.push('두 브라우저 안내의 주소 복사와 클립보드 제한 시 직접 복사 동작을 확인한다');
      await page.screenshot({ path: path.join(output, name + '-help.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.querySelector('#graphics-help').open), false);
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.mode), 'paused');
      await page.locator('#pause-panel [data-graphics-help]').click();
      await page.click('#graphics-low-power');
      assert.equal(await page.isChecked('#low-power'), true);
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.mode), 'explore');
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.texel), false);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')).lowPower), true);
      assert.equal(await page.locator('#graphics-warning').isVisible(), false);
      checks.push('Esc는 일시정지로 돌아가며 절전 선택은 저장 후 재개하고 안내를 반복하지 않는다');
      await page.reload();
      await page.waitForFunction(() => globalThis.__helpQA?.state.mode === 'ready');
      await page.evaluate(() => { globalThis.__helpQA.renderer(null); globalThis.__helpQA.setMode('explore'); globalThis.__helpQA.sample(1000 / 30, 350); });
      assert.equal(await page.locator('#graphics-warning').isVisible(), false);
      await page.evaluate(() => { globalThis.__helpQA.setMode('explore'); globalThis.__helpQA.sample(100, 91); });
      assert.equal(await page.locator('#graphics-warning').isVisible(), true);
      assert.ok((await page.locator('#graphics-warning-message').textContent()).includes('낮은 프레임'));
      await page.evaluate(() => globalThis.__helpQA.sample(1000 / 60, 430));
      assert.equal(await page.locator('#graphics-warning').isVisible(), false);
      checks.push('장치 정보가 제한돼도 저프레임 안내가 작동하고 30FPS·회복 상태를 구분한다');
      await page.keyboard.press('Escape');
      await page.locator('#pause-panel [data-graphics-help]').click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.selectOption('#graphics-browser', name);
      await page.locator('#graphics-continue').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#graphics-help').evaluate(element => element.scrollWidth <= element.clientWidth));
      await page.screenshot({ path: path.join(output, name + '-small.png') });
      await page.click('#graphics-continue');
      assert.equal(await page.evaluate(() => globalThis.__helpQA.state.mode), 'explore');
      checks.push('작은 화면에서 도움말이 스크롤되고 계속 둘러보기를 사용할 수 있다');
      const failed = await browser.newPage();
      failed.on('pageerror', error => errors.push(error.message));
      await prepare(failed, true);
      assert.equal(await failed.evaluate(() => globalThis.__helpQA.state.mode), 'error');
      await failed.locator('#entry-panel [data-graphics-help]').click();
      assert.equal(await failed.isDisabled('#graphics-continue'), true);
      assert.equal(await failed.isDisabled('#graphics-low-power'), true);
      assert.equal(await failed.locator('.graphics-help-actions a').getAttribute('href'), '../classic.html');
      checks.push('3D 초기화 실패 중에도 도움말과 일반 홈페이지 연결을 사용할 수 있다');
      assert.deepEqual(errors, []);
      row.passed = true;
    } catch (error) { row.failure = error.stack; throw error; }
    finally {
      await browser.close();
      fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2));
    }
  }
  console.log(JSON.stringify(results));
} catch (error) { console.error(error); process.exitCode = 1; }
