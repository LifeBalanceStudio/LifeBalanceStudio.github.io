import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Box3, PerspectiveCamera, Raycaster, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createExterior, EXTERIOR, exteriorLighting } from '../exterior.mjs';
import { bindRoom, blindPose, collisionPush, START } from '../world.mjs';
import { seoulDaylight } from '../mood-light.mjs';

globalThis.self = globalThis;
const loader = new GLTFLoader();
loader.register(() => ({ name: '검증용_텍스처생략', loadTexture: () => Promise.resolve(new Texture()) }));
const buffer = await fs.readFile(new URL('../assets/room.glb', import.meta.url));
const { scene: room } = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
const bindings = bindRoom(room);
const exterior = createExterior();
exterior.root.updateMatrixWorld(true);
const roomMeshes = [];
const exteriorMeshes = [];
const cityBuildings = [];
room.traverse(object => { if (object.isMesh && !object.name.includes('통유리')) roomMeshes.push(object); });
exterior.root.traverse(object => {
  if (object.isMesh) exteriorMeshes.push(object);
  if (object.name === '도시_건물묶음') cityBuildings.push(object);
});

function setBlind(opening) {
  const pose = blindPose(opening);
  bindings.fabric.scale.y = pose.height;
  bindings.fabric.position.y = pose.centerY;
  bindings.bottomBar.position.y = pose.barY;
  room.updateMatrixWorld(true);
}

function firstHit(eye, point) {
  const ray = new Raycaster(eye, point.clone().sub(eye).normalize(), 0, eye.distanceTo(point) + 0.2);
  return ray.intersectObjects([...roomMeshes, ...exteriorMeshes], false)[0]?.object;
}

test('공원은 창 아래, 다리는 왼쪽, 타워와 도시는 강 건너 실제 공간에 놓인다', () => {
  assert.ok(new Box3().setFromObject(exterior.park).max.y < 0);
  assert.ok(exterior.bridge.position.x < 0);
  assert.ok(exterior.tower.getWorldPosition(new Vector3()).z < exterior.water.position.z);
  assert.ok(exterior.water.position.y < EXTERIOR.groundY);
  assert.equal(exterior.tower.getObjectByName('롯데월드타워_곡선입면').isMesh, true);
  assert.equal(exterior.bridge.getObjectByName('올림픽대교_주탑').children.filter(object => object.name === '올림픽대교_주탑기둥').length, 4);
});

test('맞은편의 모든 건물 밑면과 타워 기단이 확장한 지면 위에 놓인다', () => {
  const land = new Box3().setFromObject(exterior.root.getObjectByName('강건너_둔치'));
  const buildings = cityBuildings;
  assert.ok(buildings.length >= 100, '강 건너 도시가 충분히 촘촘하게 구성되어야 한다');
  const footprints = buildings.map(object => new Box3().setFromObject(object));
  for (let i = 0; i < footprints.length; i++) for (let j = i + 1; j < footprints.length; j++) {
    assert.equal(footprints[i].intersectsBox(footprints[j]), false, '도시 건물끼리 겹치지 않아야 한다');
  }
  for (const object of [...buildings, exterior.tower]) {
    const bounds = new Box3().setFromObject(object);
    assert.ok(bounds.min.x >= land.min.x && bounds.max.x <= land.max.x);
    assert.ok(bounds.min.z >= land.min.z && bounds.max.z <= land.max.z);
    assert.ok(Math.abs(bounds.min.y - land.max.y) < 1e-6);
  }
});

test('건물은 깊이보다 좌우로 넓게 이어지고 창가의 좌우 50도 바깥 시야에도 보인다', () => {
  setBlind(0.88);
  const buildings = cityBuildings;
  const bounds = new Box3();
  for (const building of buildings) bounds.union(new Box3().setFromObject(building));
  const size = bounds.getSize(new Vector3());
  assert.ok(size.x > size.z * 5, '도시는 뒤로 쌓기보다 수평으로 넓게 펼쳐져야 한다');
  const eye = new Vector3(0.08, 1.35, -1.6);
  for (const side of [-1, 1]) {
    const visible = buildings.some(building => {
      const point = new Box3().setFromObject(building).getCenter(new Vector3());
      if (Math.sign(point.x - eye.x) !== side) return false;
      const angle = Math.atan2(Math.abs(point.x - eye.x), eye.z - point.z) * 180 / Math.PI;
      if (angle < 50) return false;
      let hit = firstHit(eye, point);
      while (hit && !cityBuildings.includes(hit)) hit = hit.parent;
      return Boolean(hit);
    });
    assert.ok(visible, (side < 0 ? '왼쪽' : '오른쪽') + ' 먼 시야에도 실제 도시 건물이 보여야 한다');
  }
});

