import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/final-code-check-2026-09-14/window-sky');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
fs.mkdirSync(output, { recursive: true });
const hook = `
globalThis.__windowSkyQA = {
  get ready() { return mode === 'ready'; },
  prepare() {
    renderer.setAnimationLoop(null); setMode('explore');
    autoQualityEnabled = false; renderer.setPixelRatio(1); resize();
    document.querySelectorAll('#room > :not(canvas)').forEach(el => { el.style.visibility = 'hidden'; });
  },
  capture(iso, object, cover, texel, close) {
    globalThis.__skyDate = Date.parse(iso); applyEnvironmentTime();
    exterior.setWeather({ condition: 'clear', cloudCover: cover, windSpeed: 0, windFromDegrees: 0 });
    exterior.sky.update(40);
    opening = openingTarget = 0.88; applyBlind();
    const position = close ? moveCircle(START, { x: 0, z: -1.62 - START.z }, obstacles) : START;
    camera.position.set(position.x, PLAYER_HEIGHT, position.z);
    const uniforms = exterior.sky.mesh.material.uniforms;
    const value = object === 'moon' ? uniforms.uMoon.value : uniforms.uSun.value;
    const original = value.clone(), center = original.clone().multiplyScalar(450);
    camera.lookAt(original.y > 0 ? center : new THREE.Vector3(0, 2, -100));
    yaw = camera.rotation.y; pitch = THREE.MathUtils.clamp(camera.rotation.x, -1.30, 1.30);
    camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(camera.position, center.clone().sub(camera.position).normalize());
    const hits = ray.intersectObject(root, true).filter(hit => hit.object.isMesh).slice(0,8).map(hit => ({
      name: hit.object.name, distance: hit.distance,
      materials: (Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material]).map(m => ({ name: m.name, opacity: m.opacity, transmission: m.transmission || 0 }))
    }));
    texelSplat.setEnabled(texel);
    const gl = renderer.getContext();
    function draw() {
      texelSplat.invalidate();
      for (let i = 0; i < (texel ? 4 : 1); i++) { texelSplat.render(i / 10); interactionOutline.render(0); }
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    }
    const withObject = draw(); value.set(0, -1, 0); const without = draw(); value.copy(original); draw();
    let changedPixels = 0, maxDifference = 0;
    for (let i = 0; i < withObject.length; i += 4) {
      const difference = Math.max(Math.abs(withObject[i] - without[i]), Math.abs(withObject[i + 1] - without[i + 1]), Math.abs(withObject[i + 2] - without[i + 2]));
      if (difference > 8) changedPixels++;
      maxDifference = Math.max(maxDifference, difference);
    }
    return { iso, object, cover, texel, close, direction: original.toArray(), altitude: THREE.MathUtils.radToDeg(Math.asin(original.y)),
      phase: exterior.sky.state.moonPhase, fraction: exterior.sky.state.moonIlluminatedFraction,
      camera: camera.position.toArray(), pitch: THREE.MathUtils.radToDeg(pitch), changedPixels, maxDifference, hits, glError: gl.getError() };
  }
};`;
const source = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + hook;
const results = [];
for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
  const result = { browser: name, cases: [], errors: [], passed: false };
  results.push(result);
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => result.errors.push(error.message));
    await page.addInitScript(() => {
      const OriginalDate = Date;
      globalThis.__skyDate = OriginalDate.parse('2026-09-14T14:00:00+09:00');
      globalThis.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [globalThis.__skyDate])); }
        static now() { return globalThis.__skyDate; }
      };
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/room-preview/app.mjs')) return route.fulfill({ contentType: 'text/javascript', body: source });
      if (url.origin !== new URL(base).origin || url.pathname.includes('/api/')) return route.abort();
      return route.continue();
    });
    await page.goto(new URL('room-preview/?review=1', base).href);
    await page.waitForFunction(() => globalThis.__windowSkyQA?.ready);
    await page.evaluate(() => globalThis.__windowSkyQA.prepare());
    for (const [id, iso, object, cover, texel, close, expectedVisible] of [
      ['sun-window', '2026-09-14T12:00:00+09:00', 'sun', 0, false, true, true],
      ['moon-day', '2026-09-14T14:00:00+09:00', 'moon', 0, false, true, false],
      ['moon-day-texel', '2026-09-14T14:00:00+09:00', 'moon', 0, true, true, false],
      ['moon-evening', '2026-09-14T18:30:00+09:00', 'moon', 0, false, true, false],
      ['moon-after-sunset', '2026-09-14T19:00:00+09:00', 'moon', 0, false, true, true],
      ['moon-early-night', '2026-09-14T20:30:00+09:00', 'moon', 0, false, true, true],
      ['moon-night', '2026-09-14T22:00:00+09:00', 'moon', 0, false, true, true],
      ['moon-2359', '2026-09-14T23:59:00+09:00', 'moon', 0, false, true, true],
      ['moon-2359-texel', '2026-09-14T23:59:00+09:00', 'moon', 0, true, true, true],
      ['moon-after-midnight', '2026-09-15T02:00:00+09:00', 'moon', 0, false, true, true],
      ['moon-dawn', '2026-09-15T04:00:00+09:00', 'moon', 0, false, true, true],
      ['moon-quarter', '2026-09-18T20:00:00+09:00', 'moon', 0, false, true, true],
      ['moon-full', '2026-09-27T00:00:00+09:00', 'moon', 0, false, true, true],
      ['moon-overcast', '2026-09-27T00:00:00+09:00', 'moon', 1, false, true, false],
      ['moon-texel', '2026-09-27T00:00:00+09:00', 'moon', 0, true, true, true],
      ['moon-room-center', '2026-09-27T00:00:00+09:00', 'moon', 0, false, false, null]
    ]) {
      const row = await page.evaluate(args => globalThis.__windowSkyQA.capture(...args), [iso, object, cover, texel, close]);
      result.cases.push({ id, expectedVisible, ...row });
      await page.screenshot({ path: path.join(output, name + '-' + id + '.png') });
    }
    assert.deepEqual(result.errors, []);
    for (const row of result.cases) {
      assert.equal(row.glError, 0, row.id);
      if (row.expectedVisible !== null) assert.equal(row.changedPixels > 0, row.expectedVisible, row.id);
    }
    result.passed = true;
  } catch (error) {
    result.failure = error.stack;
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2));
  }
}
console.log(JSON.stringify(results.map(r => ({ browser: r.browser, passed: r.passed, failure: r.failure, cases: r.cases.map(c => ({ id: c.id, pixels: c.changedPixels, altitude: c.altitude, camera: c.camera })) })), null, 2));
