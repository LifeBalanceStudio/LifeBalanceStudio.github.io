import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/mobile-controls-2026-09-14');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
fs.mkdirSync(output, { recursive: true });
const results = [];
const hook = `
const mobileReleases = [];
document.addEventListener('pointerup', event => { if (event.pointerType === 'touch') mobileReleases.push({ id: event.pointerId, ...touchControls.state }); });
globalThis.__mobileQA = {
  get ready() { return mode === 'ready'; },
  get state() { return { mode, controlMode, touchMode, control: touchControls.state, yaw, pitch,
    position: camera.position.toArray(), worldPosition: [camera.matrixWorld.elements[12], camera.matrixWorld.elements[13], camera.matrixWorld.elements[14]],
    ceilingOn: ceilingLamp.on, blindOpen: blindDialog.open, tvDetail: tvMenu?.detail, fpsLimit, frame: renderer.info.render.frame }; },
  get releases() { return mobileReleases; },
  reset() {
    setMode('explore'); camera.position.set(START.x, START.y, START.z);
    yaw = START.yaw; pitch = START.pitch; camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.updateMatrixWorld(); canvas.focus(); mobileReleases.length = 0;
  },
  aim(id, position, offset = 0.1) {
    setMode('explore'); camera.position.fromArray(position);
    camera.lookAt(targets.find(t => t.id === id).box.getCenter(new THREE.Vector3()));
    yaw = camera.rotation.y + offset; pitch = camera.rotation.x;
    camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld();
    return this.project(id);
  },
  project(id) {
    const box = targets.find(t => t.id === id).box, bounds = canvas.getBoundingClientRect();
    const center = box.getCenter(new THREE.Vector3()).project(camera);
    const points = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      points.push({ x: bounds.left + (p.x + 1) * bounds.width / 2, y: bounds.top + (1 - p.y) * bounds.height / 2 });
    }
    return { x: bounds.left + (center.x + 1) * bounds.width / 2, y: bounds.top + (1 - center.y) * bounds.height / 2,
      right: Math.max(...points.map(p => p.x)), left: Math.min(...points.map(p => p.x)) };
  },
  directAt(x, y) {
    const b = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x - b.left) / b.width * 2 - 1, 1 - (y - b.top) / b.height * 2), camera);
    return visibleInteraction(raycaster, targets, meshes, owners)?.id || null;
  },
  inspectTap(x, y) {
    const b = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x-b.left)/b.width*2-1, 1-(y-b.top)/b.height*2), camera);
    const hit = touchInteraction(raycaster, targets, meshes, owners, Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*44/b.height);
    const target = targets.find(t => t.id === 'ceiling-switch');
    const distance = target.box.distanceToPoint(camera.position), padding = Math.min(0.16, distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*44/b.height);
    const point = raycaster.ray.intersectBox(target.box.clone().expandByScalar(padding), new THREE.Vector3());
    return { target: hit?.target.id, inRange: hit?.inRange, element: document.elementFromPoint(x,y)?.id,
      distance, padding, expandedDistance: point ? point.distanceTo(camera.position) : null,
      blockers: raycaster.intersectObjects(meshes, false).slice(0,2).map(h => ({ name: h.object.name, distance: h.distance })) };
  },
  tvBounds() {
    camera.updateMatrixWorld(); const positions = screen.geometry.attributes.position, points = [];
    for (let i = 0; i < positions.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(screen.matrixWorld).project(camera).toArray());
    }
    return points;
  },
  tvPoint(u, v) {
    const geometry = screen.geometry, uv = geometry.attributes.uv, positions = geometry.attributes.position;
    const count = geometry.index?.count || positions.count, wanted = new THREE.Vector3(u, v, 0);
    for (let i = 0; i < count; i += 3) {
      const ids = [0,1,2].map(n => geometry.index ? geometry.index.getX(i+n) : i+n);
      const coords = ids.map(n => new THREE.Vector3(uv.getX(n), uv.getY(n), 0));
      const bary = new THREE.Triangle(...coords).getBarycoord(wanted, new THREE.Vector3());
      if (!bary || Math.min(bary.x, bary.y, bary.z) < -0.0001) continue;
      const world = new THREE.Vector3();
      ids.forEach((n,j) => world.addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,n), bary.getComponent(j)));
      world.applyMatrix4(screen.matrixWorld).project(camera);
      const box = canvas.getBoundingClientRect();
      return { x: box.left + (world.x+1)*box.width/2, y: box.top + (1-world.y)*box.height/2 };
    }
    throw Error('TV 터치 좌표를 찾지 못했습니다.');
  }
};`;
const source = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + hook;
const state = page => page.evaluate(() => globalThis.__mobileQA.state);

