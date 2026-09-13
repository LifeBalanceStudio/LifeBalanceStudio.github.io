import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { normalizeControlMode, joystickInput } from '../touch-controls.mjs';
import { movementInput, touchInteraction, visibleInteraction } from '../world.mjs';

test('조작 방식 저장값은 자동·터치·키보드만 허용한다', () => {
  for (const value of ['auto', 'touch', 'keyboard']) assert.equal(normalizeControlMode(value), value);
  for (const value of [undefined, null, '', false, 'mobile', {}]) assert.equal(normalizeControlMode(value), 'auto');
});

test('스틱 중앙의 작은 흔들림과 잘못된 크기는 이동시키지 않는다', () => {
  assert.equal(joystickInput(1, -1, 32).forward, 0);
  assert.equal(joystickInput(1, -1, 32).right, 0);
  for (const values of [[NaN, 0, 32], [0, Infinity, 32], [2, 3, 0]]) {
    assert.deepEqual(joystickInput(...values), { forward: 0, right: 0, x: 0, y: 0 });
  }
});

test('스틱은 기울기에 따라 움직이고 대각선·범위 밖에서도 속도가 커지지 않는다', () => {
  const half = joystickInput(0, -16, 32), full = joystickInput(0, -32, 32), diagonal = joystickInput(100, -100, 32);
  assert.ok(half.forward > 0 && half.forward < full.forward);
  assert.equal(full.forward, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.forward, diagonal.right) - 1) < 0.000001);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 32) < 0.000001);
  const straightMove = movementInput(full.forward, full.right, 0, 1);
  const diagonalMove = movementInput(diagonal.forward, diagonal.right, 0, 1);
  assert.ok(Math.abs(Math.hypot(straightMove.x, straightMove.z) - Math.hypot(diagonalMove.x, diagonalMove.z)) < 0.000001);
});

function targetAt(z) {
  return { id: 'switch', box: new Box3(new Vector3(-0.02, -0.04, z - 0.02), new Vector3(0.02, 0.04, z + 0.02)) };
}

test('작은 물체는 터치 판정만 넓히고 원본·PC 판정·레이 거리를 보존한다', () => {
  const target = targetAt(-1), original = target.box.clone(), owners = new WeakMap();
  const ray = new Raycaster(new Vector3(0.065, 0, 0), new Vector3(0, 0, -1), 0, 2.15);
  assert.equal(visibleInteraction(ray, [target], [], owners), null);
  assert.deepEqual(touchInteraction(ray, [target], [], owners, 0.06), { target, inRange: true });
  assert.equal(ray.far, 2.15);
  assert.ok(target.box.equals(original));
  assert.equal(visibleInteraction(ray, [target], [], owners), null);
});

test('멀리 있는 물체는 실행 가능한 대상과 구분한다', () => {
  const target = targetAt(-3), owners = new WeakMap();
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1), 0, 2.15);
  assert.deepEqual(touchInteraction(ray, [target], [], owners, 0.06), { target, inRange: false });
  assert.equal(ray.far, 2.15);
});

test('큰 물체의 가까운 모서리가 있어도 레이가 먼 면을 가리키면 실행하지 않는다', () => {
  const target = { id: 'tv', box: new Box3(new Vector3(1.2, -0.1, -3), new Vector3(2.5, 0.1, -1.2)) };
  const ray = new Raycaster(new Vector3(), new Vector3(1.3, 0, -3).normalize(), 0, 2.15);
  assert.ok(target.box.distanceToPoint(ray.ray.origin) < 2.05);
  assert.deepEqual(touchInteraction(ray, [target], [], new WeakMap(), 0.06), { target, inRange: false });
});

test('벽에 가려진 물체는 터치 판정을 넓혀도 선택하지 않는다', () => {
  const target = targetAt(-1), owners = new WeakMap();
  const wall = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial());
  wall.position.z = -0.5; wall.updateMatrixWorld();
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1), 0, 2.15);
  assert.equal(touchInteraction(ray, [target], [wall], owners, 0.06), null);
  wall.geometry.dispose(); wall.material.dispose();
});
