import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Ray, Raycaster, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindRoom, movementInput, normalizeMouseSensitivity, normalizeFpsLimit, moveCircle, collisionPush, blindPose, nearestInteraction, visibleInteraction, START, ROOM_BOUNDS, PLAYER_RADIUS, PLAYER_SPEED } from '../world.mjs';

// 브라우저나 GPU를 사용하지 않고 실제 GLB의 기하·변환을 검사한다.
globalThis.self = globalThis;
const loader = new GLTFLoader();
loader.register(() => ({ name: '검증용_텍스처생략', loadTexture: () => Promise.resolve(new Texture()) }));
const buffer = await fs.readFile(new URL('../assets/room.glb', import.meta.url));
const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
const bindings = bindRoom(gltf.scene);

test('FPS 상한은 기본 60을 사용하며 30~120의 정수로 제한한다', () => {
  for (const value of [undefined, null, NaN, Infinity, '120']) assert.equal(normalizeFpsLimit(value), 60);
  assert.equal(normalizeFpsLimit(20), 30);
  assert.equal(normalizeFpsLimit(144), 120);
  assert.equal(normalizeFpsLimit(74.6), 75);
  assert.equal(normalizeFpsLimit(120), 120);
});

test('실제 모델에서 상호작용 대상과 회전된 가구 충돌 범위를 만든다', () => {
  assert.deepEqual(bindings.targets.map(target => target.id), ['tv', 'blind', 'lamp', 'ceiling-light', 'ceiling-switch']);
  assert.equal(bindings.obstacles.length, 5);
  assert.equal(bindings.screen.name, 'CRT_곡면화면');
  assert.deepEqual(bindings.targets[0].outlineObjects.map(object => object.name), ['CRT_TV', 'NES_게임기']);
  assert.deepEqual(bindings.targets[1].outlineObjects.map(object => object.name), ['블라인드_당김줄', '블라인드_줄손잡이']);
  assert.deepEqual(bindings.targets[2].outlineObjects.map(object => object.name), ['스탠드_받침', '스탠드_기둥', '스탠드_갓_항상소등']);
  assert.equal(bindings.owners.get(bindings.lampShade), 'lamp');
  assert.equal(bindings.owners.get(bindings.ceilingDiffuser), 'ceiling-light');
  assert.equal(bindings.owners.get(bindings.switchButton), 'ceiling-switch');
  assert.deepEqual(bindings.targets[4].outlineObjects, [bindings.wallSwitch]);
  const fixture = new Box3().setFromObject(bindings.ceilingFixture);
  assert.ok(Math.abs(fixture.getCenter(new Vector3()).x) < 0.001);
  assert.ok(Math.abs(fixture.max.y - 2.5) < 0.001);
  assert.ok(fixture.max.y - fixture.min.y < 0.07);
  assert.ok(Math.abs(fixture.max.x - fixture.min.x - 0.72) < 0.001);
  const cabinet = bindings.obstacles.find(obstacle => obstacle.name === 'TV장_가구');
  assert.ok(cabinet.axes.some(axis => Math.abs(axis.x) > 0.3 && Math.abs(axis.z) > 0.3));
});

test('마우스 감도는 이전 설정 누락과 잘못된 값에서 기본값을 사용하고 허용 범위로 제한한다', () => {
  for (const value of [undefined, null, NaN, Infinity, '1', false, {}]) assert.equal(normalizeMouseSensitivity(value), 1);
  assert.equal(normalizeMouseSensitivity(-4), 0.25);
  assert.equal(normalizeMouseSensitivity(4), 2);
  assert.equal(normalizeMouseSensitivity(1.234), 1.23);
  assert.equal(normalizeMouseSensitivity(0.5), 0.5);
});

test('문 오른쪽 벽 스위치는 눈높이 아래에서 조작하며 벽 뒤의 입력은 가려진다', () => {
  const box = new Box3().setFromObject(bindings.wallSwitch), center = box.getCenter(new Vector3());
  assert.ok(Math.abs(center.x - 0.96) < 0.001);
  assert.ok(Math.abs(center.y - 1.15) < 0.001);
  assert.ok(box.min.z > 1.65 && box.max.z <= 1.701);
  assert.ok(Math.abs(box.max.x - box.min.x - 0.09) < 0.001);
  const eye = new Vector3(0.6, START.y, 0.6);
  const ray = new Raycaster(eye, center.clone().sub(eye).normalize(), 0, 2.15);
  assert.equal(visibleInteraction(ray, bindings.targets, bindings.meshes, bindings.owners)?.id, 'ceiling-switch');
  const outside = new Vector3(0.96, 1.15, 2.1);
  ray.set(outside, center.clone().sub(outside).normalize());
  assert.equal(visibleInteraction(ray, bindings.targets, bindings.meshes, bindings.owners), null);
});