async function prepare(browser, name, mobile, errors) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 800 },
    hasTouch: mobile, reducedMotion: 'reduce', deviceScaleFactor: mobile ? 2 : 1, ...(mobile && name === 'chrome' ? { isMobile: true } : {}) });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__lockCalls = 0;
    const request = HTMLCanvasElement.prototype.requestPointerLock;
    HTMLCanvasElement.prototype.requestPointerLock = function(...args) { globalThis.__lockCalls++; return request?.apply(this, args); };
    const key = 'lifebalance.room.preferences.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ fpsLimit: 60, mouseSensitivity: 0.75, audio: { enabled: false, master: 0.42 } }));
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/room-preview/app.mjs')) return route.fulfill({ contentType: 'text/javascript', body: source });
    if (url.origin !== new URL(base).origin || url.pathname.includes('/api/')) return route.abort();
    return route.continue();
  });
  await page.goto(new URL('room-preview/?review=1', base).href);
  await page.waitForFunction(() => globalThis.__mobileQA?.ready);
  if (await page.locator('#environment-review').getAttribute('open') !== null) await page.locator('#environment-review > summary').click();
  return { page, context };
}

async function chooseMode(page, value) {
  if (await page.locator('#view-settings').getAttribute('open') === null) await page.locator('#view-settings > summary').click();
  await page.locator('#control-mode').selectOption(value);
  await page.locator('#view-settings > summary').click();
}

async function touchSender(page, context, name) {
  if (name === 'chrome') {
    const cdp = await context.newCDPSession(page);
    return (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type,
      touchPoints: points.map(p => ({ ...p, radiusX: 6, radiusY: 6, force: 1 })) });
  }
  // Firefox의 다중 손가락 소유권은 DOM 포인터 이벤트로 검사하고 단일 탭은 실제 터치 입력을 사용한다.
  return (type, points = []) => page.evaluate(({ type, points }) => {
    const active = globalThis.__simTouches ||= new Map();
    const next = new Set(points.map(p => p.id));
    function send(item, event) {
      item.target.dispatchEvent(new PointerEvent(event, { pointerId: 100 + item.id, pointerType: 'touch',
        clientX: item.x, clientY: item.y, button: 0, buttons: /up|cancel/.test(event) ? 0 : 1, bubbles: true, cancelable: true }));
    }
    for (const [id, old] of active) if (!next.has(id)) { send(old, type === 'touchCancel' ? 'pointercancel' : 'pointerup'); active.delete(id); }
    for (const p of points) {
      const old = active.get(p.id);
      if (!old) {
        const item = { ...p, target: document.elementFromPoint(p.x, p.y) }; active.set(p.id, item); send(item, 'pointerdown');
      } else { Object.assign(old, p); send(old, 'pointermove'); }
    }
  }, { type, points });
}

