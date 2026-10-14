import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../docs/weather');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const url = process.argv[2] || 'http://127.0.0.1:4173';
const errors = [], failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/__weather-check', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
  await page.goto(url + '/__weather-check');
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createExterior } = await import('/exterior.mjs');
    const { DEFAULT_WEATHER } = await import('/seoul-weather.mjs');
    const { seoulSunDirection } = await import('/weather-sky.mjs');
    const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
    const scene = new THREE.Scene();
    const exterior = createExterior(); scene.add(exterior.root); scene.fog = exterior.fog;
    const width = 1280, height = 800;
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
    renderer.setSize(width, height); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.025, 520);
    camera.position.set(0, 1.35, -1.4);
    const morning = new Date('2026-09-12T09:00:00+09:00');
    const sun = seoulSunDirection(morning);
    camera.lookAt(sun.clone().multiplyScalar(450));
    const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene(); effect.resize();
    const gl = renderer.getContext();
    const frames = [];
    let time = 0;
    for (const [name, cover, condition, date] of [
      ['clear', 0, 'clear', morning], ['partly-cloudy', 0.55, 'cloudy', morning],
      ['overcast', 1, 'overcast', morning], ['night', 0.55, 'cloudy', new Date('2026-09-12T21:00:00+09:00')],
    ]) {
      exterior.setWeather({ ...DEFAULT_WEATHER, cloudCover: cover, condition, windSpeed: 2, windFromDegrees: 110 });
      exterior.setTime(date); exterior.update(24);
      for (const enabled of [false, true]) {
        effect.setEnabled(enabled); time += 1; effect.render(time); effect.render(time + 0.3);
        const center = new Uint8Array(4);
        gl.readPixels(width / 2, height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
        frames.push({ name: name + (enabled ? '-texel' : ''), center: Array.from(center), sky: exterior.sky.state, image: renderer.domElement.toDataURL('image/png').split(',')[1] });
      }
    }
    const glError = gl.getError(); effect.dispose(); renderer.dispose();
    return { frames, glError };
  });
  for (const frame of result.frames) {
    fs.writeFileSync(path.join(output, frame.name + '.png'), Buffer.from(frame.image, 'base64'));
    delete frame.image;
  }
  const brightness = name => result.frames.find(frame => frame.name === name).center.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
  if (brightness('clear') < brightness('overcast') + 15) failures.push('흐림에서 태양이 충분히 가려지지 않음');
  if (brightness('night') > brightness('clear') * 0.7) failures.push('밤의 태양 숨김 또는 하늘 밝기 오류');
  if (result.glError) failures.push('하늘 WebGL 오류');

  await page.goto(url + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('#weather-description').textContent.includes('확인 중'));
  const liveLabel = await page.locator('#weather-description').textContent();
  const response = await page.request.get(url + '/api/seoul-weather');
  const payload = await response.json();
  const updatedAt = payload.properties?.meta?.updated_at || null;
  const live = { status: response.status(), label: liveLabel, updatedAt };
  await page.context().setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForFunction(() => /최근 예보|연결 대기/.test(document.querySelector('#weather-description').textContent));
  const offlineLabel = await page.locator('#weather-description').textContent();
  await page.context().setOffline(false);
  if (response.ok() && !liveLabel.includes('연결 대기') && !offlineLabel.includes('최근 예보')) failures.push('연결 끊김에서 저장 예보를 유지하지 않음');
  if (errors.length) failures.push('브라우저 그래픽 오류');
  const report = { checkedAt: new Date().toISOString(), result, live, offlineLabel, errors, failures };
  fs.writeFileSync(path.join(root, 'weather-webgl-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally { await browser.close(); }
