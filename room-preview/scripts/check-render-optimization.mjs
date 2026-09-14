import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/render-optimization-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const results = [], errors = [];
const capture = `
  const originalLoop = renderer.setAnimationLoop.bind(renderer);
  renderer.setAnimationLoop = callback => { if (callback) globalThis.__renderStep = callback; originalLoop(callback); };`;
const hook = `
let diagnosticTime = 1000, diagnosticDate = new Date('2026-09-14T12:00:00+09:00');
globalThis.__renderQA = {
  get ready() { return mode === 'ready'; },
  freeze() {
    renderer.setAnimationLoop(null); renderer.info.autoReset = false;
    environmentDate = () => diagnosticDate;
    exterior.update = () => {};
    const updateLife = streetLife.update.bind(streetLife);
    streetLife.update = (_seconds, view) => updateLife(0, view);
    const drawOutline = interactionOutline.render.bind(interactionOutline);
    interactionOutline.render = () => drawOutline(0);
    tvMenu.draw();
  },
  configure(options) {
    setMode('explore'); setFpsLimit(120);
    lowPowerInput.checked = false; reducedMotionInput.checked = false; applyViewPreferences(false);
    diagnosticDate = new Date(options.night ? '2026-09-14T22:00:00+09:00' : '2026-09-14T12:00:00+09:00');
    liveWeather = { condition: 'clear', label: '맑음', cloudCover: 0.2, windSpeed: 0, windFromDegrees: 0, precipitationRate: 0 };
    liveTraffic = scheduledTraffic(diagnosticDate.getTime());
    applyEnvironmentWeather(); applyEnvironmentTime(); applyEnvironmentTraffic(true);
    opening = openingTarget = options.opening ?? 1; applyBlind();
    ceilingLamp.setOn(Boolean(options.ceiling));
    camera.position.fromArray(options.position || [0.08, 1.35, 1.25]);
    yaw = options.yaw || 0; pitch = options.pitch ?? -0.1; camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.fov = 70; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    texelSplat.setEnabled(Boolean(options.texel)); texelSplat.invalidate();
    nextMoodCheck = Infinity;
  },
  frame(finish = true) {
    nextRenderAt = 0; previousTime = diagnosticTime - 1000 / 60;
    renderer.info.reset(); globalThis.__renderStep(diagnosticTime); diagnosticTime += 1000 / 60;
    if (finish) renderer.getContext().finish();
    return { ...renderer.info.render };
  },
  async measure(count) {
    const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const wall = [], gpu = [], queries = []; let draws;
    for (let i = 0; i < count; i++) {
      const query = timer ? gl.createQuery() : null;
      if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      const start = performance.now(); draws = this.frame(false);
      if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
      gl.finish(); wall.push(performance.now() - start);
    }
    gl.finish();
    for (const query of queries) {
      const start = performance.now();
      while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && performance.now() - start < 3000) await new Promise(resolve => setTimeout(resolve, 5));
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { wall, gpu, draws, glError: gl.getError(), layers: camera.layers.mask,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      batches: { sources: exteriorBatch.sourceCount, count: exteriorBatch.batchCount } };
  },
  picture() { this.frame(); return canvas.toDataURL('image/png'); },
  shadowCheck() {
    this.configure({ position: [0.08,1.35,1.25], opening: 1 });
    this.frame(); const stable = this.frame().calls;
    opening = openingTarget = 0.5; applyBlind(); const blind = this.frame().calls, settled = this.frame().calls;
    const rotation = camera.quaternion.clone(), wasOn = ceilingLamp.on;
    camera.lookAt(targets.find(target => target.id === 'ceiling-switch').box.getCenter(new THREE.Vector3()));
    camera.updateMatrixWorld(true); interact();
    camera.quaternion.copy(rotation); camera.updateMatrixWorld(true);
    const rocker = this.frame().calls;
    return { stable, blind, settled, rocker, switchChanged: ceilingLamp.on !== wasOn, autoUpdate: windowLight.shadow.autoUpdate, pending: windowLight.shadow.needsUpdate };
  }
};`;
const cases = [
  { name: 'entry-day', opening: 0.88, measure: true },
  { name: 'window-day', position: [0.08,1.35,-1.6], measure: true },
  { name: 'window-left', position: [0.08,1.35,-1.6], yaw: 0.8 },
  { name: 'window-right-night', position: [0.08,1.35,-1.6], yaw: -0.8, night: true },
  { name: 'door-night', position: [0,1.35,0.3], yaw: Math.PI, pitch: 0, night: true, measure: true },
  { name: 'blind-half', position: [0.08,1.35,-0.6], opening: 0.5, night: true, ceiling: true },
  { name: 'window-texel', position: [0.08,1.35,-1.6], texel: true }
];
const summarize = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return { median: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)] };
};

