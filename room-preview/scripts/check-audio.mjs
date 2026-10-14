import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.AUDIO_CHECK_OUTPUT || path.join(root, 'docs/audio-2026-09-14');
fs.mkdirSync(output, { recursive: true });
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const engine = process.env.AUDIO_BROWSER === 'firefox' ? firefox : chromium;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
const checks = [], errors = [], requests = [];
const hook = `
globalThis.__audioQA = {
  roomAudio,
  get mode() { return mode; },
  get lightOn() { return ceilingLamp?.on; },
  aim(id) {
    setMode('explore'); camera.position.set(0.08, 1.35, 1.25);
    camera.lookAt(targets.find(target => target.id === id).box.getCenter(new THREE.Vector3()));
    yaw = camera.rotation.y; pitch = camera.rotation.x; camera.updateMatrixWorld(true); canvas.focus();
  },
  environment(weather, traffic, distance, height) {
    effectiveWeather = weather; effectiveTraffic = traffic;
    camera.position.set(0, 1.35, distance - 1.82);
    opening = openingTarget = height; applyBlind();
  },
  blind(value) { setBlindOpening(value); },
  setMotion(value) { reducedMotion = value; },
  openTV() { setMode('explore'); enterTV(); }
};`;

async function prepare(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/assets/audio/')) requests.push(request.url()); });
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { configurable: true, value: undefined });
    const OriginalContext = globalThis.AudioContext;
    globalThis.__audioCapture = { oscillators: 0, samples: 0 };
    globalThis.AudioContext = class extends OriginalContext {
      createGain() {
        const gain = super.createGain();
        if (!globalThis.__audioCapture.master) {
          const capture = globalThis.__audioCapture;
          capture.master = gain; capture.context = this;
          capture.analyser = this.createAnalyser(); capture.analyser.fftSize = 2048;
          const silent = super.createGain(); silent.gain.value = 0;
          gain.connect(capture.analyser).connect(silent).connect(this.destination);
        }
        return gain;
      }
      createOscillator() { globalThis.__audioCapture.oscillators++; return super.createOscillator(); }
      createBufferSource() { globalThis.__audioCapture.samples++; return super.createBufferSource(); }
    };
  });
  await page.route('**/api/seoul-weather', route => route.abort());
  await page.route('https://api.met.no/**', route => route.abort());
  await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + hook }));
  await page.goto(new URL('room-preview/?review=1', base).href);
  await page.waitForFunction(() => globalThis.__audioQA?.mode === 'ready', { timeout: 30000 });
}
const state = page => page.evaluate(() => globalThis.__audioQA.roomAudio.state);
async function volume(page, name, value) {
  await page.locator('#sound-' + name).evaluate((input, value) => {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}
async function energy(page) {
  return page.evaluate(() => {
    const analyser = globalThis.__audioCapture.analyser;
    const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await prepare(page);
  assert.equal((await state(page)).context, 'uninitialized');
  assert.equal(requests.length, 0);
  checks.push('첫 방문은 음소거이며 음원 요청과 오디오 컨텍스트 생성이 없다');
  await page.click('#sound-toggle');
  await page.waitForFunction(() => globalThis.__audioQA.roomAudio.state.loaded === 5);
  assert.equal((await state(page)).loops, 4);
  const filesRequested = requests.length;
  await page.waitForTimeout(1100);
  assert.ok(await energy(page) > 0.000001);
  checks.push('사용자 클릭 후 MP3 다섯 개가 해독되고 환경음 신호가 출력된다');
  await volume(page, 'master', 0);
  await page.waitForTimeout(700);
  assert.ok(await energy(page) < 0.0000001);
  await volume(page, 'master', 50);
  await volume(page, 'ambience', 0);
  await page.waitForTimeout(1400);
  // 지수 감쇠가 검사 기준에 도달하는 시점은 브라우저마다 조금 다를 수 있다.
  for (let i = 0; i < 10 && await energy(page) >= 0.0000001; i++) await page.waitForTimeout(100);
  assert.ok(await energy(page) < 0.0000001);
  checks.push('전체 음량 0과 환경음 음량 0이 실제 출력 신호에 반영된다');
  await page.evaluate(() => globalThis.__audioQA.aim('ceiling-switch'));
  const beforeSwitch = await page.evaluate(() => globalThis.__audioCapture.samples);
  await page.keyboard.press('KeyF');
  assert.equal(await page.evaluate(() => globalThis.__audioCapture.samples), beforeSwitch + 1);
  assert.equal(await page.evaluate(() => globalThis.__audioQA.lightOn), true);
  await page.evaluate(() => globalThis.__audioQA.openTV());
  await page.waitForFunction(() => globalThis.__audioQA.mode === 'tv');
  const beforeMenu = await page.evaluate(() => globalThis.__audioCapture.oscillators);
  await page.click('#tv-choose');
  await page.waitForTimeout(80);
  await page.click('#tv-choose');
  await page.waitForTimeout(80);
  await page.click('#tv-next');
  assert.equal(await page.evaluate(() => globalThis.__audioCapture.oscillators), beforeMenu + 3);
  await volume(page, 'effects', 0);
  const mutedMenu = await page.evaluate(() => globalThis.__audioCapture.oscillators);
  await page.click('#tv-back');
  assert.equal(await page.evaluate(() => globalThis.__audioCapture.oscillators), mutedMenu);
  checks.push('실제 벽 스위치와 CRT 선택·상세 전환에 조작음이 연결되고 조작음 0은 합성을 막는다');
  await page.click('#tv-back'); await page.click('#tv-back');
  await page.waitForFunction(() => globalThis.__audioQA.mode === 'explore');
  await volume(page, 'effects', 70); await volume(page, 'ambience', 25);
  const rain = { condition: 'storm', precipitationRate: 8, windSpeed: 8 };
  await page.evaluate(rain => globalThis.__audioQA.environment(rain, { road: 12 }, 0.3, 1), rain);
  await page.waitForTimeout(250);
  const close = (await state(page)).levels;
  await page.evaluate(rain => globalThis.__audioQA.environment(rain, { road: 2 }, 3, 0), rain);
  await page.waitForTimeout(250);
  const far = (await state(page)).levels;
  assert.ok(close.rain > far.rain && close.traffic > far.traffic && close.cutoff > far.cutoff);
  await volume(page, 'ambience', 0);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { globalThis.__audioQA.setMotion(false); globalThis.__audioQA.blind(1); });
  await page.waitForTimeout(250);
  assert.equal((await state(page)).blindMoving, true);
  assert.ok(await energy(page) > 0.000001);
  await page.waitForTimeout(1400);
  assert.equal((await state(page)).blindMoving, false);
  assert.ok(await energy(page) < 0.000001);
  await page.evaluate(() => globalThis.__audioQA.setMotion(true));
  await volume(page, 'ambience', 25);
  checks.push('날씨·교통량·거리·블라인드 감쇠가 반영되고 천 마찰음은 이동 중에만 출력된다');
  await page.click('#sound-toggle');
  await page.waitForFunction(() => globalThis.__audioQA.roomAudio.state.context === 'suspended');
  await page.click('#sound-toggle');
  await page.waitForFunction(() => globalThis.__audioQA.roomAudio.state.context === 'running');
  assert.equal(requests.length, filesRequested);
  assert.equal((await state(page)).loops, 4);
  checks.push('음소거는 컨텍스트를 정지하고 재활성화는 파일 요청이나 반복음을 중복 생성하지 않는다');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => globalThis.__audioQA.roomAudio.state.context === 'suspended');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => globalThis.__audioQA.roomAudio.state.context === 'running');
  checks.push('문서 숨김 상태를 주입한 검사에서 정지·복귀가 동작한다');
  await volume(page, 'master', 42);
  await page.reload();
  await page.waitForFunction(() => globalThis.__audioQA?.mode === 'ready');
  assert.equal((await state(page)).context, 'uninitialized');
  assert.equal(await page.inputValue('#sound-master'), '42');
  assert.equal(await page.isChecked('#sound-enabled'), true);
  await page.click('#enter-button');
  await page.waitForFunction(() => globalThis.__audioQA.roomAudio.state.loaded === 5);
  checks.push('저장한 설정은 복원되며 다시 방문했을 때 입장 클릭까지 재생을 기다린다');
  await page.click('#view-settings summary');
  await page.locator('#environment-review').evaluate(element => { element.open = false; });
  await page.locator('#sound-reset').click();
  assert.equal(await page.isChecked('#sound-enabled'), false);
  assert.equal(await page.inputValue('#sound-master'), '50');
  assert.equal(await page.inputValue('#sound-effects'), '70');
  assert.equal(await page.inputValue('#sound-ambience'), '25');
  await page.screenshot({ path: path.join(output, 'settings-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sound-reset').scrollIntoViewIfNeeded();
  await page.locator('#sound-reset').click();
  assert.ok(await page.locator('#sound-reset').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'settings-small.png') });
  checks.push('소리 초기화와 390px 설정창 스크롤·가로 넘침을 확인한다');
  const failure = await browser.newPage();
  let rejectSwitch = true;
  await failure.route('**/assets/audio/switch.mp3', route => rejectSwitch ? route.fulfill({ status: 404, body: '' }) : route.continue());
  await prepare(failure);
  await failure.click('#sound-toggle');
  await failure.waitForFunction(() => document.querySelector('#sound-status').textContent.includes('일부 소리'));
  assert.equal((await state(failure)).loaded, 4);
  rejectSwitch = false;
  await failure.click('#sound-toggle'); await failure.click('#sound-toggle');
  await failure.waitForFunction(() => globalThis.__audioQA.roomAudio.state.loaded === 5);
  checks.push('음원 하나의 실패가 방을 막지 않으며 소리를 다시 켜면 실패한 파일만 재시도한다');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors }));
} catch (error) {
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify({ passed: false, checks, errors, failure: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }
