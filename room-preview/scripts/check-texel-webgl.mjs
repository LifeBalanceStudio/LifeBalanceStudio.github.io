import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// 별도 설치 없이 작업 환경의 Playwright와 Chrome 경로를 환경 변수로 받는다.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../docs/texel-splatting');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
const errors = [];
const failures = [];
const url = process.argv[2] || 'http://127.0.0.1:4173';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /WebGL|GL_INVALID/.test(message.text())) errors.push(message.text());
  });
  // 사용자 페이지를 조작하지 않고, 실제 모듈을 가져오는 독립 렌더링 장면을 검사한다.
  await page.route('**/__texel-check', route => route.fulfill({ contentType: 'text/html', body: `
    <link rel="icon" href="data:,">
    <link rel="stylesheet" href="/styles.css">
    <script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>
  ` }));
  await page.goto(url + '/__texel-check');
  const fixture = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createTexelSplatRenderer, TEXEL_SPLAT } = await import('/texel-splat.mjs');
    const width = 960, height = 600;
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111923');
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.025, 520);
    camera.position.set(0.04, 1.35, 1.25);
    const pixels = new Uint8Array(128 * 128 * 4);
    for (let i = 0; i < 128 * 128; i++) {
      const value = ((i * 1664525 + 1013904223) >>> 0) >>> 24;
      pixels.set([value, 70 + value / 2, 180 - value / 2, 255], i * 4);
    }
    const texture = new THREE.DataTexture(pixels, 128, 128);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ map: texture }));
    wall.position.set(0, 1.5, -1);
    scene.add(wall);
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.2), new THREE.MeshBasicMaterial({ color: '#ef4020' }));
    occluder.position.set(4, 1.5, -0.5);
    scene.add(occluder);
    const effect = createTexelSplatRenderer(renderer, scene, camera);
    effect.bindScene(); effect.resize();
    const gl = renderer.getContext();
    const sample = point => {
      const ndc = point.clone().project(camera);
      const color = new Uint8Array(4);
      gl.readPixels(Math.floor((ndc.x * 0.5 + 0.5) * width), Math.floor((ndc.y * 0.5 + 0.5) * height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
      return Array.from(color);
    };
    // -Z 캡처의 한 텍셀 중심을 벽까지 역투영한 위치다.
    const resolution = TEXEL_SPLAT.resolution;
    const cellX = Math.floor(resolution * 0.475) + 0.5;
    const cellY = Math.floor(resolution * 0.56) + 0.5;
    const point = new THREE.Vector3(((cellX / resolution) * 2 - 1) * 2.25, 1.25 + ((cellY / resolution) * 2 - 1) * 2.25, -1);
    effect.render(0);
    const first = sample(point);
    camera.rotation.y = 0.16;
    effect.render(0.01);
    const rotated = sample(point);
    camera.position.x = 0.09;
    effect.render(0.02);
    const translated = sample(point);
    const withinCell = effect.state;
    effect.render(0.2);
    const refreshed = sample(point);
    camera.position.x = 0.14;
    effect.render(0.21);
    const nextCell = effect.state;
    effect.render(0.5);
    const beforeOcclusion = sample(point);
    occluder.position.x = point.x;
    effect.render(0.51);
    const occluded = sample(point);
    effect.invalidate(); effect.render(0.52);
    occluder.position.x = 4;
    effect.render(0.53);
    const revealed = sample(point);
    const originalWallMaterial = wall.material;
    wall.material = new THREE.MeshBasicMaterial({ color: '#68d3f0', toneMapped: false });
    effect.bindScene([wall]);
    effect.render(0.54);
    const sharp = sample(point);
    effect.setEnabled(false); effect.render(0.55);
    const directSharp = sample(point);
    occluder.position.x = point.x;
    effect.render(0.56);
    const directCovered = sample(point);
    effect.setEnabled(true); effect.render(0.57);
    const sharpCovered = sample(point);
    wall.material = originalWallMaterial;
    occluder.position.x = 4;
    effect.bindScene(); effect.render(0.9);
    const image = renderer.domElement.toDataURL().split(',')[1];
    // 고정 원점만 가리고 눈 위치에서는 보이는 영역도 텍셀로 채워지는지 검사한다.
    const gradient = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 texUV; void main(){ texUV = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 texUV; void main(){ gl_FragColor = vec4(fract(texUV.x * 16.0), 0.2, 0.1, 1.0); }',
    });
    wall.material = gradient;
    occluder.scale.set(0.1, 0.2, 0.2);
    occluder.position.set(0, 1.25, 1.18);
    camera.position.set(0.09, 1.35, 1.25); camera.rotation.set(0, 0, 0);
    effect.bindScene(); effect.render(2); effect.render(2.3);
    const rowPoint = new THREE.Vector3(0, 1.25, -1).project(camera);
    const row = new Uint8Array(80 * 4);
    gl.readPixels(Math.floor((rowPoint.x * 0.5 + 0.5) * width) - 40, Math.floor((rowPoint.y * 0.5 + 0.5) * height), 80, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    let sameNeighbours = 0;
    const distinct = new Set();
    for (let i = 0; i < 80; i++) {
      const color = Array.from(row.slice(i * 4, i * 4 + 3)).join(',');
      distinct.add(color);
      if (i && row[i * 4] === row[(i - 1) * 4] && row[i * 4 + 1] === row[(i - 1) * 4 + 1] && row[i * 4 + 2] === row[(i - 1) * 4 + 2]) sameNeighbours++;
    }
    const disocclusion = { sameNeighbourRatio: sameNeighbours / 79, distinctColors: distinct.size };
    const result = { first, rotated, translated, refreshed, withinCell, nextCell, beforeOcclusion, occluded, revealed, sharp, directSharp, sharpCovered, directCovered, disocclusion, glError: gl.getError(), image };
    gradient.dispose();
    effect.dispose(); renderer.dispose();
    return result;
  });
  fs.writeFileSync(path.join(output, 'stability-fixture.png'), Buffer.from(fixture.image, 'base64'));
  delete fixture.image;
  const close = (a, b, tolerance = 2) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  if (![fixture.rotated, fixture.translated, fixture.refreshed].every(color => close(fixture.first, color))) failures.push('같은 월드 텍셀의 색이 회전·셀 안 이동·재캡처로 바뀜');
  if (fixture.withinCell.captureCount !== 3 || fixture.nextCell.captureCount !== 5 || fixture.nextCell.origin[0] !== 0.25) failures.push('고정 원점 캡처 또는 셀 전환 오류');
  if (fixture.nextCell.eyeCaptureCount !== 5 || fixture.nextCell.probeCount !== 3) failures.push('눈 위치 프로브 갱신 또는 프로브 구성 오류');
  if (fixture.occluded[0] < fixture.occluded[1] * 1.8) failures.push('새 가림 물체 뒤의 오래된 텍셀이 노출됨');
  if (fixture.revealed[0] > fixture.revealed[1] * 1.8) failures.push('이동한 가림 물체의 잔상이 남음');
  if (!close(fixture.sharp, fixture.directSharp) || !close(fixture.sharpCovered, fixture.directCovered)) failures.push('선명한 화면의 색 또는 가림 오류');
  if (fixture.disocclusion.sameNeighbourRatio < 0.3 || fixture.disocclusion.distinctColors < 15) failures.push('새로 드러난 영역에서 텍셀의 일정한 색이 유지되지 않음');
  if (fixture.glError) failures.push('검증 장면 WebGL 오류');

  const room = await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { createTexelSplatRenderer } = await import('/texel-splat.mjs');
    const { createExterior, EXTERIOR } = await import('/exterior.mjs');
    const { bindRoom, blindPose, START } = await import('/world.mjs');
    const { createMoodLight } = await import('/mood-light.mjs');
    const { createInteractionOutline } = await import('/outline.mjs');
    const { createTVMenu } = await import('/portfolio.mjs');
    const width = 1280, height = 800;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101419);
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.025, EXTERIOR.far);
    camera.rotation.order = 'YXZ';
    const exterior = createExterior();
    scene.add(exterior.root); scene.fog = exterior.fog;
    const ambient = new THREE.HemisphereLight(0xacc4dc, 0x4c3020, 0.1);
    const sun = new THREE.DirectionalLight(0xffd7a0, 0);
    sun.position.set(1, 5, -4); sun.target.position.set(-0.7, 0.15, 0.2);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 12 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015;
    scene.add(ambient, sun, sun.target);
    const root = (await new GLTFLoader().loadAsync('/assets/room.glb')).scene;
    scene.add(root); root.updateMatrixWorld(true);
    root.traverse(object => { if (object.isMesh) { object.castShadow = !object.name.includes('통유리'); object.receiveShadow = true; } });
    const bindings = bindRoom(root);
    const lamp = createMoodLight(bindings.lampShade); scene.add(lamp.light);
    const screen = bindings.screen;
    const screenCenter = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3());
    const normal = new THREE.Vector3();
    const normals = screen.geometry.getAttribute('normal');
    const sampleNormal = new THREE.Vector3();
    for (let i = 0; i < normals.count; i++) normal.add(sampleNormal.fromBufferAttribute(normals, i));
    normal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(screen.matrixWorld)).normalize();
    const tvLight = new THREE.PointLight(0x5797ff, 2.5, 4, 2);
    tvLight.position.copy(screenCenter).addScaledVector(normal, 0.15); scene.add(tvLight);
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 720;
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.generateMipmaps = false;
    screen.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const menu = createTVMenu(canvas, () => { texture.needsUpdate = true; });
    await document.fonts.ready;
    menu.setActive(false);
    const effect = createTexelSplatRenderer(renderer, scene, camera);
    effect.bindScene([screen]); effect.resize();
    const outline = createInteractionOutline(renderer, scene, camera);
    outline.setTargets(bindings.targets); outline.resize(width, height); outline.setMode('explore');
    function light(night, opening = 0.88) {
      const state = exterior.setTime(new Date(night ? '2026-09-12T21:00:00+09:00' : '2026-09-12T12:00:00+09:00'));
      sun.intensity = 2.2 * opening * state.day;
      ambient.intensity = 0.1 + opening * (0.06 + state.day * 0.47);
      lamp.setOn(night);
      const pose = blindPose(opening);
      bindings.fabric.scale.y = pose.height; bindings.fabric.position.y = pose.centerY; bindings.bottomBar.position.y = pose.barY;
      root.updateMatrixWorld(true); effect.invalidate();
    }
    let time = 1;
    const frames = [];
    function draw(name) {
      time += 1;
      effect.render(time); effect.render(time + 0.2); outline.render(0);
      frames.push({ name, image: renderer.domElement.toDataURL('image/png').split(',')[1], state: effect.state });
    }
    camera.position.set(START.x, START.y, START.z); camera.rotation.set(START.pitch, START.yaw, 0);
    light(true); draw('room-night');
    effect.setEnabled(false); draw('room-night-original'); effect.setEnabled(true);
    camera.position.set(-0.27, 1.35, -1.49); camera.lookAt(-0.4, -1.8, -40);
    light(false); draw('window-day');
    effect.setEnabled(false); draw('window-day-original'); effect.setEnabled(true);
    const glass = [];
    root.traverse(object => { if (object.isMesh && object.name.includes('통유리')) { glass.push(object); object.visible = false; } });
    effect.invalidate(); draw('window-depth-control');
    for (const object of glass) object.visible = true;
    camera.position.set(START.x, START.y, START.z); camera.rotation.set(START.pitch, START.yaw, 0);
    light(false, 0); draw('blind-closed');
    light(true); menu.setActive(true);
    camera.position.copy(screenCenter).addScaledVector(normal, 0.66); camera.lookAt(screenCenter); camera.fov = 48; camera.updateProjectionMatrix();
    outline.setMode('tv'); draw('tv-menu');
    const glError = renderer.getContext().getError();
    const result = { frames, glError, meshes: renderer.info.memory.geometries };
    outline.dispose(); effect.dispose(); renderer.dispose();
    return result;
  });
  for (const frame of room.frames) {
    fs.writeFileSync(path.join(output, frame.name + '.png'), Buffer.from(frame.image, 'base64'));
    delete frame.image;
  }
  if (room.glError) failures.push('실제 방 WebGL 오류');
  const runtime = [];
  for (const hour of [12, 21]) {
    const smoke = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    smoke.on('pageerror', error => errors.push('서울 ' + hour + '시: ' + error.message));
    smoke.on('console', message => {
      if (/WebGL|GL_INVALID|THREE/.test(message.text()) && ['warning', 'error'].includes(message.type())) errors.push('서울 ' + hour + '시: ' + message.text());
    });
    await smoke.addInitScript(iso => {
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [iso])); }
        static now() { return +new NativeDate(iso); }
      };
    }, '2026-09-12T' + hour + ':00:00+09:00');
    const response = await smoke.goto(url + '/?render=texel', { waitUntil: 'networkidle' });
    await smoke.waitForTimeout(400);
    runtime.push({ seoulHour: hour, status: response.status() });
    if (response.status() !== 200) failures.push('실제 페이지 HTTP 응답 오류');
    await smoke.close();
  }
  const optionPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  optionPage.on('pageerror', error => errors.push('옵션 검사: ' + error.message));
  await optionPage.goto(url + '/', { waitUntil: 'networkidle' });
  const option = optionPage.getByRole('checkbox', { name: '텍셀 스플래팅', exact: true });
  await option.waitFor({ state: 'visible' });
  const optionChecks = { defaultOff: !(await option.isChecked()) };
  await option.check();
  optionChecks.checkboxOn = await option.isChecked();
  await optionPage.reload({ waitUntil: 'networkidle' });
  optionChecks.rememberOn = await option.isChecked();
  await option.focus();
  await optionPage.keyboard.press('t');
  optionChecks.shortcutOffWhileFocused = !(await option.isChecked());
  await optionPage.keyboard.press('Space');
  optionChecks.nativeSpaceOn = await option.isChecked();
  await option.uncheck();
  await optionPage.reload({ waitUntil: 'networkidle' });
  optionChecks.rememberOff = !(await option.isChecked());
  await optionPage.goto(url + '/?render=texel', { waitUntil: 'networkidle' });
  optionChecks.comparisonLinkOn = await option.isChecked();
  await option.uncheck();
  optionChecks.comparisonOverrideCleared = !new URL(optionPage.url()).searchParams.has('render');
  await optionPage.reload({ waitUntil: 'networkidle' });
  optionChecks.rememberOffAfterComparison = !(await option.isChecked());
  if (!Object.values(optionChecks).every(Boolean)) failures.push('텍셀 옵션 전환 또는 선택 저장 오류');
  await optionPage.close();
  if (errors.length) failures.push('브라우저 또는 셰이더 오류');
  const report = { checkedAt: new Date().toISOString(), fixture, room, runtime, optionChecks, errors, failures };
  fs.writeFileSync(path.join(root, 'texel-webgl-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally { await browser.close(); }
