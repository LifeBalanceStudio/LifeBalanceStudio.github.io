import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rush = process.argv.includes('--rush');
const output = path.resolve(root, rush ? '../docs/traffic-data/rush-visuals' : '../docs/street-life');
const visualsOnly = process.argv.includes('--visual-only');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/__street-life-check', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
  await page.goto((process.argv[2] || 'http://127.0.0.1:4173') + '/__street-life-check');
  const result = await page.evaluate(async ({ visualsOnly, rush }) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { createExterior } = await import('/exterior.mjs');
    const { createStreetLife } = await import('/street-life.mjs');
    const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
    const { bindRoom, blindPose, START } = await import('/world.mjs');
    const { createMoodLight } = await import('/mood-light.mjs');
    const scene = new THREE.Scene(), exterior = createExterior();
    scene.add(exterior.root); scene.fog = exterior.fog;
    const room = (await new GLTFLoader().loadAsync('/assets/room.glb')).scene;
    scene.add(room); room.updateMatrixWorld(true);
    room.traverse(object => { if (object.isMesh) { object.castShadow = !object.name.includes('통유리'); object.receiveShadow = true; } });
    const bindings = bindRoom(room);
    const blind = blindPose(1); bindings.fabric.scale.y = blind.height; bindings.fabric.position.y = blind.centerY; bindings.bottomBar.position.y = blind.barY;
    const lamp = createMoodLight(bindings.lampShade); scene.add(lamp.light);
    const ambient = new THREE.HemisphereLight(0xacc4dc, 0x4c3020, 0.6);
    const sun = new THREE.DirectionalLight(0xffd7a0, 2.2);
    sun.position.set(1, 5, -4); sun.target.position.set(-0.7, 0.15, 0.2); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 12 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015;
    scene.add(ambient, sun, sun.target);
    const day = { value: 1 }, life = createStreetLife(exterior, day); scene.add(life.root);
    if (rush) life.setTraffic({ bridge: 8, road: 12, rush: 1, morning: 1, evening: 0 });
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 800); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const camera = new THREE.PerspectiveCamera(70, 1280 / 800, 0.025, 520); camera.rotation.order = 'YXZ';
    const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene([bindings.screen]); effect.resize();
    const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const metadata = { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), timer: Boolean(timer), width: 1280, height: 800, dpr: 1 };
    renderer.info.autoReset = false;
    const cases = [], frames = [];
    let clock = 0;
    const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)];
    const stats = values => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95), samples: values.length });
    const cpuStart = performance.now();
    for (let i = 0; i < 2000; i++) life.update(1 / 60);
    const updateMs = (performance.now() - cpuStart) / 2000;
    function render(active) {
      life.root.visible = active; life.update(1 / 60); exterior.update(1 / 60);
      clock += 1 / 60; renderer.info.reset(); effect.render(clock);
    }
    async function batch(active) {
      life.root.visible = active; effect.invalidate();
      for (let i = 0; i < 12; i++) { render(active); gl.finish(); }
      const wall = [], queries = [];
      for (let i = 0; i < 16; i++) {
        const query = timer && gl.createQuery();
        if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        const start = performance.now(); render(active);
        if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
        // GPU 완료까지 기다려 프레임 제한에 가려진 비용을 비교한다. 실제 FPS와는 다르다.
        gl.finish(); wall.push(performance.now() - start);
      }
      const draws = { ...renderer.info.render }, gpu = [];
      for (const query of queries) {
        while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) await new Promise(resolve => setTimeout(resolve, 2));
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
      return { wall, gpu, draws };
    }
    const daytime = new Date('2026-09-12T12:00:00+09:00');
    exterior.setWeather({ cloudCover: 0.35, windSpeed: 0, windFromDegrees: 0 }); exterior.setTime(daytime); exterior.update(10);
    lamp.light.intensity = 0; lamp.light.shadow.needsUpdate = true;
    for (const view of visualsOnly ? [] : ['window', 'room']) {
      if (view === 'window') { camera.position.set(0, 1.35, -1.4); camera.lookAt(-16, -5.7, -49); }
      else { camera.position.set(START.x, START.y, START.z); camera.rotation.set(START.pitch, START.yaw, 0); }
      for (const texel of [false, true]) {
        effect.setEnabled(texel);
        const baseline = [], actors = [];
        for (let repeat = 0; repeat < 5; repeat++) {
          for (const active of repeat % 2 ? [true, false] : [false, true]) (active ? actors : baseline).push(await batch(active));
        }
        const aggregate = batches => ({ wall: stats(batches.flatMap(batch => batch.wall)), gpu: batches[0].gpu.length ? stats(batches.flatMap(batch => batch.gpu)) : null, draws: batches[0].draws });
        const base = aggregate(baseline), added = aggregate(actors);
        cases.push({ view, texel, baseline: base, actors: added, wallDeltaMs: added.wall.median - base.wall.median,
          gpuDeltaMs: added.gpu && base.gpu ? added.gpu.median - base.gpu.median : null,
          pairedWallDeltas: actors.map((batch, i) => percentile(batch.wall, 0.5) - percentile(baseline[i].wall, 0.5)) });
      }
    }
    camera.position.set(1.12, 1.35, -1.56); camera.lookAt(-10, -8.4, -24);
    if (rush) { camera.position.set(0.08, 1.35, -1.6); camera.lookAt(-4, -10, -24); }
    for (const [name, date] of [['day', daytime], ['night', new Date('2026-09-12T21:00:00+09:00')]]) {
      day.value = exterior.setTime(date).day; ambient.intensity = 0.16 + day.value * 0.47; sun.intensity = 2.2 * day.value;
      lamp.light.intensity = day.value < 0.1 ? 1.8 : 0; lamp.light.shadow.needsUpdate = true;
      for (const texel of [false, true]) {
        effect.setEnabled(texel); effect.invalidate();
        for (let i = 0; i < 16; i++) render(true);
        frames.push({ name: name + (texel ? '-texel' : ''), image: renderer.domElement.toDataURL('image/png') });
      }
    }
    let triangles = 0;
    life.root.traverse(mesh => { if (mesh.isMesh) triangles += mesh.geometry.index.count / 3 * mesh.count; });
    exterior.root.visible = room.visible = false; day.value = 1; effect.setEnabled(false);
    scene.fog = null; scene.background = new THREE.Color('#a4aaa3');
    const display = new THREE.Object3D();
    for (let i = 0; i < 3; i++) {
      const mesh = life.root.children[i]; mesh.count = 1;
      display.position.set((i - 1) * 2.4, 0, -1); display.rotation.set(0, 0.2, 0); display.updateMatrix();
      mesh.setMatrixAt(0, display.matrix); mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false;
    }
    const bodies = life.root.children[3], legs = life.root.children[4]; bodies.count = 3; legs.count = 6;
    for (let i = 0; i < 3; i++) {
      display.position.set((i - 1) * 1.3, 0, 1.7); display.rotation.set(0, 0, 0); display.updateMatrix(); bodies.setMatrixAt(i, display.matrix);
      for (let side = 0; side < 2; side++) {
        display.position.set((i - 1) * 1.3 + (side ? 0.115 : -0.115), 0.71, 1.7);
        display.rotation.x = side ? 0.35 : -0.35; display.updateMatrix(); legs.setMatrixAt(i * 2 + side, display.matrix);
      }
    }
    for (const mesh of [bodies, legs]) { mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; }
    camera.fov = 45; camera.updateProjectionMatrix();
    camera.position.set(5.2, 3.6, 6.5); camera.lookAt(0, 0.7, 0); renderer.render(scene, camera);
    frames.push({ name: 'models', image: renderer.domElement.toDataURL('image/png') });
    const report = { metadata, updateMs, triangles, meshGroups: life.root.children.length, cases, frames };
    effect.dispose(); renderer.dispose(); return report;
  }, { visualsOnly, rush });
  for (const frame of result.frames) fs.writeFileSync(path.join(output, frame.name + '.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
  result.frames = result.frames.map(frame => frame.name + '.png'); result.errors = errors;
  fs.writeFileSync(path.join(root, rush ? 'rush-visual-check.json' : visualsOnly ? 'street-life-visual-check.json' : 'street-life-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, cases: result.cases.map(entry => ({ view: entry.view, texel: entry.texel, baseline: entry.baseline.wall, actors: entry.actors.wall, gpuDeltaMs: entry.gpuDeltaMs, wallDeltaMs: entry.wallDeltaMs, pairedWallDeltas: entry.pairedWallDeltas, drawDelta: entry.actors.draws.calls - entry.baseline.draws.calls })) }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