test('대각선 이동이 직선 이동보다 빨라지지 않는다', () => {
  const straight = movementInput(1, 0, 0, 0.016);
  const diagonal = movementInput(1, 1, 0, 0.016);
  assert.ok(Math.abs(Math.hypot(straight.x, straight.z) - Math.hypot(diagonal.x, diagonal.z)) < 1e-10);
  const rotated = movementInput(1, 0, -Math.PI / 2, 0.016);
  assert.ok(rotated.x > 0 && Math.abs(rotated.z) < 1e-10);
});

test('열린 현관문 너머는 이동 가능한 위치에서 비스듬히 보아도 검은 차폐벽으로 막힌다', () => {
  const blocker = bindings.entranceBlocker;
  assert.equal(blocker.material.color.getHex(), 0);
  assert.equal(blocker.material.fog, false);
  assert.equal(blocker.material.toneMapped, false);
  assert.equal(blocker.material.transparent, false);
  assert.ok(blocker.position.z > ROOM_BOUNDS.maxZ);
  let blocked = 0;
  for (const x of [-1.2, -0.6, 0.08, 0.6, 1.2]) for (const z of [-0.6, 0.3, 1.2, 1.5]) {
    const eye = new Vector3(x, START.y, z);
    if (bindings.obstacles.some(obstacle => collisionPush(eye, obstacle))) continue;
    for (const doorX of [-0.3, 0.15, 0.6]) for (const doorY of [0.1, 1, 2.05]) {
      const point = new Vector3(doorX, doorY, 1.705);
      const ray = new Raycaster(eye, point.sub(eye).normalize(), 0, 20);
      const hit = ray.intersectObjects(bindings.meshes, false)[0];
      assert.ok(hit, '현관 너머로 뚫린 시야: ' + [x, z, doorX, doorY]);
      if (hit.object === blocker) blocked++;
    }
  }
  assert.ok(blocked > 20);
});

test('시작 위치는 가구 안이 아니다', () => {
  for (const obstacle of bindings.obstacles) assert.equal(collisionPush(START, obstacle), null, obstacle.name);
});

test('1~120FPS에서 실제 방 통로의 1초 이동 거리가 일정하다', () => {
  for (const fps of [1, 3, 5, 10, 15, 30, 60, 120]) {
    let position = { ...START };
    for (let frame = 0; frame < fps; frame++) position = moveCircle(position, movementInput(1, 0, 0, 1 / fps), bindings.obstacles);
    assert.ok(Math.abs(START.z - position.z - PLAYER_SPEED) < 1e-8, fps + 'FPS');
    assert.ok(Math.abs(position.x - START.x) < 1e-8);
    for (const obstacle of bindings.obstacles) assert.equal(collisionPush(position, obstacle, PLAYER_RADIUS - 0.001), null);
  }
});

test('프레임 간격이 흔들려도 경과한 1초만큼 이동한다', () => {
  let position = { ...START };
  for (const seconds of [0.016, 0.18, 0.042, 0.11, 0.25, 0.067, 0.035, 0.3]) {
    position = moveCircle(position, movementInput(1, 0, 0, seconds), bindings.obstacles);
  }
  assert.ok(Math.abs(START.z - position.z - PLAYER_SPEED) < 1e-8);
});

test('유효한 긴 프레임은 반영하고 비정상 값과 긴 중단 시간은 이동에서 제외한다', () => {
  assert.equal(Math.abs(movementInput(1, 0, 0, 0.5).z), PLAYER_SPEED * 0.5);
  for (const seconds of [0, -1, NaN, Infinity, 60]) assert.deepEqual(movementInput(1, 0, 0, seconds), { x: 0, z: 0 });
});

test('한 프레임의 이동이 커도 얇은 충돌 벽을 반대편으로 통과하지 않는다', () => {
  const wall = { x: 0, z: 0, axes: [{ x: 1, z: 0, half: 0.6 }, { x: 0, z: 1, half: 0.005 }] };
  for (const side of [-1, 1]) {
    const moved = moveCircle({ x: 0, z: side }, { x: 0, z: -side * 3 }, [wall]);
    assert.ok(moved.z * side >= PLAYER_RADIUS + 0.005 - 1e-6);
  }
});

test('큰 이동량으로도 가구를 관통하거나 방 경계를 벗어나지 않는다', () => {
  for (const delta of [{ x: -4, z: -2 }, { x: 4, z: -4 }, { x: 0, z: -5 }, { x: 0, z: 5 }]) {
    const moved = moveCircle(START, delta, bindings.obstacles);
    assert.ok(moved.x >= ROOM_BOUNDS.minX + PLAYER_RADIUS - 1e-6);
    assert.ok(moved.x <= ROOM_BOUNDS.maxX - PLAYER_RADIUS + 1e-6);
    assert.ok(moved.z >= ROOM_BOUNDS.minZ + PLAYER_RADIUS - 1e-6);
    assert.ok(moved.z <= ROOM_BOUNDS.maxZ - PLAYER_RADIUS + 1e-6);
    for (const obstacle of bindings.obstacles) assert.equal(collisionPush(moved, obstacle, PLAYER_RADIUS - 0.001), null, obstacle.name);
  }
});