test('원경판은 후면과 양옆을 덮고 지면·수면과 겹치며 표시 범위 안에 있다', () => {
  assert.equal(exterior.backdrop.children.length, 3);
  const eye = new Vector3(0.08, 1.35, -1.6);
  const targets = [new Vector3(0, -12, -400), new Vector3(-340, -12, -90), new Vector3(340, -12, -90)];
  setBlind(0.88);
  for (const point of targets) {
    const ray = new Raycaster(eye, point.clone().sub(eye).normalize(), 0, EXTERIOR.far);
    const hit = ray.intersectObject(exterior.backdrop, true)[0];
    assert.ok(hit, '원경판이 없는 방향: ' + point.toArray());
    assert.ok(hit.point.y < EXTERIOR.groundY + 1, '배경판이 채워지는 하단 영역이어야 한다');
    const visible = firstHit(eye, point);
    assert.ok(visible && visible.name !== '창밖_하늘');
  }
  for (const panel of exterior.backdrop.children) {
    const bounds = new Box3().setFromObject(panel);
    assert.ok(bounds.min.y < EXTERIOR.groundY);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      assert.ok(new Vector3(x, y, z).distanceTo(eye) < EXTERIOR.far);
    }
  }
  const water = new Box3().setFromObject(exterior.water);
  const bank = new Box3().setFromObject(exterior.root.getObjectByName('강건너_둔치'));
  const park = new Box3().setFromObject(exterior.root.getObjectByName('공원_지면'));
  assert.ok(water.min.z < bank.max.z && water.max.z > park.min.z);
  const left = exterior.backdrop.getObjectByName('원경_좌측판').position.x;
  const right = exterior.backdrop.getObjectByName('원경_우측판').position.x;
  for (const surface of [water, bank, park]) assert.ok(surface.min.x < left && surface.max.x > right);
});

test('도시의 진입도로는 강변도로와 후면도로를 연결하며 건물과 겹치지 않는다', () => {
  const streets = exteriorMeshes.filter(object => object.name === '도시_진입도로');
  const rear = exteriorMeshes.filter(object => object.name === '도시_후면연결도로').map(object => new Box3().setFromObject(object));
  const waterfront = new Box3().setFromObject(exterior.root.getObjectByName('강건너_강변도로'));
  assert.ok(streets.length >= 8);
  for (const street of streets) {
    const road = new Box3().setFromObject(street);
    assert.ok(road.intersectsBox(waterfront));
    assert.ok(rear.some(bounds => road.intersectsBox(bounds)));
    for (const building of cityBuildings) assert.equal(road.intersectsBox(new Box3().setFromObject(building)), false);
  }
  assert.equal(exteriorMeshes.filter(object => object.name === '도시_보도부지').length, 11);
  const approach = exterior.root.getObjectByName('남단접속로_노면');
  const vertices = approach.geometry.getAttribute('position');
  const normals = approach.geometry.getAttribute('normal');
  assert.ok(Math.abs(vertices.getY(0) - (-5.6 + 0.2175)) < 1e-5);
  assert.ok(Math.abs(vertices.getY(vertices.count - 1) - (EXTERIOR.groundY + 0.06)) < 1e-5);
  for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > 0);
});

test('건물 종류별 입체 요소와 일정한 층 간격, 부드러운 접지 명암을 구성한다', () => {
  for (const building of cityBuildings) {
    assert.ok(Math.abs(building.userData.height / 0.9 - Math.round(building.userData.height / 0.9)) < 1e-8);
    const facade = building.getObjectByName('강건너_건물').material;
    assert.equal(facade.uniforms.uUseDimensions.value, 1);
    assert.ok(Number.isFinite(facade.uniforms.uWindowPitch.value) && facade.uniforms.uWindowPitch.value > 0);
    if (building.userData.kind === '업무지구') assert.ok(building.getObjectByName('업무동_상부'));
    if (building.userData.kind === '주거단지') assert.ok(building.getObjectByName('주거동_계단실'));
  }
  assert.equal(exteriorMeshes.filter(object => object.name === '저층_연결상가').length, 2);
  const shadows = exteriorMeshes.filter(object => object.name === '건물_접지명암');
  assert.equal(shadows.length, cityBuildings.length);
  const texture = shadows[0].material.map.image;
  const center = (Math.floor(texture.height / 2) * texture.width + Math.floor(texture.width / 2)) * 4;
  assert.equal(texture.data[0], 255);
  assert.ok(texture.data[center] < 200);
  assert.equal(shadows[0].material.transparent, false);
});

