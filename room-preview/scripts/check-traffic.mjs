import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const output = path.resolve(root, '../docs/traffic-data');
const errors = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type()) && /WebGL|GL_INVALID|THREE/.test(message.text())) errors.push(message.text()); });
  await page.route('**/__traffic-check', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
  await page.route('**/__before-street-life.mjs', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(output, 'rush-before/street-life.mjs'), 'utf8') }));
  await page.goto(new URL('__traffic-check', base).href);
  const rendering = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createExterior } = await import('/exterior.mjs');
    const { createStreetLife } = await import('/street-life.mjs');
    const { createStreetLife: before } = await import('/__before-street-life.mjs');
    const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
    const scene = new THREE.Scene(), exterior = createExterior();
    scene.add(exterior.root); scene.fog = exterior.fog;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
    exterior.setTime(new Date('2026-09-14T14:00:00+09:00'));
    exterior.setWeather({ cloudCover: 0.35, windSpeed: 0, windFromDegrees: 0 }); exterior.update(10);
    const old = before(exterior), current = createStreetLife(exterior);
    scene.add(old.root, current.root);
    const camera = new THREE.PerspectiveCamera(70, 1.6, 0.025, 520);
    camera.position.set(0.08, 1.35, -1.6); camera.lookAt(-16, -5.7, -49);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1280, 800);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene([]); effect.resize();
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)];
    const stats = values => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95) });
    const buffers = current.root.children.map(mesh => [mesh.geometry, mesh.instanceMatrix.array, mesh.instanceColor.array]);
    const cases = [];
    let clock = 0;
    renderer.info.autoReset = false;
    for (const texel of [false, true]) {
      effect.setEnabled(texel);
      const timings = { before: [], full: [], quiet: [] }, calls = {};
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const kind of repeat % 2 ? ['quiet', 'full', 'before'] : ['before', 'full', 'quiet']) {
          const life = kind === 'before' ? old : current;
          old.root.visible = life === old; current.root.visible = life === current;
          current.setTraffic({ bridge: kind === 'quiet' ? 1 : 8, road: kind === 'quiet' ? 1 : 12,
            rush: kind === 'quiet' ? 0 : 1, morning: kind === 'quiet' ? 0 : 1, evening: 0 });
          // 준비 단계에서 전환을 끝낸 뒤 동일 시야의 렌더링 비용을 비교한다.
          if (life === current) life.update(0);
          effect.invalidate();
          for (let frame = 0; frame < 40; frame++) {
            const start = performance.now();
            life.update(1 / 60, camera); renderer.info.reset(); clock += 1 / 60; effect.render(clock); gl.finish();
            if (frame >= 16) timings[kind].push(performance.now() - start);
          }
          calls[kind] = { ...renderer.info.render };
        }
      }
      cases.push({ texel, timings: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, stats(value)])), calls });
    }
    old.root.visible = current.root.visible = true;
    current.setTraffic({ bridge: 8, road: 12, rush: 1, morning: 1, evening: 0 }); current.update(0);
    const cpu = {};
    for (const [name, life] of [['before', old], ['full', current]]) {
      const samples = [];
      for (let repeat = 0; repeat < 5; repeat++) {
        const start = performance.now(); for (let frame = 0; frame < 4000; frame++) life.update(1 / 60, camera);
        samples.push((performance.now() - start) / 4000);
      }
      cpu[name] = stats(samples);
    }
    const reused = current.root.children.every((mesh, i) => mesh.geometry === buffers[i][0] && mesh.instanceMatrix.array === buffers[i][1] && mesh.instanceColor.array === buffers[i][2]);
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), cases, cpu, reused, pool: current.trafficState };
  });
  let requests = 0;
  await page.addInitScript(() => {
    const OriginalDate = Date, originalInterval = setInterval;
    globalThis.__trafficTime = OriginalDate.parse('2026-09-14T09:10:00+09:00');
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [globalThis.__trafficTime])); }
      static now() { return globalThis.__trafficTime; }
    };
    globalThis.setInterval = (callback, delay, ...args) => originalInterval(callback, delay === 60000 ? 200 : delay, ...args);
  });
  await page.route('**/api/seoul-weather', route => route.fulfill({ status: 503, body: '{}' }));
  await page.route('**/api/seoul-traffic', route => { requests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'schedule', reason: 'unconfigured' }) }); });
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled);
  await page.waitForFunction(() => document.querySelector('#traffic-description')?.textContent.includes('러시아워'));
  const rush = await page.locator('#traffic-description').innerText();
  await page.evaluate(() => { globalThis.__trafficTime = Date.parse('2026-09-15T03:10:00+09:00'); });
  await page.waitForFunction(() => document.querySelector('#traffic-description')?.textContent.includes('적음'));
  const night = await page.locator('#traffic-description').innerText();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'traffic-ui.png') });
  const report = { rendering, ui: { rush, night, requests }, errors, scope: '독립 자동 브라우저의 교통 상태·기존/변경 차량 렌더링 비교. 실기기 수동 이동 검사는 제외.' };
  fs.writeFileSync(path.join(root, 'traffic-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (errors.length || !rendering.reused || requests !== 1 || rendering.cases.some(item => item.calls.full.calls > item.calls.before.calls)) process.exitCode = 1;
} finally { await browser.close(); }