test('거리 밖 대상과 뒤쪽 대상을 선택하지 않는다', () => {
  const target = { id: '검사', box: new Box3(new Vector3(-0.2, 1, -1.2), new Vector3(0.2, 1.7, -1)) };
  assert.equal(nearestInteraction(new Ray(new Vector3(0, 1.35, 3), new Vector3(0, 0, -1)), [target]), null);
  assert.equal(nearestInteraction(new Ray(new Vector3(0, 1.35, 0), new Vector3(0, 0, 1)), [target]), null);
  assert.equal(nearestInteraction(new Ray(new Vector3(0, 1.35, 0), new Vector3(0, 0, -1)), [target]).target.id, '검사');
});

test('실제 통로에서 게임기와 블라인드 줄, 무드등을 조작 거리 안에서 바라볼 수 있다', () => {
  const samples = [
    { id: 'tv', position: new Vector3(-0.06, 1.35, -0.30), point: new Box3().setFromObject(bindings.screen).getCenter(new Vector3()) },
    { id: 'blind', position: new Vector3(-0.06, 1.35, -1.32), point: new Vector3(-1.428, 1.34, -1.69) },
    { id: 'lamp', position: new Vector3(-0.06, 1.35, 0.3), point: new Box3().setFromObject(bindings.lampShade).getCenter(new Vector3()) },
    { id: 'ceiling-light', position: new Vector3(0.3, 1.35, 0.5), point: new Box3().setFromObject(bindings.ceilingDiffuser).getCenter(new Vector3()) }
  ];
  for (const sample of samples) {
    for (const obstacle of bindings.obstacles) assert.equal(collisionPush(sample.position, obstacle, PLAYER_RADIUS - 0.005), null, sample.id + ':' + obstacle.name);
    const ray = new Ray(sample.position, sample.point.clone().sub(sample.position).normalize());
    assert.equal(nearestInteraction(ray, bindings.targets)?.target.id, sample.id);
    const raycaster = new Raycaster(ray.origin, ray.direction, 0, 2.15);
    assert.equal(visibleInteraction(raycaster, bindings.targets, bindings.meshes, bindings.owners)?.id, sample.id);
  }
});

test('앞에 물체가 가린 상호작용 대상은 선택하지 않는다', () => {
  const blocker = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial());
  blocker.position.set(0, 1.35, -0.5);
  blocker.updateMatrixWorld();
  const target = { id: '뒤쪽', box: new Box3(new Vector3(-0.2, 1, -1.2), new Vector3(0.2, 1.7, -1)) };
  const caster = new Raycaster(new Vector3(0, 1.35, 0), new Vector3(0, 0, -1), 0, 2.15);
  assert.equal(visibleInteraction(caster, [target], [blocker], new WeakMap()), null);
});

test('시작 위치에서 실제 통로를 따라 방 뒤쪽까지 이동할 수 있다', () => {
  let point = { x: START.x, z: START.z };
  for (let i = 0; i < 180; i++) point = moveCircle(point, movementInput(1, 0, 0, 0.016), bindings.obstacles);
  assert.ok(point.z < -1.25);
  for (const obstacle of bindings.obstacles) assert.equal(collisionPush(point, obstacle, PLAYER_RADIUS - 0.001), null, obstacle.name);
});

test('블라인드 개방도를 변경해도 상단은 고정되고 하단 봉이 천 끝을 따른다', () => {
  const results = [0, 0.5, 1].map(blindPose);
  assert.ok(results[0].height > results[1].height && results[1].height > results[2].height);
  for (const pose of results) {
    assert.ok(Math.abs(pose.centerY + pose.height / 2 - 2.395) < 1e-8);
    assert.ok(Math.abs(pose.centerY - pose.height / 2 - pose.barY) < 1e-8);
  }
  assert.equal(blindPose(-2).opening, 0);
  assert.equal(blindPose(3).opening, 1);
});

test('화면의 위쪽 정점은 캔버스의 위쪽 UV에 대응한다', () => {
  const positions = bindings.screen.geometry.getAttribute('position');
  const uv = bindings.screen.geometry.getAttribute('uv');
  let top = { y: -Infinity, v: null };
  let bottom = { y: Infinity, v: null };
  for (let i = 0; i < positions.count; i++) {
    const vertex = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(bindings.screen.matrixWorld);
    if (vertex.y > top.y) top = { y: vertex.y, v: uv.getY(i) };
    if (vertex.y < bottom.y) bottom = { y: vertex.y, v: uv.getY(i) };
  }
  assert.ok(top.v < bottom.v);
  assert.ok(top.v < 0.1 && bottom.v > 0.9);
});
