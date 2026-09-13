import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/review-mode-2026-09-13');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const checks = [], errors = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  await context.addInitScript(() => {
    const OriginalDate = Date;
    globalThis.__realReviewNow = OriginalDate.parse('2026-09-13T22:15:00+09:00');
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [globalThis.__realReviewNow])); }
      static now() { return globalThis.__realReviewNow; }
    };
    HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error('검사용 드래그'));
  });
  const app = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + '\nglobalThis.__reviewQA = {renderer,camera,exterior,streetLife,precipitation,texelSplat,targets,moodLightController,seoulWeather,seoulTraffic,applyMoodLamp,environmentDate,environmentMoodController,get review(){return review;},get mode(){return mode;},get ceilingLamp(){return ceilingLamp;},get moodLamp(){return moodLamp;}};';
  await context.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: app }));
  let liveKind = 'cloudy', weatherRequests = 0;
  await context.route('**/api/seoul-weather', route => {
    weatherRequests++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ properties: {
      meta: { updated_at: '2026-09-13T13:00:00Z', units: { cloud_area_fraction: '%', wind_speed: 'm/s', wind_from_direction: 'degrees', precipitation_amount: 'mm' } },
      timeseries: [{ time: '2026-09-13T13:00:00Z', data: {
        instant: { details: { cloud_area_fraction: 100, wind_speed: 2, wind_from_direction: 270 } },
        next_1_hours: { summary: { symbol_code: liveKind }, details: { precipitation_amount: liveKind === 'snow' ? 1 : 0 } }
      } }]
    } }) });
  });
  await context.route('**/api/seoul-traffic', route => route.fulfill({ contentType: 'application/json', body: '{"source":"schedule","reason":"unconfigured"}' }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type()) && /WebGL|GL_INVALID|THREE/.test(message.text())) errors.push(message.text()); });
  await page.goto(new URL('room-preview/', base).href);
  await page.waitForFunction(() => globalThis.__reviewQA?.mode === 'ready');
  checks.push({ name: '일반 로컬 화면에 검수 메뉴 없음', pass: await page.locator('#environment-review').count() === 0 });
  await page.goto(new URL('room-preview/?review=1', base).href);
  await page.waitForFunction(() => globalThis.__reviewQA?.mode === 'ready');
  await page.waitForFunction(() => document.querySelector('#weather-description').textContent.includes('흐림'));
  checks.push({ name: '명시한 로컬 검수 주소에서만 메뉴 표시', pass: await page.locator('#environment-review').isVisible() });
  await page.locator('#enter-button').click();
  const live = await page.evaluate(() => {
    const q = __reviewQA;
    q.moodLightController.toggle(); q.applyMoodLamp();
    q.ceilingLamp.setOn(true);
    q.originalBuffers = q.streetLife.root.children.map(mesh => mesh.instanceMatrix.array);
    return { time: Date.now(), weather: localStorage.getItem('lifebalance.seoul-weather.v1'),
      traffic: JSON.stringify(q.seoulTraffic.state), moodOn: q.moodLightController.read().on };
  });
  await page.locator('#review-date').fill('2031-06-20'); await page.locator('#review-date').press('Tab');
  await page.locator('[data-preset="noon"]').click();
  const day = await page.evaluate(() => ({ date: __reviewQA.environmentDate().toISOString(), stars: __reviewQA.exterior.sky.mesh.material.uniforms.uStars.value, mood: __reviewQA.moodLamp.light.intensity }));
  checks.push({ name: '선택 날짜의 낮과 자동 조명 반영', pass: day.date === '2031-06-20T03:00:00.000Z' && day.stars < 0.01 && day.mood === 0 });
  await page.locator('#review-weather').selectOption('rain');
  await page.locator('#review-rate').fill('6');
  await page.locator('#review-rate').dispatchEvent('input');
  await page.waitForFunction(() => __reviewQA.precipitation.state.rain > 0.3);
  checks.push({ name: '검수 비와 실제 시계·저장 예보 분리', pass: await page.evaluate(live =>
    Date.now() === live.time && localStorage.getItem('lifebalance.seoul-weather.v1') === live.weather
      && document.querySelector('#weather-description').textContent === '검수 · 비', live) });
  await page.locator('[data-preset="morning"]').click();
  checks.push({ name: '아침 러시아워 즉시 재배치', pass: await page.evaluate(() => __reviewQA.streetLife.trafficState.active === 20 && __reviewQA.streetLife.roadFlow.state.rush === 1 && __reviewQA.streetLife.roadFlow.state.reverseRush === 0) });
  await page.locator('[data-preset="evening"]').click();
  checks.push({ name: '저녁 러시아워 방향 전환', pass: await page.evaluate(() => __reviewQA.streetLife.trafficState.active === 20 && __reviewQA.streetLife.roadFlow.state.rush === 0 && __reviewQA.streetLife.roadFlow.state.reverseRush === 1) });
  await page.locator('#review-weather').selectOption('fair');
  await page.locator('[data-preset="sunset"]').click();
  checks.push({ name: '선택 날짜 일몰 직전 노을', pass: await page.evaluate(() => __reviewQA.exterior.sky.state.sunsetStrength > 0.5) });
  await page.screenshot({ path: path.join(output, 'sunset-review.png') });
  await page.locator('#review-weather').selectOption('snow');
  await page.locator('[data-preset="night"]').click();
  await page.waitForFunction(() => __reviewQA.precipitation.state.snow > 0.3);
  await page.locator('#view-settings summary').click(); await page.locator('#reduce-motion').check();
  checks.push({ name: '동작 줄이기 우선 및 숨김 이유 표시', pass: await page.locator('#review-motion-note').innerText().then(text => text.includes('동작 줄이기')) });
  await page.locator('#reduce-motion').uncheck(); await page.locator('#view-settings summary').click();
  await page.evaluate(() => {
    const q = __reviewQA; q.camera.position.set(-0.06, 1.35, 0.3);
    q.camera.lookAt(q.targets.find(target => target.id === 'lamp').box.getCenter(q.camera.position.clone()));
    document.querySelector('#view').focus();
  });
  await page.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('무드등'));
  await page.keyboard.press('KeyF');
  const isolatedMood = await page.evaluate(() => __reviewQA.moodLightController.read().on === false && __reviewQA.environmentMoodController().read(__reviewQA.environmentDate()).on === false);
  checks.push({ name: '검수 중 무드등 조작이 실제 시간용 상태를 변경하지 않음', pass: isolatedMood });
  await page.locator('#review-weather').selectOption('rain');
  liveKind = 'snow';
  await page.evaluate(() => __reviewQA.seoulWeather.refresh(true));
  checks.push({ name: '비동기 실제 예보 갱신이 검수 날씨를 덮어쓰지 않음', pass: await page.locator('#weather-description').innerText() === '검수 · 비' });
  await page.locator('#review-reset').click();
  const restored = await page.evaluate(() => ({ active: __reviewQA.review.state.active, time: __reviewQA.environmentDate().getTime(),
    weather: document.querySelector('#weather-description').textContent, mood: __reviewQA.moodLightController.read().on,
    traffic: JSON.stringify(__reviewQA.seoulTraffic.state), ceiling: __reviewQA.ceilingLamp.on,
    reused: __reviewQA.streetLife.root.children.every((mesh, i) => mesh.instanceMatrix.array === __reviewQA.originalBuffers[i]) }));
  checks.push({ name: '실제 서울 시간·최신 예보·기존 조명 상태로 복귀', pass: !restored.active && restored.time === live.time && restored.weather.includes('서울 · 눈') && restored.mood === live.moodOn && restored.traffic === live.traffic && restored.ceiling && restored.reused });
  await page.locator('#review-time-slider').fill('120'); await page.locator('#review-time-slider').dispatchEvent('input');
  checks.push({ name: '슬라이더 심야 시각과 적은 교통량', pass: await page.evaluate(() => __reviewQA.streetLife.trafficState.active === 2 && document.querySelector('#review-time').value === '02:00') });
  await page.reload(); await page.waitForFunction(() => globalThis.__reviewQA?.mode === 'ready');
  checks.push({ name: '새로고침은 검수값을 복원하지 않음', pass: await page.evaluate(() => !__reviewQA.review.state.active && __reviewQA.review.state.fixedTime === null) });
  await page.screenshot({ path: path.join(output, 'review-menu.png') });
  const report = { checkedAt: new Date().toISOString(), checks, errors, weatherRequests,
    scope: '독립 자동 브라우저 검사. 테스트 브라우저의 기준 시각만 고정했으며 운영체제 시계와 실제 사용자 저장소는 변경하지 않음.' };
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (errors.length || checks.some(check => !check.pass)) process.exitCode = 1;
} finally { await browser.close(); }
