import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/interaction-controls-2026-09-13');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const errors = [], checks = [];
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const hook = `
globalThis.__controlsQA = {
  get state() { return { mode, yaw, pitch, mouseSensitivity, opening, openingTarget, keys: keys.size,
    lightOn: ceilingLamp?.on, intensity: ceilingLamp?.light.intensity, rocker: root?.getObjectByName('벽스위치_버튼')?.rotation.x,
    blindHeight: fabric?.scale.y, barY: bottomBar?.position.y, daylight: windowLight.intensity,
    modal: blindDialog.open, locked: document.pointerLockElement === canvas }; },
  aim(id, position) {
    setMode('explore'); camera.position.fromArray(position);
    camera.lookAt(targets.find(target => target.id === id).box.getCenter(new THREE.Vector3()));
    yaw = camera.rotation.y; pitch = camera.rotation.x; camera.updateMatrixWorld(true); canvas.focus();
  },
  setMotion(value) { reducedMotionInput.checked = value; applyViewPreferences(false); },
  setMode, findInteraction, setTexelOption
};`;

async function prepare(page, dragOnly) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ dragOnly }) => {
    const OriginalDate = Date;
    const now = OriginalDate.parse('2026-09-13T12:00:00+09:00');
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    const key = 'lifebalance.room.preferences.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ lowPower: false, reducedMotion: true }));
    if (dragOnly) Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { configurable: true, value: undefined });
  }, { dragOnly });
  await page.route('**/api/seoul-weather', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ properties: {
    meta: { updated_at: '2026-09-13T03:00:00Z', units: { cloud_area_fraction: '%', wind_speed: 'm/s', wind_from_direction: 'degrees', precipitation_amount: 'mm' } },
    timeseries: [{ time: '2026-09-13T03:00:00Z', data: { instant: { details: { cloud_area_fraction: 20, wind_speed: 0, wind_from_direction: 0 } }, next_1_hours: { summary: { symbol_code: 'fair_day' }, details: { precipitation_amount: 0 } } } }]
  } }) }));
  await page.route('**/api/seoul-traffic', route => route.fulfill({ contentType: 'application/json', body: '{"source":"schedule","reason":"unconfigured"}' }));
  await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + hook }));
  await page.goto(new URL('room-preview/', base).href);
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled && globalThis.__controlsQA);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await prepare(page, true);
  const state = () => page.evaluate(() => __controlsQA.state);
  assert.equal((await state()).mouseSensitivity, 1);
  await page.locator('#view-settings summary').click();
  await page.locator('#mouse-sensitivity').focus();
  await page.keyboard.press('End');
  assert.equal((await state()).mouseSensitivity, 2);
  assert.equal(await page.locator('#mouse-sensitivity-value').textContent(), '200%');
  await page.screenshot({ path: path.join(output, 'mouse-settings.png') });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled);
  assert.equal((await state()).mouseSensitivity, 2);
  assert.equal(await page.locator('#reduce-motion').isChecked(), true);
  checks.push('기존 설정에 감도가 없어도 초기화하고 감도와 기존 설정을 저장·복원');
  await page.locator('#view-settings summary').click();
  await page.locator('#mouse-sensitivity-reset').click();
  assert.equal((await state()).mouseSensitivity, 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')).mouseSensitivity), 1);
  checks.push('감도 기본값 복원과 저장');
  await page.locator('#view-settings summary').click();
  await page.locator('#enter-button').click();

  async function drag() {
    const before = await state();
    await page.mouse.move(630, 410); await page.mouse.down();
    await page.mouse.move(650, 410, { steps: 2 }); await page.mouse.up();
    return Math.abs((await state()).yaw - before.yaw);
  }
  const normalDrag = await drag();
  await page.locator('#view-settings summary').click();
  await page.locator('#mouse-sensitivity').focus(); await page.keyboard.press('End');
  await page.keyboard.press('w');
  assert.equal((await state()).keys, 0);
  await page.locator('#view-settings summary').click();
  const fastDrag = await drag();
  assert.ok(normalDrag > 0 && Math.abs(fastDrag / normalDrag - 2) < 0.01);
  checks.push('실제 드래그 감도 배율과 설정 조작 중 이동 입력 차단');

  await page.evaluate(() => __controlsQA.aim('ceiling-switch', [0.6, 1.35, 0.6]));
  assert.equal(await page.evaluate(() => __controlsQA.findInteraction()?.id), 'ceiling-switch');
  await page.keyboard.press('f');
  assert.equal((await state()).lightOn, true);
  assert.equal((await state()).intensity, 22);
  await page.screenshot({ path: path.join(output, 'wall-switch-on.png') });
  const rockerOn = (await state()).rocker;
  await page.evaluate(() => __controlsQA.aim('ceiling-light', [0.08, 1.35, 1.25]));
  assert.equal(await page.evaluate(() => __controlsQA.findInteraction()?.id), 'ceiling-light');
  await page.keyboard.press('Space');
  assert.equal((await state()).lightOn, false);
  assert.ok((await state()).rocker < rockerOn);
  await page.evaluate(() => __controlsQA.aim('ceiling-switch', [0.6, 1.35, 0.6]));
  await page.screenshot({ path: path.join(output, 'wall-switch-off.png') });
  checks.push('실제 벽 스위치 F와 천장등 Space가 같은 조명·버튼 상태를 공유');
  await page.evaluate(() => __controlsQA.setTexelOption(true));
  await page.keyboard.press('f');
  assert.equal((await state()).lightOn, true);
  await page.screenshot({ path: path.join(output, 'wall-switch-texel.png') });
  await page.evaluate(() => __controlsQA.setTexelOption(false));
  checks.push('텍셀 표현에서도 벽 스위치 조작');
  await page.waitForFunction(() => document.querySelector('#notice').hidden);

  await page.evaluate(() => __controlsQA.aim('blind', [0.08, 1.35, -0.9]));
  assert.equal(await page.evaluate(() => __controlsQA.findInteraction()?.id), 'blind');
  await page.keyboard.press('f');
  await page.locator('#blind-controls').waitFor({ state: 'visible' });
  assert.equal((await state()).mode, 'blind');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'blind-opening');
  await page.keyboard.press('w');
  assert.equal((await state()).keys, 0);
  await page.keyboard.press('End');
  await page.waitForFunction(() => __controlsQA.state.opening === 1);
  const fullLight = (await state()).daylight;
  await page.getByRole('button', { name: '절반 열기', exact: true }).click();
  await page.waitForFunction(() => __controlsQA.state.opening === 0.5);
  assert.ok(Math.abs((await state()).blindHeight - 0.7225) < 0.0001);
  assert.ok(Math.abs((await state()).barY - 1.6725) < 0.0001);
  assert.ok(fullLight > 0 && Math.abs((await state()).daylight / fullLight - 0.5) < 0.001);
  const beforePan = await state();
  await page.mouse.move(430, 340); await page.mouse.down();
  await page.mouse.move(430 + beforePan.yaw / (0.0023 * beforePan.mouseSensitivity), 340 + (beforePan.pitch - 0.32) / (0.0023 * beforePan.mouseSensitivity), { steps: 4 });
  await page.mouse.up();
  assert.ok(Math.abs((await state()).yaw) < 0.01);
  assert.equal((await state()).openingTarget, 0.5);
  assert.equal((await state()).mode, 'blind');
  checks.push('블라인드 조절 창 바깥의 드래그만 시점에 적용하고 높이는 유지');
  await page.screenshot({ path: path.join(output, 'blind-half.png') });
  await page.getByRole('button', { name: '완전 닫기', exact: true }).click();
  await page.waitForFunction(() => __controlsQA.state.opening === 0);
  assert.equal((await state()).daylight, 0);
  await page.locator('#blind-opening').focus(); await page.keyboard.press('ArrowRight');
  assert.equal((await state()).openingTarget, 0.01);
  checks.push('줄 상호작용·슬라이더·프리셋과 천·하단 봉·채광의 중간 높이 연동');
  await page.keyboard.press('Escape');
  assert.equal((await state()).modal, false);
  assert.equal((await state()).mode, 'explore');
  await page.evaluate(() => __controlsQA.aim('blind', [0.08, 1.35, -0.9]));
  await page.keyboard.press('Space');
  assert.equal((await state()).modal, true);
  assert.equal(await page.locator('#blind-opening').inputValue(), '1');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await state()).modal, false);
  assert.equal((await state()).mode, 'paused');
  await page.locator('#resume-button').click();
  checks.push('입력 초점에서 Esc 종료·다시 열기·창 이탈 시 안전한 일시정지');

  await page.evaluate(() => { __controlsQA.setMotion(false); __controlsQA.aim('blind', [0.08, 1.35, -1.6]); });
  await page.keyboard.press('f');
  await page.getByRole('button', { name: '완전 열기', exact: true }).click();
  const animated = (await state()).opening;
  assert.ok(animated < 1);
  await page.waitForFunction(() => Math.abs(__controlsQA.state.opening - 1) < 0.0001);
  await page.getByRole('button', { name: '절반 열기', exact: true }).click();
  await page.waitForFunction(() => __controlsQA.state.opening === 0.5);
  await page.setViewportSize({ width: 390, height: 844 });
  const dialogBox = await page.locator('#blind-controls').boundingBox();
  assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390 && dialogBox.y + dialogBox.height <= 844);
  await page.screenshot({ path: path.join(output, 'blind-small.png') });
  await page.locator('#blind-close').click();
  checks.push('일반 애니메이션의 목표 높이 도달과 작은 화면의 조절 창 배치');

  const lockedPage = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await prepare(lockedPage, false);
  await lockedPage.locator('#enter-button').click();
  await lockedPage.waitForFunction(() => document.pointerLockElement === document.querySelector('#view'));
  const beforeLocked = await lockedPage.evaluate(() => __controlsQA.state);
  await lockedPage.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 20, movementY: 0, bubbles: true })));
  const afterLocked = await lockedPage.evaluate(() => __controlsQA.state);
  assert.ok(Math.abs(afterLocked.yaw - beforeLocked.yaw + 20 * 0.0023) < 0.0001);
  await lockedPage.evaluate(() => __controlsQA.aim('blind', [0.08, 1.35, -1.6]));
  await lockedPage.keyboard.press('f');
  await lockedPage.waitForFunction(() => __controlsQA.state.modal && !document.pointerLockElement);
  await lockedPage.locator('#blind-close').click();
  await lockedPage.waitForFunction(() => __controlsQA.state.mode === 'explore' && document.pointerLockElement === document.querySelector('#view'));
  checks.push('실제 마우스 고정 경로의 감도 적용과 블라인드 조절 전후 고정 해제·복귀');
  await lockedPage.close();
  const automaticPage = await browser.newPage();
  await automaticPage.emulateMedia({ reducedMotion: 'reduce' });
  await automaticPage.addInitScript(() => localStorage.setItem('lifebalance.room.preferences.v1', JSON.stringify({ lowPower: false })));
  await prepare(automaticPage, true);
  await automaticPage.locator('#view-settings summary').click();
  await automaticPage.locator('#mouse-sensitivity').focus();
  await automaticPage.keyboard.press('End');
  const savedAutomatic = await automaticPage.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')));
  assert.equal(savedAutomatic.mouseSensitivity, 2);
  assert.equal(Object.hasOwn(savedAutomatic, 'reducedMotion'), false);
  await automaticPage.emulateMedia({ reducedMotion: 'no-preference' });
  await automaticPage.waitForFunction(() => !document.querySelector('#reduce-motion').checked);
  checks.push('감도만 저장해도 운영체제 동작 줄이기 설정의 자동 추종 유지');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify({ passed: true, checks, errors, normalDrag, fastDrag, fullLight }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} finally {
  await browser.close();
}
