import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/unity-crt-2026-09-15');
const kind = process.env.DEMO_BROWSER || 'chromium';
const texel = process.env.DEMO_TEXEL === '1';
const label = kind + (texel ? '-texel' : '');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const report = { browser: kind, texel, checks: [], errors: [] };
fs.mkdirSync(output, { recursive: true });
const browser = await playwright[kind].launch({ headless: true,
  ...(kind === 'chromium' && process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => { if (request.url().includes('/games/fastpop_webgl/')) requests.push(request.url()); });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(texel => {
    localStorage.setItem('lifebalance.room.preferences.v1', JSON.stringify({ reducedMotion: true }));
    localStorage.setItem('lifebalance.texel-splat.enabled', texel ? '1' : '0');
  }, texel);
  await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript',
    body: fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + '\nglobalThis.__demoQA = { setMode, enterTV, renderer, camera, get mode() { return mode; }, get menu() { return tvMenu; }, get screen() { return screen; } };' }));
  await page.goto(new URL('room-preview/', base).href);
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled && globalThis.__demoQA?.menu);
  await page.evaluate(() => { __demoQA.setMode('explore'); __demoQA.enterTV(); });
  await page.waitForFunction(() => __demoQA.mode === 'tv');
  await page.locator('#tv-choose').click();
  await page.locator('#tv-next').click();
  await page.locator('#tv-choose').click();
  assert.equal(await page.locator('#tv-next').textContent(), '다음 페이지');
  assert.equal(await page.locator('#tv-demo').isVisible(), true);
  await page.locator('#tv-next').click();
  assert.equal(await page.locator('#tv-previous').textContent(), '이전 페이지');
  assert.equal(await page.evaluate(() => __demoQA.menu.detailPage), 1);
  assert.equal(requests.length, 0);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(output, label + '-menu.png') });
  report.checks.push('상세 페이지 전환과 데모 선택, 선택 전 빌드 요청 없음');

  // 조작 버튼에 포커스가 있어도 방향키로 고른 항목을 실행할 수 있어야 한다.
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => __demoQA.menu.detailAction), 1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __demoQA.mode === 'tv-demo');
  await page.waitForFunction(() => document.querySelector('#demo-status').hidden, null, { timeout: 90000 });
  const gameFrame = () => page.frames().find(frame => frame.url().endsWith('/unity-player.html'));
  assert.ok(gameFrame());
  assert.ok(requests.some(url => url.endsWith('.data.unityweb')));
  await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(output, label + '-game.png') });
  await gameFrame().evaluate(() => canvas.addEventListener('pointerdown', event => {
    globalThis.__demoTap = { x: event.offsetX, y: event.offsetY };
  }, { once: true }));
  const gameBounds = await gameFrame().locator('canvas').boundingBox();
  await gameFrame().locator('canvas').tap({ position: { x: gameBounds.width * .5, y: gameBounds.height * .676 } });
  const tap = await gameFrame().evaluate(() => globalThis.__demoTap);
  assert.ok(Math.abs(tap.x - gameBounds.width * .5) < 2 && Math.abs(tap.y - gameBounds.height * .676) < 2);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(output, label + '-playing.png') });
  const count = await page.evaluate(() => __demoQA.renderer.info.render.frame);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => __demoQA.renderer.info.render.frame), count);
  const enabled = await page.locator('#texel-toggle').isChecked();
  assert.equal(enabled, texel);
  await gameFrame().locator('canvas').focus();
  await page.keyboard.press('t');
  assert.equal(await page.locator('#texel-toggle').isChecked(), enabled);
  report.checks.push('실제 Unity 초기화 및 표시, 방 렌더 정지와 게임 입력 분리');

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    const screen = await page.locator('.demo-screen').boundingBox();
    const frame = await page.locator('.demo-screen iframe').boundingBox();
    assert.ok(Math.abs(frame.width / frame.height - 600 / 960) < .005);
    assert.ok(frame.x >= screen.x - 1 && frame.y >= screen.y - 1);
    assert.ok(frame.x + frame.width <= screen.x + screen.width + 1);
    assert.ok(frame.y + frame.height <= screen.y + screen.height + 1);
    assert.ok(screen.x >= -1 && screen.y >= -1 && screen.x + screen.width <= viewport.width + 1 && screen.y + screen.height <= viewport.height + 1);
    const toolbar = await page.locator('.demo-toolbar').boundingBox();
    assert.ok(frame.y + frame.height <= toolbar.y + 1, '종료 버튼이 게임 화면을 가리면 안 된다');
    await page.screenshot({ path: path.join(output, label + '-' + viewport.width + '.png') });
  }
  report.checks.push('세로·가로 전환 후 CRT 내부의 세로 비율과 위치 유지');
  await gameFrame().evaluate(() => {
    const quit = instance.Quit.bind(instance);
    instance.Quit = () => { parent.__demoQuitObserved = true; return quit(); };
  });
  await gameFrame().locator('canvas').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => __demoQA.mode === 'tv');
  assert.equal(await page.evaluate(() => globalThis.__demoQuitObserved), true);
  assert.equal(await page.locator('.demo-screen iframe').count(), 0);
  assert.equal(await page.evaluate(() => __demoQA.menu.detailPage), 1);
  assert.equal(await page.evaluate(() => __demoQA.menu.current.title), 'Fast Pop!!');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tv-demo');
  report.checks.push('Esc에서 Unity 종료 API 호출과 상세 페이지·포커스 복원');

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/fastpop_webgl.loader.js', async route => { await gate; await route.abort().catch(() => {}); });
  await page.locator('#tv-demo').click();
  await page.waitForFunction(() => document.querySelector('#demo-dialog').open);
  await page.locator('#demo-exit').click();
  await page.waitForFunction(() => __demoQA.mode === 'tv');
  assert.equal(await page.locator('.demo-screen iframe').count(), 0);
  release();
  await page.unroute('**/fastpop_webgl.loader.js');
  report.checks.push('로딩 중 취소 시 프레임 제거와 메뉴 복귀');

  let fail = true;
  await page.route('**/fastpop_webgl.loader.js', route => fail ? route.abort() : route.continue());
  await page.locator('#tv-demo').click();
  await page.waitForFunction(() => !document.querySelector('#demo-retry').hidden);
  assert.match(await page.locator('#demo-status').textContent(), /불러오지 못했습니다/);
  fail = false;
  await page.locator('#demo-retry').click();
  await page.waitForFunction(() => document.querySelector('#demo-status').hidden, null, { timeout: 90000 });
  const retryFrame = await page.locator('.demo-screen iframe').boundingBox();
  assert.ok(Math.abs(retryFrame.width / retryFrame.height - 600 / 960) < .005);
  await page.locator('#demo-exit').click();
  await page.waitForFunction(() => __demoQA.mode === 'tv');
  report.checks.push('로더 요청 실패 안내와 재시도, 재실행 후 버튼 종료');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, label + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
