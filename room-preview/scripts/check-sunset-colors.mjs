import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../docs/sunset');
const url = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const pages = {}, errors = [], failures = [];
try {
  for (const version of ['before', 'after']) {
    const page = await browser.newPage(); pages[version] = page;
    page.on('pageerror', error => errors.push(version + ': ' + error.message));
    page.on('console', message => { if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['error', 'warning'].includes(message.type())) errors.push(version + ': ' + message.text()); });
    if (version === 'before') for (const file of ['weather-sky.mjs', 'exterior.mjs', 'backdrop.mjs']) await page.route('**/' + file, route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(output, 'before', file), 'utf8') }));
    await page.route('**/__sunset-colors', route => route.fulfill({ contentType: 'text/html', body: '<link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>' }));
    await page.goto(url + '/__sunset-colors');
    await page.evaluate(async () => {
      const THREE = await import('three');
      const { createExterior } = await import('/exterior.mjs');
      const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
      const exterior = createExterior(), scene = new THREE.Scene();
      scene.add(exterior.sky.mesh, exterior.water);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(640, 400); renderer.setClearColor(0, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      const camera = new THREE.PerspectiveCamera(40, 1.6, 0.025, 520);
      const effect = createTexelSplatRenderer(renderer, scene, camera); effect.bindScene(); effect.resize();
      const gl = renderer.getContext(); let time = 0;
      window.sunsetSample = ({ kind, away, cover, date, texel }) => {
        exterior.setTime(new Date(date)); exterior.setWeather({ cloudCover: cover, condition: 'cloudy', windSpeed: 0, windFromDegrees: 0 }); exterior.update(30);
        exterior.sky.mesh.material.uniforms.uCover.value = cover;
        exterior.water.material.uniforms.uTime.value = 123;
        exterior.sky.mesh.visible = kind === 'sky'; exterior.water.visible = kind === 'water';
        if (kind === 'sky') {
          const sun = exterior.sky.mesh.material.uniforms.uSun.value;
          camera.position.set(0, 0, 0); camera.fov = 40;
          camera.lookAt(sun.x * (away ? -1 : 1), 0.45, sun.z * (away ? -1 : 1));
        } else { camera.position.set(-120, 4, -70); camera.fov = 30; camera.lookAt(80, -10, -90); }
        camera.updateProjectionMatrix(); effect.setEnabled(texel); effect.invalidate();
        for (let i = 0; i < 4; i++) { time += 0.1; effect.render(time); }
        gl.finish();
        const pixels = new Uint8Array(640 * 400 * 4); gl.readPixels(0, 0, 640, 400, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const mean = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) mean[channel] += pixels[i + channel] / (640 * 400);
        return { mean, warmth: mean[0] - mean[2], image: renderer.domElement.toDataURL('image/png'), glError: gl.getError() };
      };
    });
  }
  const rows = [];
  for (const texel of [false, true]) for (const [name, kind, away, cover, date] of [
    ['sunward', 'sky', false, 0.45, '2026-09-12T18:30:00+09:00'],
    ['away', 'sky', true, 0.45, '2026-09-12T18:30:00+09:00'],
    ['overcast', 'sky', false, 1, '2026-09-12T18:30:00+09:00'],
    ['day', 'sky', false, 0.45, '2026-09-12T16:00:00+09:00'],
    ['night', 'sky', false, 0.45, '2026-09-12T20:30:00+09:00'],
    ['reflection', 'water', false, 0.3, '2026-09-12T18:30:00+09:00'],
    ['water-overcast', 'water', false, 1, '2026-09-12T18:30:00+09:00'],
    ['water-night', 'water', false, 0.3, '2026-09-12T20:30:00+09:00']
  ]) {
    const samples = {};
    for (const version of ['before', 'after']) {
      const sample = await pages[version].evaluate(args => window.sunsetSample(args), { kind, away, cover, date, texel });
      if (sample.glError) errors.push(version + ': WebGL ' + sample.glError);
      if (version === 'after' && ['sunward', 'overcast', 'reflection'].includes(name)) fs.writeFileSync(path.join(output, name + (texel ? '-texel' : '') + '.png'), Buffer.from(sample.image.split(',')[1], 'base64'));
      delete sample.image; samples[version] = sample;
    }
    rows.push({ name, texel, cover, date, ...samples, warmthDelta: samples.after.warmth - samples.before.warmth });
  }
  for (const texel of [false, true]) {
    const row = name => rows.find(item => item.name === name && item.texel === texel);
    if (row('sunward').warmthDelta < 6) failures.push('태양 방향의 하늘·구름이 충분히 따뜻해지지 않음');
    if (row('sunward').warmthDelta < row('away').warmthDelta + 2) failures.push('태양 방향과 반대편의 노을 차이가 없음');
    if (row('overcast').warmthDelta >= row('sunward').warmthDelta * 0.7) failures.push('완전한 흐림에서 노을이 충분히 약해지지 않음');
    if (row('reflection').warmthDelta < 6) failures.push('수면의 따뜻한 반사 변화가 부족함');
    if (row('water-overcast').warmthDelta >= row('reflection').warmthDelta * 0.5) failures.push('구름이 반사광을 충분히 약하게 만들지 않음');
    for (const name of ['day', 'night', 'water-night']) if (Math.max(...row(name).after.mean.map((value, i) => Math.abs(value - row(name).before.mean[i]))) > 0.15) failures.push(name + '의 기존 색이 노을 시간 밖에서 변경됨');
  }
  const result = { rows, errors, failures };
  fs.writeFileSync(path.join(root, 'sunset-color-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ rows: rows.map(row => ({ name: row.name, texel: row.texel, warmthDelta: row.warmthDelta })), errors, failures }, null, 2));
  if (errors.length || failures.length) process.exitCode = 1;
} finally { await browser.close(); }