try {
  for (const [engineName, engine] of [['chrome', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true, ...(engineName === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
    try {
      for (const version of ['before', 'after']) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        page.on('pageerror', error => errors.push(engineName + '/' + version + ': ' + error.message));
        page.on('console', message => { if (message.type() === 'error' && /WebGL|GL_INVALID|THREE/.test(message.text())) errors.push(engineName + '/' + version + ': ' + message.text()); });
        await page.addInitScript(() => {
          const OriginalDate = Date, now = OriginalDate.parse('2026-09-14T12:00:00+09:00');
          globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
          localStorage.setItem('lifebalance.room.preferences.v1', JSON.stringify({ reducedMotion: true }));
        });
        await page.route('**/api/seoul-weather', route => route.abort());
        await page.route('https://api.met.no/**', route => route.abort());
        await page.route('**/room-preview/*.mjs', route => {
          const name = path.basename(new URL(route.request().url()).pathname);
          const file = version === 'before' ? path.join(output, 'before', name) : path.join(root, 'room-preview', name);
          if (!fs.existsSync(file)) return route.continue();
          let source = fs.readFileSync(file, 'utf8');
          if (name === 'app.mjs') source = source.replace('  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });', '  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });' + capture) + hook;
          return route.fulfill({ contentType: 'text/javascript', body: source });
        });
        await page.goto(new URL('room-preview/?review=1&render=original', base).href);
        await page.waitForFunction(() => globalThis.__renderQA?.ready, null, { timeout: 45000 });
        await page.evaluate(async () => { await document.fonts.ready; globalThis.__renderQA.freeze(); });
        const row = { engine: engineName, version, cases: [] }; results.push(row);
        for (const item of cases) {
          await page.evaluate(item => { const qa = globalThis.__renderQA; qa.configure(item); for (let i = 0; i < 30; i++) qa.frame(); }, item);
          let stats = null;
          if (item.measure) {
            stats = await page.evaluate(() => globalThis.__renderQA.measure(40));
            assert.equal(stats.glError, 0); assert.equal(stats.layers, 1);
          }
          const png = await page.evaluate(() => globalThis.__renderQA.picture());
          const file = engineName + '-' + version + '-' + item.name + '.png';
          fs.writeFileSync(path.join(output, file), Buffer.from(png.split(',')[1], 'base64'));
          row.cases.push({ name: item.name, file, ...(stats ? { wall: summarize(stats.wall), gpu: summarize(stats.gpu), draws: stats.draws,
            renderer: stats.renderer, batches: stats.batches } : {}) });
          fs.writeFileSync(path.join(output, 'render-check.json'), JSON.stringify({ results, errors }, null, 2));
        }
        if (version === 'after') {
          row.shadow = await page.evaluate(() => globalThis.__renderQA.shadowCheck());
          assert.equal(row.shadow.autoUpdate, false); assert.equal(row.shadow.pending, false);
          assert.equal(row.shadow.switchChanged, true);
          assert.ok(row.shadow.blind > row.shadow.settled && row.shadow.rocker > row.shadow.settled);
        }
        await page.close();
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results));
} catch (error) { errors.push(error.stack); process.exitCode = 1; console.error(error); }
finally { fs.writeFileSync(path.join(output, 'render-check.json'), JSON.stringify({ results, errors }, null, 2)); }
