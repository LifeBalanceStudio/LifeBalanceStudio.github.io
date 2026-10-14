import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/completion-2026-09-12');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const errors = [], checks = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type()) && /WebGL|GL_INVALID|THREE/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    const OriginalDate = Date;
    globalThis.__qaTime = OriginalDate.parse('2026-09-12T22:15:00+09:00');
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [globalThis.__qaTime])); }
      static now() { return globalThis.__qaTime; }
    };
  });
  await page.route('**/api/seoul-weather', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ properties: {
    meta: { updated_at: '2026-09-12T13:00:00Z', units: { cloud_area_fraction: '%', wind_speed: 'm/s', wind_from_direction: 'degrees', precipitation_amount: 'mm' } },
    timeseries: [{ time: '2026-09-12T13:00:00Z', data: { instant: { details: { cloud_area_fraction: 35, wind_speed: 2, wind_from_direction: 90 } }, next_1_hours: { summary: { symbol_code: 'partlycloudy_night' }, details: { precipitation_amount: 0 } } } }]
  } }) }));
  await page.route('**/api/seoul-traffic', route => route.fulfill({ contentType: 'application/json', body: '{"source":"schedule","reason":"unconfigured"}' }));
  await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body:
    fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + '\nglobalThis.__roomQA = {renderer, scene, camera, exterior, exteriorBatch, precipitation, streetLife, texelSplat, interactionOutline, setMode, refreshTVControls, get tv() {return tvMenu;}, get root() {return root;}};'
  }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '@font-face{font-family:"Press Start 2P";src:url("' + base + 'room-preview/assets/fonts/PressStart2P-Regular.ttf");}' }));
  await page.goto(new URL('classic.html', base).href);
  await page.locator('#gameList').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, 'img/classic-preview.png') });
  checks.push({ name: '기존 홈페이지 진입', pass: await page.locator('#gameList a').count() >= 4 });
  await page.goto(new URL('room-preview/', base).href);
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled && globalThis.__roomQA?.root);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('#room > :not(canvas)').forEach(element => { element.style.visibility = 'hidden'; }));
  await page.screenshot({ path: path.join(root, 'img/room-preview.png') });
  await page.evaluate(() => document.querySelectorAll('#room > :not(canvas)').forEach(element => { element.style.visibility = ''; }));
  checks.push({ name: '방 로딩과 정적 경로', pass: await page.locator('#enter-button').innerText() === '방 둘러보기' });
  await page.locator('#view-settings summary').click();
  await page.locator('#low-power').check();
  checks.push({ name: '절전 설정과 저장', pass: await page.evaluate(() => __roomQA.renderer.getPixelRatio() <= 1 && JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')).lowPower) });
  await page.locator('#reduce-motion').check();
  await page.waitForTimeout(100);
  checks.push({ name: '동작 줄이기', pass: await page.evaluate(() => !__roomQA.streetLife.root.visible && !__roomQA.precipitation.root.visible) });
  await page.locator('#reduce-motion').uncheck(); await page.locator('#low-power').uncheck();
  await page.locator('#view-settings summary').click();
  await page.evaluate(() => { const q = __roomQA; q.renderer.setAnimationLoop(null); q.tv.setActive(true); q.setMode('tv'); q.tv.choose(); q.tv.choose(); q.refreshTVControls(); });
  checks.push({ name: 'TV 상세와 공개 게임 링크', pass: await page.locator('#tv-game-link').isVisible() && (await page.locator('#tv-game-link').getAttribute('href')).includes('com.LifeBalance.Uncap') });
  await page.locator('#tv-back').focus(); await page.keyboard.press('Space');
  checks.push({ name: 'TV 복귀 버튼의 키보드 동작', pass: await page.evaluate(() => __roomQA.tv.stage === 'games') });
  const particles = await page.evaluate(() => {
    const q = __roomQA; q.setMode('ready'); q.camera.position.set(0.08, 1.35, -1.6); q.camera.lookAt(-4, -8, -24);
    const frames = [];
    for (const kind of ['rain', 'snow']) {
      q.precipitation.setWeather({ condition: kind, precipitationRate: 6, windSpeed: 3, windFromDegrees: 90 });
      for (let i = 0; i < 250; i++) q.precipitation.update(0.05);
      for (const texel of [false, true]) {
        q.texelSplat.setEnabled(texel); q.texelSplat.invalidate(); q.texelSplat.render(100);
        const gl = q.renderer.getContext(); gl.finish();
        frames.push({ kind, texel, error: gl.getError(), image: q.renderer.domElement.toDataURL('image/png'), state: q.precipitation.state });
      }
    }
    return frames;
  });
  for (const frame of particles) {
    fs.writeFileSync(path.join(output, frame.kind + (frame.texel ? '-texel' : '') + '.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
    checks.push({ name: `${frame.kind === 'rain' ? '비' : '눈'} ${frame.texel ? '텍셀' : '일반'} 렌더링`, pass: frame.error === 0 && frame.state.visible });
  }
  const rendering = await page.evaluate(() => {
    const q = __roomQA, renderer = q.renderer, gl = renderer.getContext();
    const width = renderer.domElement.width, height = renderer.domElement.height;
    const first = new Uint8Array(width * height * 4), second = new Uint8Array(first.length);
    const compare = (a, b, bottomOnly = false) => {
      let sum = 0, changed = 0, count = 0;
      const rows = bottomOnly ? Math.floor(height * 0.14) : height;
      for (let i = 0; i < width * rows * 4; i += 4) {
        let delta = 0;
        for (let channel = 0; channel < 3; channel++) { const d = Math.abs(a[i + channel] - b[i + channel]); sum += d; delta = Math.max(delta, d); }
        if (delta > 8) changed++;
        count++;
      }
      return { mean: sum / (count * 3), changedFraction: changed / count };
    };
    const draw = (batch, texel, destination) => {
      q.exteriorBatch.setEnabled(batch); q.texelSplat.setEnabled(texel); q.texelSplat.invalidate();
      renderer.info.reset(); q.texelSplat.render(100); gl.finish();
      if (destination) gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, destination);
    };
    renderer.info.autoReset = false;
    q.precipitation.root.visible = false;
    const preservation = [];
    for (const date of ['2026-09-12T12:00:00+09:00', '2026-09-12T22:15:00+09:00']) {
      q.exterior.setTime(new Date(date));
      for (const texel of [false, true]) {
        draw(false, texel, first); draw(true, texel, second);
        preservation.push({ date, texel, ...compare(first, second) });
      }
    }
    const timing = [];
    const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)];
    for (const texel of [false, true]) {
      const samples = [[], []], calls = [];
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const enabled of repeat % 2 ? [true, false] : [false, true]) {
          for (let i = 0; i < 8; i++) draw(enabled, texel);
          for (let i = 0; i < 24; i++) { const start = performance.now(); draw(enabled, texel); samples[Number(enabled)].push(performance.now() - start); }
          calls[Number(enabled)] = renderer.info.render.calls;
        }
      }
      timing.push({ texel, before: { median: percentile(samples[0], 0.5), p95: percentile(samples[0], 0.95), calls: calls[0] },
        after: { median: percentile(samples[1], 0.5), p95: percentile(samples[1], 0.95), calls: calls[1] } });
    }
    const indoors = [];
    for (const texel of [false, true]) {
      q.precipitation.root.visible = false; draw(true, texel, first);
      q.precipitation.root.visible = true; draw(true, texel, second);
      indoors.push({ texel, ...compare(first, second, true) });
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      sources: q.exteriorBatch.sourceCount, batches: q.exteriorBatch.batchCount, preservation, timing, indoors };
  });
  checks.push({ name: '묶음 처리 전후 화면 보존', pass: rendering.preservation.every(item => item.mean < 0.5 && item.changedFraction < 0.01) });
  checks.push({ name: '정적 배경 그리기 호출 감소', pass: rendering.timing.every(item => item.after.calls < item.before.calls) });
  checks.push({ name: '실내 바닥에 강수 유입 없음', pass: rendering.indoors.every(item => item.changedFraction < 0.001) });
  await page.goto(base);
  checks.push({ name: '진입 선택 경로', pass: await page.locator('a[href="room-preview/"]').count() === 1 && await page.locator('a[href="classic.html"]').count() === 1 });
  await page.screenshot({ path: path.join(output, 'entry-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  checks.push({ name: '모바일 진입 화면 가로 넘침', pass: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) });
  await page.screenshot({ path: path.join(output, 'entry-mobile.png'), fullPage: true });
  const report = { checkedAt: new Date().toISOString(), checks, rendering, errors, scope: '독립 자동 브라우저 검사. 배포·실기기 수동 검수는 제외.' };
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (errors.length || checks.some(check => !check.pass)) process.exitCode = 1;
} finally { await browser.close(); }