test('방 안에서 가려진 공원이 창 가까이에서 아래를 보면 드러난다', () => {
  setBlind(0.88);
  // 가로등과 벤치 사이의 비어 있는 보행 공간을 향해 검사한다.
  const point = exterior.park.localToWorld(new Vector3(3, EXTERIOR.groundY + 0.05, -31.5));
  const far = new Vector3(START.x, START.y, START.z);
  const near = new Vector3(0.08, 1.35, -1.6);
  for (const obstacle of bindings.obstacles) assert.equal(collisionPush(near, obstacle), null);
  assert.ok(roomMeshes.includes(firstHit(far, point)));
  assert.equal(firstHit(near, point)?.name, '공원_산책로');
  assert.ok(Math.atan2(near.y - point.y, Math.hypot(near.x - point.x, near.z - point.z)) < 1.3);
});

test('차도에서 수변까지 공원·자전거길·인도·부두 순서와 접안 연결을 유지한다', () => {
  const bounds = name => new Box3().setFromObject(exterior.root.getObjectByName(name));
  const road = bounds('공원밖_차도'), lawn = bounds('공원_잔디광장');
  const cycle = bounds('공원_자전거길'), walk = bounds('공원_산책로');
  const dock = bounds('부두_접안데크'), hull = bounds('식당선박_선체');
  assert.ok(road.min.z - lawn.max.z >= 2, '차도와 녹지 공원 사이에 이격 공간이 있어야 한다');
  assert.ok(lawn.max.z - lawn.min.z > (road.max.z - road.min.z) * 2, '녹지가 좁은 띠가 되지 않도록 공원 깊이를 확보한다');
  assert.ok(lawn.min.z > cycle.max.z && cycle.min.z > walk.max.z);
  assert.ok(walk.min.z > dock.max.z && dock.min.z > hull.max.z);
  assert.ok(hull.min.y < EXTERIOR.riverY && hull.max.y > EXTERIOR.riverY, '선체가 수면에 걸쳐 있어야 한다');
  assert.ok(exterior.root.getObjectByName('자전거길_자전거와방향기호').isInstancedMesh);
  const surfaces = exteriorMeshes.filter(mesh => /공원_산책로|부두_.*(다리|데크)|식당선박_갑판/.test(mesh.name));
  const ray = new Raycaster(), down = new Vector3(0, -1, 0);
  for (const [x, samples] of [[13.5, [-32.9, -33.4, -34, -34.7, -35.3, -36.4]], [18.5, [-37.4, -37.7, -38, -38.3, -38.65]]]) {
    let previous;
    for (const z of samples) {
      ray.set(exterior.park.localToWorld(new Vector3(x, EXTERIOR.groundY + 2, z)), down);
      const hit = ray.intersectObjects(surfaces, false)[0];
      assert.ok(hit, `접안 경로가 끊김: ${x}, ${z}`);
      if (previous !== undefined) assert.ok(Math.abs(hit.point.y - previous) < 0.12, '연결 다리의 높이가 갑자기 달라지지 않아야 한다');
      previous = hit.point.y;
    }
  }
});

test('이동 가능한 창가 위치에서 가까운 차도의 차량과 식당 선박을 볼 수 있다', () => {
  setBlind(0.88);
  const eye = new Vector3(0.08, 1.35, -1.6);
  for (const obstacle of bindings.obstacles) assert.equal(collisionPush(eye, obstacle), null);
  const road = exterior.park.getObjectByName('공원밖_차도').getWorldPosition(new Vector3());
  const boat = exterior.park.getObjectByName('계류_식당선박');
  const targets = [new Vector3(0.08, EXTERIOR.groundY + 0.05, road.z), new Vector3(0.08, EXTERIOR.groundY + 0.9, road.z), boat.localToWorld(new Vector3(-1.4, 1.4, 1.66))];
  for (const point of targets) {
    const ray = new Raycaster(eye, point.clone().sub(eye).normalize(), 0, eye.distanceTo(point));
    const hits = ray.intersectObjects(roomMeshes, false);
    assert.equal(hits.length, 0, '차량·선박 시야가 막힘: ' + hits.map(hit => hit.object.name).join(', '));
  }
});

