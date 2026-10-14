import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { createExterior } from '../exterior.mjs';
import { createStreetLife, sampleRoute, STREET_LIFE } from '../street-life.mjs';

test('차량과 보행자의 경로가 연결되고 실제 도로와 산책로 위에 유지된다', () => {
  const exterior = createExterior(), life = createStreetLife(exterior);
  const surfaces = [];
  exterior.root.traverse(object => {
    if (object.isMesh && /노면|올림픽대교_도로|도시_진입도로|도시_후면연결도로|공원밖_차도|공원_산책로/.test(object.name)) surfaces.push(object);
  });
  const position = new Vector3(), direction = new Vector3(), ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  for (const route of [life.carRoute, life.roadRoute, life.walkRoute]) {
    assert.ok(route.points[0].distanceTo(route.points.at(-1)) < 0.00001, '왕복 경로의 시작과 끝이 연결되어야 한다');
    for (let i = 0; i < 1000; i++) {
      sampleRoute(route, route.length * i / 1000, position, direction);
      assert.ok(Math.abs(direction.length() - 1) < 0.00001);
      ray.set(position.clone().add(new Vector3(0, 0.3, 0)), down);
      const hit = ray.intersectObjects(surfaces, false)[0];
      assert.ok(hit && Math.abs(hit.point.y - position.y) < 0.085, `도로 이탈: ${position.toArray()} / 높이 ${hit?.point.y}`);
    }
  }
  const roadZ = exterior.park.getObjectByName('공원밖_차도').getWorldPosition(new Vector3()).z;
  for (const distance of [20, life.roadRoute.length * 0.75]) {
    sampleRoute(life.roadRoute, distance, position, direction);
    assert.ok((position.z - roadZ) * direction.x > 0, '새 차도에서 양방향 차량이 진행 방향의 오른쪽을 사용해야 한다');
  }
  const before = life.root.children[0].instanceMatrix.array.slice();
  for (let i = 0; i < 180; i++) life.update(1 / 60);
  assert.notDeepEqual(life.root.children[0].instanceMatrix.array, before, '차량이 이동해야 한다');
  life.root.visible = false;
  const stopped = life.root.children[0].instanceMatrix.array.slice();
  life.update(1 / 60);
  assert.deepEqual(life.root.children[0].instanceMatrix.array, stopped, '꺼진 상태에서는 이동 연산을 생략해야 한다');
  assert.equal(life.root.children.length, 5, '추가 그리기 묶음은 5개로 제한한다');
  assert.equal(life.root.children.slice(0, 3).reduce((sum, mesh) => sum + mesh.count, 0), life.trafficState.active);
  assert.equal(life.root.children.slice(0, 3).reduce((sum, mesh) => sum + mesh.instanceMatrix.array.length / 16, 0), STREET_LIFE.cars);
  assert.equal(life.root.children[3].count, STREET_LIFE.people);
  for (const mesh of life.root.children) assert.equal(mesh.castShadow, false, '동적 그림자 패스를 추가하지 않는다');
});

test('지속적인 프레임 저하에서만 자동 중지하고 비활성 시간은 측정에서 제외한다', () => {
  const life = createStreetLife(createExterior());
  for (let i = 0; i < 900; i++) assert.equal(life.setFrameState(1000 / 60, true), false);
  assert.equal(life.root.visible, true);
  for (let i = 0; i < 200; i++) life.setFrameState(100, false);
  assert.equal(life.root.visible, false);
  life.setFrameState(5000, true);
  for (let i = 0; i < 120; i++) assert.equal(life.setFrameState(50, true), false, '준비 시간과 6초 표본이 충분히 모이기 전에는 중지하지 않는다');
  let stops = 0;
  for (let i = 0; i < 120; i++) if (life.setFrameState(50, true)) stops++;
  assert.equal(stops, 1);
  assert.equal(life.root.visible, false);
  for (let i = 0; i < 900; i++) life.setFrameState(1000 / 60, true);
  assert.equal(life.root.visible, false, '자동 재시도로 부하와 깜빡임을 반복하지 않는다');
});
