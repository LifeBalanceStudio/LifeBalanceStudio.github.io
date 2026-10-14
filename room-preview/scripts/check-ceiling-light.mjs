import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/ceiling-light-2026-09-13');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const errors = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type()) && /WebGL|GL_INVALID|THREE/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    const OriginalDate = Date;
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ['2026-09-13T22:15:00+09:00'])); }
      static now() { return new OriginalDate('2026-09-13T22:15:00+09:00').getTime(); }
    };
    HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error('검사용 드래그 모드'));
  });
  await page.route('**/api/seoul-weather', route => route.fulfill({ status: 503, body: '{}' }));
  await page.route('**/api/seoul-traffic', route => route.fulfill({ contentType: 'application/json', body: '{"source":"schedule","reason":"unconfigured"}' }));
  await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body:
    fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + '\nglobalThis.__lampQA = {renderer, scene, camera, texelSplat, interactionOutline, get ceilingLamp(){return ceilingLamp;}, get moodLamp(){return moodLamp;}, get root(){return root;}, get mode(){return mode;}};'
  }));
  await page.goto(new URL('room-preview/', base).href);
  await page.waitForFunction(() => globalThis.__lampQA?.mode === 'ready');
  await page.locator('#enter-button').click();
  await page.evaluate(() => { const q = __lampQA; q.camera.position.set(0.3, 1.35, 0.5); q.camera.lookAt(0, 2.441, -0.05); });
  await page.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('천장등 켜기'));
  const initialOff = await page.evaluate(() => !__lampQA.ceilingLamp.on);
  await page.screenshot({ path: path.join(output, 'fixture-off.png') });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => __lampQA.ceilingLamp.on && document.querySelector('#action-prompt').textContent.includes('천장등 끄기'));
  await page.screenshot({ path: path.join(output, 'fixture-on.png') });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !__lampQA.ceilingLamp.on);
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => __lampQA.ceilingLamp.on && __lampQA.texelSplat.state.enabled);
  await page.screenshot({ path: path.join(output, 'fixture-on-texel.png') });
  const result = await page.evaluate(() => {
    const q = __lampQA, renderer = q.renderer, gl = renderer.getContext();
    renderer.setAnimationLoop(null); renderer.info.autoReset = false;
    q.camera.position.set(0.08, 1.35, 1.25); q.camera.rotation.set(-0.10, 0, 0, 'YXZ');
    const snapshots = [], comparisons = [];
    const pixels = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
    const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
    function render(kind, texel) {
      q.ceilingLamp.light.visible = kind !== 'reference'; q.ceilingLamp.setOn(kind === 'on');
      q.texelSplat.setEnabled(texel); q.texelSplat.invalidate(); renderer.info.reset(); q.texelSplat.render(100); gl.finish();
    }
    for (const texel of [false, true]) {
      const states = {};
      for (const kind of ['reference', 'off', 'on']) {
        for (let i = 0; i < 14; i++) render(kind, texel);
        const times = [];
        for (let i = 0; i < 32; i++) { const start = performance.now(); render(kind, texel); times.push(performance.now() - start); }
        gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let luminance = 0, count = 0;
        // 창밖과 TV를 피한 실내 하단 영역에서 점등 효과를 비교한다.
        for (let y = 0; y < renderer.domElement.height * 0.25; y++) for (let x = 0; x < renderer.domElement.width; x++) {
          const i = (y * renderer.domElement.width + x) * 4;
          luminance += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722; count++;
        }
        states[kind] = { medianMs: median(times), calls: renderer.info.render.calls, indoorLuminance: luminance / count };
        if (kind !== 'reference') snapshots.push({ name: 'room-' + kind + (texel ? '-texel' : ''), image: renderer.domElement.toDataURL('image/png') });
      }
      comparisons.push({ texel, states });
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { snapshots, comparisons, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      lightPosition: q.ceilingLamp.light.position.toArray(), lightSize: [q.ceilingLamp.light.width, q.ceilingLamp.light.height], glError: gl.getError() };
  });
  for (const snapshot of result.snapshots) fs.writeFileSync(path.join(output, snapshot.name + '.png'), Buffer.from(snapshot.image.split(',')[1], 'base64'));
  result.snapshots = result.snapshots.map(snapshot => snapshot.name + '.png');
  const report = { checkedAt: new Date().toISOString(), initialOff, keyboardF: true, keyboardSpace: true, texelInteraction: true,
    ...result, errors, scope: '독립 자동 브라우저의 실제 F/Space 상호작용과 렌더 비교. 실기기 수동 검수·공개 배포는 제외.' };
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (errors.length || !initialOff || result.glError || result.comparisons.some(item => item.states.on.indoorLuminance <= item.states.off.indoorLuminance * 1.1)) process.exitCode = 1;
} finally { await browser.close(); }
