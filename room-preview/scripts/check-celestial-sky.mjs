import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../docs/celestial-sky');
const url = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const errors = [], failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/__celestial-check', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
  await page.goto(url + '/__celestial-check');
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createWeatherSky, seoulMoonState } = await import('/weather-sky.mjs');
    const { DEFAULT_WEATHER } = await import('/seoul-weather.mjs');
    const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
    const sky = createWeatherSky(new THREE.Color('#101d34'), new THREE.Color('#304055'));
    const scene = new THREE.Scene(); scene.add(sky.mesh);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(640, 640); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.025, 520);
    const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene(); effect.resize();
    const gl = renderer.getContext(), uniforms = sky.mesh.material.uniforms;
    const frames = [], phases = [], stars = [], moons = [];
    let time = 0;
    function weather(cover, wind = 0, seconds = 30) {
      sky.setWeather({ ...DEFAULT_WEATHER, cloudCover: cover, windSpeed: wind, windFromDegrees: 90 }); sky.update(seconds);
    }
    function render(texel) {
      effect.setEnabled(texel); effect.invalidate();
      for (let i = 0; i < 4; i++) { time += 0.1; effect.render(time); }
      gl.finish();
      const pixels = new Uint8Array(640 * 640 * 4); gl.readPixels(0, 0, 640, 640, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    }
    function picture(name) { frames.push({ name, data: renderer.domElement.toDataURL('image/png') }); }
    function brightness(pixels, offset) { return (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3; }
    function signal(withObject, withoutObject) {
      const values = new Float32Array(640 * 640); let count = 0, flux = 0;
      for (let i = 0; i < values.length; i++) {
        values[i] = Math.max(0, brightness(withObject, i * 4) - brightness(withoutObject, i * 4));
        flux += values[i]; if (values[i] > 12) count++;
      }
      return { values, count, flux };
    }
    weather(0);
    for (const [name, label, date] of [
      ['crescent', '초승달', '2026-09-15T19:00:00+09:00'], ['quarter', '상현 무렵', '2026-09-18T20:00:00+09:00'],
      ['full', '보름달', '2026-09-27T00:00:00+09:00'], ['last-quarter', '하현 무렵', '2026-10-04T04:00:00+09:00'],
      ['waning', '그믐달', '2026-10-08T05:00:00+09:00'],
    ]) {
      const moon = seoulMoonState(new Date(date)); sky.setTime(new Date(date), { day: 0 }); uniforms.uStars.value = 0;
      // 위상 면적 검사는 노을색이 밝기 판정에 섞이지 않는 동일한 밤 배경에서 수행한다.
      uniforms.uSunset.value = 0;
      camera.fov = 7; camera.updateProjectionMatrix(); camera.lookAt(moon.direction); const pixels = render(false); picture('moon-' + name);
      const radius = Math.tan(Math.asin(0.02443)) * 320 / Math.tan(THREE.MathUtils.degToRad(3.5));
      let lit = 0, area = 0;
      for (let y = 0; y < 640; y++) for (let x = 0; x < 640; x++) if (Math.hypot(x + 0.5 - 320, y + 0.5 - 320) < radius) {
        area++; if (brightness(pixels, (y * 640 + x) * 4) > 110) lit++;
      }
      phases.push({ name, label, date, expectedFraction: moon.fraction, renderedFraction: lit / area });
      if (name === 'crescent' || name === 'full') { render(true); picture('moon-' + name + '-texel'); }
    }
    camera.fov = 70; camera.updateProjectionMatrix(); camera.lookAt(0, 0.6, 0.8);
    for (const texel of [false, true]) {
      const night = new Date('2026-09-12T00:00:00+09:00'); sky.setTime(night, { day: 0 }); uniforms.uCloudShift.value.set(0, 0);
      function starSignal(cover, name, wind = 0, seconds = 30) {
        weather(cover, wind, seconds); uniforms.uStars.value = 1; const lit = render(texel);
        if (name) picture(name + (texel ? '-texel' : ''));
        uniforms.uStars.value = 0; return signal(lit, render(texel));
      }
      const clear = starSignal(0, 'stars-clear');
      sky.setTime(new Date('2026-09-12T03:00:00+09:00'), { day: 0 });
      const later = starSignal(0);
      let difference = 0; for (let i = 0; i < clear.values.length; i++) difference += Math.abs(clear.values[i] - later.values[i]);
      const cloudy = starSignal(0.65, 'stars-clouds');
      const moving = starSignal(0.65, 'stars-moving-clouds', 2, 120);
      let movingDifference = 0; for (let i = 0; i < clear.values.length; i++) movingDifference += Math.abs(cloudy.values[i] - moving.values[i]);
      const overcast = starSignal(1, 'stars-overcast');
      stars.push({ texel, clearPixels: clear.count, fixedMeanDifference: difference / clear.values.length, cloudFluxRatio: cloudy.flux / clear.flux,
        movingCloudDifference: movingDifference / clear.flux, overcastFluxRatio: overcast.flux / clear.flux });

      const full = new Date('2026-09-27T00:00:00+09:00'); sky.setTime(full, { day: 0 }); uniforms.uStars.value = 0;
      const direction = uniforms.uMoon.value.clone(); camera.fov = 7; camera.updateProjectionMatrix(); camera.lookAt(direction);
      function moonSignal(cover, name) {
        weather(cover); uniforms.uMoon.value.copy(direction); const lit = render(texel);
        if (name) picture(name + (texel ? '-texel' : ''));
        uniforms.uMoon.value.set(0, -1, 0); return signal(lit, render(texel));
      }
      const moonClear = moonSignal(0), moonCloud = moonSignal(0.8, 'moon-clouds'), moonOvercast = moonSignal(1, 'moon-overcast');
      moons.push({ texel, clearFlux: moonClear.flux, cloudFluxRatio: moonCloud.flux / moonClear.flux, overcastFluxRatio: moonOvercast.flux / moonClear.flux });
      camera.fov = 70; camera.updateProjectionMatrix(); camera.lookAt(0, 0.6, 0.8);
    }
    const glError = gl.getError(); effect.dispose(); renderer.dispose(); sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
    return { phases, stars, moons, frames, glError };
  });
  for (const phase of result.phases) if (Math.abs(phase.renderedFraction - phase.expectedFraction) > 0.055) failures.push(phase.label + '의 밝은 면 비율 불일치');
  for (const stars of result.stars) {
    if (stars.clearPixels < 20) failures.push('밤하늘에서 별이 충분히 보이지 않음');
    if (stars.fixedMeanDifference > 0.05) failures.push('고정 별의 위치 또는 밝기가 시간만으로 변경됨');
    if (!(stars.cloudFluxRatio > 0.01 && stars.cloudFluxRatio < 0.9)) failures.push('부분 구름이 별을 위치별로 가리지 못함');
    if (stars.movingCloudDifference < 0.05) failures.push('이동 구름에 따른 별 가림 변화가 없음');
    if (stars.overcastFluxRatio > 0.01) failures.push('흐림에서 별이 남아 있음');
  }
  for (const moon of result.moons) {
    if (!(moon.cloudFluxRatio > 0.005 && moon.cloudFluxRatio < 0.95)) failures.push('부분 구름이 달을 가리지 못함');
    if (moon.overcastFluxRatio > 0.01) failures.push('흐림에서 달이 남아 있음');
  }
  if (result.glError) failures.push('하늘 WebGL 오류');
  for (const frame of result.frames) fs.writeFileSync(path.join(output, frame.name + '.png'), Buffer.from(frame.data.split(',')[1], 'base64'));
  const sheet = await browser.newPage({ viewport: { width: 1200, height: 340 }, deviceScaleFactor: 1 });
  await sheet.setContent('<html lang="ko"><meta charset="utf-8"><style>body{margin:0;background:#111d31;color:#e3e8ee;font-family:sans-serif}h1{font-size:18px;font-weight:500;margin:20px 26px 0}main{display:flex;padding:0 20px}figure{margin:0;width:232px;text-align:center}img{width:232px;height:232px;display:block}figcaption{font-size:16px}small{font-size:12px;color:#9daab9}</style><h1>날짜에 따라 변하는 달 · 위상 형태 확인용 확대</h1><main>' + result.phases.map(phase => '<figure><img src="' + result.frames.find(frame => frame.name === 'moon-' + phase.name).data + '"><figcaption>' + phase.label + '</figcaption><small>밝은 면 ' + Math.round(phase.expectedFraction * 100) + '%</small></figure>').join('') + '</main></html>');
  await sheet.screenshot({ path: path.join(output, 'moon-phases.png') }); await sheet.close();
  result.frames = result.frames.map(frame => frame.name + '.png'); result.errors = errors; result.failures = failures;
  fs.writeFileSync(path.join(root, 'celestial-sky-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (errors.length || failures.length) process.exitCode = 1;
} finally { await browser.close(); }
