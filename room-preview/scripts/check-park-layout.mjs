import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../docs/park-layout');
const url = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const errors = [], pages = {}, metadata = {};
try {
  for (const version of ['before', 'after']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); pages[version] = page;
    page.on('pageerror', error => errors.push(version + ': ' + error.message));
    page.on('console', message => { if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['error', 'warning'].includes(message.type())) errors.push(version + ': ' + message.text()); });
    if (version === 'before') for (const file of ['exterior.mjs', 'street-life.mjs']) {
      const body = fs.readFileSync(path.join(output, 'before', file), 'utf8');
      await page.route('**/' + file, route => route.fulfill({ contentType: 'text/javascript', body }));
    }
    await page.route('**/__park-layout-check', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
    await page.goto(url + '/__park-layout-check');
    metadata[version] = await page.evaluate(async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { createExterior } = await import('/exterior.mjs');
      const { createStreetLife } = await import('/street-life.mjs');
      const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
      const { createMoodLight } = await import('/mood-light.mjs');
      const { bindRoom, blindPose, START } = await import('/world.mjs');
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
      const camera = new THREE.PerspectiveCamera(70, 1.6, 0.025, 520); camera.rotation.order = 'YXZ';
      const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene([bindings.screen]); effect.resize();
      const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
      exterior.setWeather({ cloudCover: 0.35, windSpeed: 0, windFromDegrees: 0 }); exterior.update(12);
      let clock = 0;
      function configure(view, texel, night) {
        day.value = exterior.setTime(new Date(night ? '2026-09-12T21:00:00+09:00' : '2026-09-12T12:00:00+09:00')).day;
        ambient.intensity = 0.16 + day.value * 0.47; sun.intensity = 2.2 * day.value;
        lamp.setOn(night); lamp.light.shadow.needsUpdate = true;
        camera.fov = 70;
        if (view === 'window') { camera.position.set(0.08, 1.35, -1.6); camera.lookAt(0, -10, -22); }
        else if (view === 'dock') { camera.position.set(10, -3.5, -27); camera.lookAt(19, -9, -38); camera.fov = 49; }
        else { camera.position.set(START.x, START.y, START.z); camera.rotation.set(START.pitch, START.yaw, 0); }
        camera.updateProjectionMatrix(); effect.setEnabled(texel); effect.invalidate();
      }
      function render() { life.update(1 / 60); exterior.update(1 / 60); clock += 1 / 60; renderer.info.reset(); effect.render(clock); }
      const totals = { meshes: 0, triangles: 0 };
      exterior.root.traverse(mesh => { if (mesh.isMesh) { totals.meshes++; totals.triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1); } });
      const start = performance.now(); for (let i = 0; i < 2000; i++) life.update(1 / 60);
      const updateMs = (performance.now() - start) / 2000;
      // 이 객체는 독립 자동 검사 페이지 안에만 존재한다.
      window.parkCheck = { renderer, effect, gl, timer, configure, render, scene, camera };
      return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), timer: Boolean(timer), width: 1280, height: 800, dpr: 1, totals, updateMs };
    });
  }
  const cases = [];
  for (const view of ['window', 'room']) for (const texel of [false, true]) {
    const batches = { before: [], after: [] };
    for (let repeat = 0; repeat < 5; repeat++) for (const version of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      batches[version].push(await pages[version].evaluate(async ({ view, texel }) => {
        const { configure, render, gl, timer, renderer } = window.parkCheck; configure(view, texel, false);
        for (let i = 0; i < 12; i++) { render(); gl.finish(); }
        const wall = [], queries = [], gpu = [];
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
      }, { view, texel }));
    }
    const stats = values => { values.sort((a, b) => a - b); return { median: values[Math.floor((values.length - 1) * 0.5)], p95: values[Math.floor((values.length - 1) * 0.95)], samples: values.length }; };
    const summarize = samples => ({ wall: stats(samples.flatMap(sample => sample.wall)), gpu: stats(samples.flatMap(sample => sample.gpu)), draws: samples[0].draws });
    const before = summarize(batches.before), after = summarize(batches.after);
    cases.push({ view, texel, before, after, wallDeltaMs: after.wall.median - before.wall.median, gpuDeltaMs: after.gpu.median - before.gpu.median });
  }
  const images = [];
  for (const [version, view, night, texel] of [['before', 'window', false, false], ['after', 'window', false, false], ['after', 'window', false, true], ['after', 'window', true, false], ['after', 'window', true, true], ['after', 'dock', false, false], ['after', 'dock', true, false]]) {
    const image = await pages[version].evaluate(({ view, texel, night }) => {
      const { configure, render, renderer, gl } = window.parkCheck; configure(view, texel, night);
      for (let i = 0; i < 16; i++) render(); gl.finish(); return renderer.domElement.toDataURL('image/png');
    }, { view, texel, night });
    const name = `${version}-${view}-${night ? 'night' : 'day'}${texel ? '-texel' : ''}.png`;
    fs.writeFileSync(path.join(output, name), Buffer.from(image.split(',')[1], 'base64')); images.push(name);
  }
  const result = { metadata, cases, images, errors };
  fs.writeFileSync(path.join(root, 'park-layout-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ metadata, cases: cases.map(row => ({ view: row.view, texel: row.texel, before: row.before.wall, after: row.after.wall, wallDeltaMs: row.wallDeltaMs, gpuDeltaMs: row.gpuDeltaMs, drawDelta: row.after.draws.calls - row.before.draws.calls })), images, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
