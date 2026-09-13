import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sunsetMode = process.argv.includes('--sunset');
const output = path.resolve(root, sunsetMode ? '../docs/sunset' : '../docs/celestial-sky');
const url = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const pages = {}, metadata = {}, errors = [];
try {
  for (const version of ['before', 'after']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); pages[version] = page;
    page.on('pageerror', error => errors.push(version + ': ' + error.message));
    page.on('console', message => { if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['error', 'warning'].includes(message.type())) errors.push(version + ': ' + message.text()); });
    if (version === 'before') for (const file of sunsetMode ? ['weather-sky.mjs', 'exterior.mjs', 'backdrop.mjs'] : ['weather-sky.mjs', 'exterior.mjs']) await page.route('**/' + file, route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(output, 'before', file), 'utf8') }));
    await page.route('**/__sky-performance', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
    await page.goto(url + '/__sky-performance');
    metadata[version] = await page.evaluate(async sunsetMode => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { createExterior } = await import('/exterior.mjs');
      const { createStreetLife } = await import('/street-life.mjs');
      const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
      const { createMoodLight } = await import('/mood-light.mjs');
      const { bindRoom, blindPose } = await import('/world.mjs');
      const { getPosition, getMoonPosition } = await import('/vendor/suncalc/index.js');
      const scene = new THREE.Scene(), exterior = createExterior(); scene.add(exterior.root); scene.fog = exterior.fog;
      const room = (await new GLTFLoader().loadAsync('/assets/room.glb')).scene; scene.add(room); room.updateMatrixWorld(true);
      room.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = !mesh.name.includes('통유리'); mesh.receiveShadow = true; } });
      const bindings = bindRoom(room), blind = blindPose(1);
      bindings.fabric.scale.y = blind.height; bindings.fabric.position.y = blind.centerY; bindings.bottomBar.position.y = blind.barY;
      const lamp = createMoodLight(bindings.lampShade); scene.add(lamp.light);
      const ambient = new THREE.HemisphereLight(0xacc4dc, 0x4c3020, 0.6), sun = new THREE.DirectionalLight(0xffd7a0, 2.2);
      sun.position.set(1, 5, -4); sun.target.position.set(-0.7, 0.15, 0.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 12 });
      sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015;
      scene.add(ambient, sun, sun.target);
      const day = { value: 1 }, life = createStreetLife(exterior, day); scene.add(life.root);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1280, 800); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.info.autoReset = false;
      const camera = new THREE.PerspectiveCamera(70, 1.6, 0.025, 520); camera.position.set(0.08, 1.35, -1.6);
      const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene([bindings.screen]); effect.resize();
      const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
      let clock = 0, frame = 0, date;
      function configure(night, texel, cover = sunsetMode ? 0.45 : 0.2, overrideDate = null) {
        date = new Date(overrideDate || (sunsetMode ? (night ? '2026-09-12T19:05:00+09:00' : '2026-09-12T18:30:00+09:00') : (night ? '2026-09-27T00:00:00+09:00' : '2026-09-12T09:00:00+09:00')));
        day.value = exterior.setTime(date).day; ambient.intensity = 0.16 + day.value * 0.47; sun.intensity = 2.2 * day.value;
        lamp.setOn(night); lamp.light.shadow.needsUpdate = true;
        exterior.setWeather({ cloudCover: cover, condition: cover > 0.5 ? 'cloudy' : 'clear', windSpeed: 0, windFromDegrees: 0 }); exterior.update(30);
        const position = (night ? getMoonPosition : getPosition)(date, 37.5665, 126.978);
        const azimuth = THREE.MathUtils.degToRad(position.azimuth), altitude = THREE.MathUtils.degToRad(position.altitude);
        if (sunsetMode) camera.lookAt(55, 6, -90);
        else camera.lookAt(new THREE.Vector3(-Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), Math.cos(azimuth) * Math.cos(altitude)).multiplyScalar(450));
        effect.setEnabled(texel); effect.invalidate();
      }
      function render() {
        // 실제 페이지처럼 천체 위치는 매 프레임이 아니라 약 1초마다 갱신한다.
        if (frame++ % 60 === 0) exterior.setTime(date);
        life.update(1 / 60); exterior.update(1 / 60); clock += 1 / 60; renderer.info.reset(); effect.render(clock);
      }
      const updateStart = performance.now(); for (let i = 0; i < 200; i++) exterior.setTime(new Date('2026-09-27T00:00:00+09:00'));
      window.skyPerformance = { renderer, effect, gl, timer, configure, render, exterior, scene, camera };
      return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), timer: Boolean(timer), texelSupported: effect.supported,
        width: 1280, height: 800, dpr: 1, timeUpdateMs: (performance.now() - updateStart) / 200, skyMeshes: 1, skyTriangles: exterior.sky.mesh.geometry.index.count / 3 };
    }, sunsetMode);
  }
  const cases = [];
  for (const night of [false, true]) for (const texel of [false, true]) {
    const samples = { before: [], after: [] };
    for (let repeat = 0; repeat < 5; repeat++) for (const version of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      samples[version].push(await pages[version].evaluate(async ({ night, texel }) => {
        const { configure, render, renderer, gl, timer } = window.skyPerformance; configure(night, texel);
        for (let i = 0; i < 12; i++) { render(); gl.finish(); }
        const wall = [], gpu = [], queries = [];
        for (let i = 0; i < 16; i++) {
          const query = timer && gl.createQuery(); if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          const start = performance.now(); render(); if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
          gl.finish(); wall.push(performance.now() - start);
        }
        const draws = { ...renderer.info.render };
        for (const query of queries) {
          const deadline = performance.now() + 3000;
          while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
            if (performance.now() > deadline) throw Error('GPU 측정 응답 시간 초과');
            await new Promise(resolve => setTimeout(resolve, 2));
          }
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(query);
        }
        return { wall, gpu, draws };
      }, { night, texel }));
    }
    const stats = values => { values.sort((a, b) => a - b); return { median: values[Math.floor((values.length - 1) * 0.5)], p95: values[Math.floor((values.length - 1) * 0.95)], samples: values.length }; };
    const summarize = batches => ({ wall: stats(batches.flatMap(batch => batch.wall)), gpu: stats(batches.flatMap(batch => batch.gpu)), draws: batches[0].draws });
    const before = summarize(samples.before), after = summarize(samples.after);
    cases.push({ night, texel, before, after, wallDeltaMs: after.wall.median - before.wall.median, gpuDeltaMs: after.gpu.median - before.gpu.median });
  }
  const images = [];
  const imageCases = sunsetMode ? [
    ['room-before', false, false, 0.45, '2026-09-12T17:00:00+09:00'],
    ['room-sunset', false, false, 0.45], ['room-sunset-texel', false, true, 0.45],
    ['room-afterglow', true, false, 0.45], ['room-overcast', false, false, 1],
    ['room-night', true, false, 0.45, '2026-09-12T20:15:00+09:00']
  ] : [['room-sun', false, false, 0.15], ['room-moon-stars', true, false, 0], ['room-moon-stars-texel', true, true, 0], ['room-clouds', true, false, 0.65], ['room-overcast', true, false, 1]];
  for (const [name, night, texel, cover, overrideDate] of imageCases) {
    const data = await pages.after.evaluate(({ night, texel, cover, overrideDate }) => {
      const { configure, render, renderer, gl } = window.skyPerformance; configure(night, texel, cover, overrideDate);
      for (let i = 0; i < 16; i++) render(); gl.finish(); return renderer.domElement.toDataURL('image/png');
    }, { night, texel, cover, overrideDate });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(data.split(',')[1], 'base64')); images.push(name + '.png');
  }
  const result = { scenario: sunsetMode ? '노을 전후' : '해·달·별', metadata, cases, images, errors };
  fs.writeFileSync(path.join(root, sunsetMode ? 'sunset-performance-check.json' : 'sky-performance-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ metadata, cases: cases.map(row => ({ night: row.night, texel: row.texel, before: row.before.wall, after: row.after.wall, wallDeltaMs: row.wallDeltaMs, gpuDeltaMs: row.gpuDeltaMs, drawDelta: row.after.draws.calls - row.before.draws.calls })), images, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