for (const [name, engine] of [['chrome', chromium], ['firefox', firefox]]) {
  if (process.env.MOBILE_BROWSER && process.env.MOBILE_BROWSER !== name) continue;
  const browser = await engine.launch({ headless: true, ...(name === 'chrome' ? { executablePath: process.env.CHROME_EXECUTABLE || undefined } : {}) });
  const row = { browser: name, version: browser.version(), checks: [], errors: [], passed: false };
  results.push(row);
  try {
    const desktop = await prepare(browser, name, false, row.errors);
    assert.equal((await state(desktop.page)).touchMode, false);
    await desktop.page.setViewportSize({ width: 390, height: 844 });
    assert.equal((await state(desktop.page)).touchMode, false);
    await chooseMode(desktop.page, 'touch');
    assert.equal((await state(desktop.page)).touchMode, true);
    await desktop.page.locator('#enter-button').click();
    await desktop.page.locator('#move-stick').waitFor({ state: 'visible' });
    assert.equal(await desktop.page.evaluate(() => globalThis.__lockCalls), 0);
    const mouseStick = await desktop.page.locator('#move-stick').boundingBox();
    const mouseBefore = await state(desktop.page);
    await desktop.page.mouse.move(mouseStick.x + mouseStick.width / 2, mouseStick.y + mouseStick.height / 2);
    await desktop.page.mouse.down(); await desktop.page.mouse.move(mouseStick.x + mouseStick.width / 2, mouseStick.y + 10);
    await desktop.page.waitForTimeout(150); await desktop.page.mouse.up();
    assert.ok(Math.abs((await state(desktop.page)).position[2] - mouseBefore.position[2]) > 0.05);
    await chooseMode(desktop.page, 'keyboard');
    assert.equal(await desktop.page.locator('#touch-controls').isVisible(), false);
    const saved = await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('lifebalance.room.preferences.v1')));
    assert.equal(saved.controlMode, 'keyboard'); assert.equal(saved.mouseSensitivity, 0.75); assert.equal(saved.audio.master, 0.42);
    await desktop.page.reload(); await desktop.page.waitForFunction(() => globalThis.__mobileQA?.ready);
    assert.equal((await state(desktop.page)).controlMode, 'keyboard');
    row.checks.push('데스크톱은 작은 창에서도 자동 키보드 조작이며 설정에서 터치를 호출하고 선택·기존 설정을 저장한다');
    await desktop.context.close();

    const { page, context } = await prepare(browser, name, true, row.errors);
    row.coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    assert.equal((await state(page)).touchMode, row.coarsePointer);
    if (!row.coarsePointer) await chooseMode(page, 'touch');
    assert.match(await page.locator('#entry-description').textContent(), /왼쪽 스틱/);
    await page.locator('#enter-button').click();
    await page.locator('#move-stick').waitFor({ state: 'visible' });
    const initialFrame = (await state(page)).frame;
    await page.waitForFunction(frame => globalThis.__mobileQA.state.frame > frame, initialFrame);
    assert.equal(await page.locator('#reticle').isVisible(), false);
    assert.equal(await page.evaluate(() => globalThis.__lockCalls), 0);
    row.checks.push('터치 기기 판정·터치 안내·스틱 표시·마우스 고정 생략을 확인한다');
    await page.screenshot({ path: path.join(output, name + '-portrait.png') });

    const send = await touchSender(page, context, name);
    await page.evaluate(() => globalThis.__mobileQA.reset());
    const box = await page.locator('#move-stick').boundingBox();
    const left = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const right = { id: 2, x: 260, y: 430 };
    const before = await state(page);
    await send('touchStart', [left]);
    left.y -= 32;
    await send('touchMove', [left]);
    await send('touchStart', [left, right]);
    right.x += 42;
    await send('touchMove', [left, right]);
    await page.waitForTimeout(250);
    const moving = await state(page);
    assert.ok(Math.hypot(moving.position[0] - before.position[0], moving.position[2] - before.position[2]) > 0.08);
    assert.ok(Math.abs(moving.yaw - before.yaw) > 0.05);
    assert.ok(Math.hypot(...moving.position.map((v,i) => v - moving.worldPosition[i])) < 0.001);
    assert.notEqual(moving.control.stickPointer, null); assert.notEqual(moving.control.lookPointer, null);
    if (name === 'chrome') {
      await send('touchEnd');
      const releases = await page.evaluate(() => globalThis.__mobileQA.releases);
      assert.ok(releases.some(r => (r.stickPointer === null) !== (r.lookPointer === null)));
    } else {
      await send('touchMove', [right]);
      const released = await state(page);
      assert.equal(released.control.forward, 0); assert.equal(released.control.right, 0);
      assert.notEqual(released.control.lookPointer, null);
      right.x -= 20; await send('touchMove', [right]); await send('touchEnd');
    }
    const stopped = await state(page); await page.waitForTimeout(120);
    const still = await state(page);
    assert.ok(Math.hypot(still.position[0] - stopped.position[0], still.position[2] - stopped.position[2]) < 0.01);
    assert.equal(still.control.lookPointer, null);
    row.checks.push(name === 'chrome' ? '브라우저 다중 터치로 동시 이동·회전과 손가락별 해제 상태를 확인한다' : '다중 포인터 이벤트로 동시 이동·회전과 손가락별 독립 해제를 확인한다');

    await send('touchStart', [{ id: 1, x: box.x + box.width / 2, y: box.y + 6 }]);
    assert.ok((await state(page)).control.forward > 0);
    await send('touchCancel');
    assert.equal((await state(page)).control.forward, 0);
    await page.locator('#touch-pause').click();
    assert.equal((await state(page)).mode, 'paused');
    assert.equal(await page.locator('#touch-controls').isVisible(), false);
    await page.locator('#resume-button').click();
    await page.locator('#move-stick').waitFor({ state: 'visible' });
    row.checks.push('터치 취소와 화면의 일시정지·재개 버튼이 입력을 해제한다');

    let point = await page.evaluate(() => globalThis.__mobileQA.aim('ceiling-switch', [0.08, 1.35, 1.25]));
    const lightBefore = (await state(page)).ceilingOn;
    assert.ok(Math.abs(point.x - 195) > 10);
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForTimeout(350);
    assert.equal((await state(page)).ceilingOn, !lightBefore);
    point = await page.evaluate(() => globalThis.__mobileQA.aim('ceiling-switch', [0.08, 1.35, 1.25]));
    const dragBefore = await state(page);
    const finger = { id: 3, x: point.x, y: point.y };
    await send('touchStart', [finger]); finger.x += 35; await send('touchMove', [finger]); await send('touchEnd');
    assert.equal((await state(page)).ceilingOn, dragBefore.ceilingOn);
    assert.ok(Math.abs((await state(page)).yaw - dragBefore.yaw) > 0.01);
    point = await page.evaluate(() => globalThis.__mobileQA.aim('ceiling-switch', [0.08, 1.35, 1.25]));
    await send('touchStart', [{ id: 3, x: point.x, y: point.y }]); await page.waitForTimeout(550); await send('touchEnd');
    assert.equal((await state(page)).ceilingOn, dragBefore.ceilingOn);
    row.checks.push('조준점 밖의 물체를 한 번 탭하면 작동하고 물체 위에서 시작한 드래그는 작동시키지 않는다');

    point = await page.evaluate(() => globalThis.__mobileQA.aim('ceiling-switch', [0.08, 1.35, 1.25]));
    const blockedSide = { x: point.right + 6, y: point.y };
    const assisted = { x: point.left - 6, y: point.y };
    assert.equal(await page.evaluate(p => globalThis.__mobileQA.directAt(p.x, p.y), assisted), null);
    const assistBefore = (await state(page)).ceilingOn;
    row.assisted = { point, assisted, ...(await page.evaluate(p => globalThis.__mobileQA.inspectTap(p.x,p.y), assisted)),
      blockedSide: await page.evaluate(p => globalThis.__mobileQA.inspectTap(p.x,p.y), blockedSide) };
    await page.screenshot({ path: path.join(output, name + '-switch-target.png') });
    await page.touchscreen.tap(blockedSide.x, blockedSide.y);
    assert.equal((await state(page)).ceilingOn, assistBefore);
    await page.touchscreen.tap(assisted.x, assisted.y);
    assert.equal((await state(page)).ceilingOn, !assistBefore);
    point = await page.evaluate(() => globalThis.__mobileQA.aim('tv', [-1.3, 1.35, 1.45]));
    await page.touchscreen.tap(point.x, point.y);
    assert.equal((await state(page)).mode, 'explore');
    assert.match(await page.locator('#notice').textContent(), /가까이/);
    row.checks.push('작은 스위치의 보이는 쪽 여유 영역은 작동하고 문틀 뒤 판정은 차단하며 먼 물체는 거리 안내를 표시한다');

    point = await page.evaluate(() => globalThis.__mobileQA.aim('blind', [0.08, 1.35, -1.6]));
    await page.touchscreen.tap(point.x, point.y);
    assert.equal((await state(page)).blindOpen, true);
    assert.equal(await page.locator('#touch-controls').isVisible(), false);
    await page.locator('#blind-close').click();
    assert.equal((await state(page)).mode, 'explore');
    point = await page.evaluate(() => globalThis.__mobileQA.aim('tv', [0.08, 1.35, 0.3]));
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(() => globalThis.__mobileQA.state.mode === 'tv');
    assert.equal(await page.locator('#touch-controls').isVisible(), false);
    const pageLabel = await page.locator('#tv-selection').textContent();
    let tvPoint = await page.evaluate(() => globalThis.__mobileQA.tvPoint(0.5, 0.32));
    await page.touchscreen.tap(tvPoint.x, tvPoint.y);
    assert.notEqual(await page.locator('#tv-selection').textContent(), pageLabel);
    tvPoint = await page.evaluate(() => globalThis.__mobileQA.tvPoint(0.5, 0.22));
    await page.touchscreen.tap(tvPoint.x, tvPoint.y);
    assert.equal((await state(page)).tvDetail, true);
    let corners = await page.evaluate(() => globalThis.__mobileQA.tvBounds());
    assert.ok(corners.every(p => Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1));
    await page.screenshot({ path: path.join(output, name + '-tv-portrait.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    corners = await page.evaluate(() => globalThis.__mobileQA.tvBounds());
    assert.ok(corners.every(p => Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, name + '-tv-landscape.png') });
    for (let i = 0; i < 3 && (await state(page)).mode === 'tv'; i++) await page.locator('#tv-back').click();
    await page.waitForFunction(() => globalThis.__mobileQA.state.mode === 'explore');
    const landscapeStick = await page.locator('#move-stick').boundingBox();
    assert.ok(landscapeStick.y >= 0 && landscapeStick.y + landscapeStick.height <= 390);
    await page.screenshot({ path: path.join(output, name + '-landscape.png') });
    row.checks.push('블라인드·TV 터치와 조작 복귀, 세로·가로 화면의 TV 맞춤과 스틱 배치를 확인한다');

    await page.locator('#view-settings > summary').click();
    await page.locator('#touch-controls').waitFor({ state: 'hidden' });
    await page.locator('#view-settings > summary').click();
    await page.locator('#move-stick').waitFor({ state: 'visible' });
    const finalBox = await page.locator('#move-stick').boundingBox();
    await send('touchStart', [{ id: 4, x: finalBox.x + finalBox.width / 2, y: finalBox.y + 10 }]);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await state(page)).mode, 'paused');
    assert.equal((await state(page)).control.forward, 0);
    await send('touchCancel');
    await chooseMode(page, 'keyboard');
    assert.equal((await state(page)).touchMode, false);
    await chooseMode(page, 'auto');
    assert.equal((await state(page)).touchMode, row.coarsePointer);
    row.checks.push('설정창과 창 이탈 시 이동이 멈추고 스틱이 숨겨진다');
    assert.deepEqual(row.errors, []);
    row.passed = true;
    await context.close();
  } catch (error) {
    row.failure = error.stack;
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify(results, null, 2));
  }
}
console.log(JSON.stringify(results, null, 2));