test('교량 주탑이 더 왼쪽에 있고 북단 도로는 완만한 각도로 둔치까지 끊김 없이 연결된다', () => {
  const pylon = exterior.bridge.getObjectByName('올림픽대교_주탑상부').getWorldPosition(new Vector3());
  assert.ok(pylon.x < -32);
  const forward = new Vector3(0, 0, 1).applyQuaternion(exterior.bridge.quaternion);
  const angle = Math.atan2(Math.abs(forward.x), Math.abs(forward.z)) * 180 / Math.PI;
  assert.ok(angle > 9.5 && angle < 10.5);
  const halfLength = exterior.bridge.getObjectByName('올림픽대교_상판').scale.z / 2;
  let previousHeight;
  let lastHeight;
  for (let distance = -1; distance <= 44; distance += 0.5) {
    const eye = exterior.bridge.localToWorld(new Vector3(0.7, 10, -halfLength - distance));
    const ray = new Raycaster(eye, new Vector3(0, -1, 0), 0, 100);
    const hit = ray.intersectObjects(exteriorMeshes, false)[0];
    assert.ok(hit && /^(올림픽대교_(도로|상판)|북단_.*_(노면|상판))$/.test(hit.object.name), '연결 도로가 끊긴 위치: ' + distance);
    if (previousHeight !== undefined) assert.ok(Math.abs(hit.point.y - previousHeight) < 0.15);
    previousHeight = lastHeight = hit.point.y;
  }
  assert.ok(Math.abs(lastHeight - EXTERIOR.groundY) < 0.1);
  const roadEnd = exterior.bridge.localToWorld(new Vector3(0, 0, -halfLength - 46));
  assert.ok(roadEnd.z > 0, '연결 도로의 끝은 창 앞 시야 밖까지 이어져야 한다');
});

test('방 중앙에서 교량과 타워를 창 너머로 볼 수 있고 블라인드를 닫으면 가려진다', () => {
  const eye = new Vector3(0.08, 1.35, 0.2);
  const bridge = exterior.bridge.getObjectByName('올림픽대교_주탑상부').getWorldPosition(new Vector3());
  const tower = exterior.tower.localToWorld(new Vector3(0, EXTERIOR.towerHeight - 0.5, 0));
  const camera = new PerspectiveCamera(70, 16 / 9, 0.025, EXTERIOR.far);
  camera.position.copy(eye);
  camera.lookAt(eye.clone().add(new Vector3(0, 0, -1)));
  camera.updateMatrixWorld();
  setBlind(0.88);
  assert.match(firstHit(eye, bridge)?.name || '', /^올림픽대교_/);
  assert.match(firstHit(eye, tower)?.name || '', /^롯데월드타워_/);
  const bridgeOnScreen = bridge.clone().project(camera);
  const towerOnScreen = tower.clone().project(camera);
  assert.ok(bridgeOnScreen.x < towerOnScreen.x);
  for (const point of [bridgeOnScreen, towerOnScreen]) assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z < 1);
  setBlind(0);
  assert.equal(firstHit(eye, tower)?.name, '블라인드_암막천');
  setBlind(0.88);
});

test('서울 낮과 밤에 외부 밝기가 바뀌며 일출·일몰 전후는 부드럽게 전환된다', () => {
  const noon = new Date('2026-09-11T12:00:00+09:00');
  const night = new Date('2026-09-11T21:00:00+09:00');
  const times = seoulDaylight(noon);
  assert.equal(exterior.setTime(noon).day, 1);
  assert.equal(exterior.backdrop.children[0].material.uniforms.uDay.value, 1);
  assert.equal(exterior.setTime(night).day, 0);
  assert.equal(exterior.backdrop.children[0].material.uniforms.uDay.value, 0);
  assert.equal(exteriorLighting(new Date(times.sunrise), times).day, 0.5);
  assert.equal(exteriorLighting(new Date(times.sunset), times).day, 0.5);
  const before = exteriorLighting(new Date(times.sunset - 1000), times).day;
  const after = exteriorLighting(new Date(times.sunset + 1000), times).day;
  assert.ok(before > after && before - after < 0.01);
  const fallback = seoulDaylight(noon, () => { throw new Error('계산 실패'); });
  assert.equal(exteriorLighting(noon, fallback).source, 'fixed');
  assert.equal(exteriorLighting(night, fallback).day, 0);
});
