import { Box3, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';

export const ROOM_BOUNDS = { minX: -1.5, maxX: 1.5, minZ: -1.8, maxZ: 1.7 };
export const PLAYER_RADIUS = 0.18;
export const PLAYER_HEIGHT = 1.35;
export const PLAYER_SPEED = 1.45;
export const START = { x: 0.08, y: PLAYER_HEIGHT, z: 1.25, yaw: 0, pitch: -0.10 };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeMouseSensitivity(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(clamp(value, 0.25, 2) * 100) / 100 : 1;
}

export function bindRoom(root) {
  root.updateMatrixWorld(true);
  const required = name => {
    const object = root.getObjectByName(name);
    if (!object) throw new Error('모델에 필요한 부품이 없습니다: ' + name);
    return object;
  };
  let entranceBlocker = root.getObjectByName('현관_검은차폐벽');
  if (!entranceBlocker) {
    const frame = new Box3().setFromObject(required('출입문_상단틀'));
    const center = frame.getCenter(new Vector3());
    entranceBlocker = new Mesh(new PlaneGeometry(2.2, 2.8), new MeshBasicMaterial({ color: 0x000000, side: DoubleSide, fog: false, toneMapped: false }));
    entranceBlocker.name = '현관_검은차폐벽';
    // 문틀 바로 뒤를 겹쳐 막아 비스듬히 보아도 외부 지면이 드러나지 않게 한다.
    entranceBlocker.position.set(center.x, center.y / 2, frame.max.z + 0.01);
    root.add(entranceBlocker);
    entranceBlocker.updateMatrixWorld(true);
  }
  const owners = new WeakMap();
  const meshes = [];
  root.traverse(object => { if (object.isMesh && !object.name.includes('통유리')) meshes.push(object); });
  const obstacles = ['침대_가구', 'TV장_가구', '협탁_상판', '출입문_문짝', '휴지통_바닥'].map(name => obstacleFromObject(required(name)));
  const tv = required('TV_대각선배치');
  tv.traverse(object => { if (object.isMesh) owners.set(object, 'tv'); });
  const pull = required('블라인드_당김줄');
  const handle = required('블라인드_줄손잡이');
  owners.set(pull, 'blind');
  owners.set(handle, 'blind');
  const lampShade = required('스탠드_갓_항상소등');
  const lampParts = [required('스탠드_받침'), required('스탠드_기둥'), lampShade];
  const lampBox = new Box3();
  for (const part of lampParts) {
    owners.set(part, 'lamp');
    lampBox.union(new Box3().setFromObject(part));
  }
  const ceilingFixture = required('천장등');
  const ceilingDiffuser = required('천장등_확산판');
  ceilingFixture.traverse(object => { if (object.isMesh) owners.set(object, 'ceiling-light'); });
  const wallSwitch = required('천장등_벽스위치');
  const switchButton = required('벽스위치_버튼');
  wallSwitch.traverse(object => { if (object.isMesh) owners.set(object, 'ceiling-switch'); });
  return {
    screen: required('CRT_곡면화면'), fabric: required('블라인드_암막천'), bottomBar: required('블라인드_하단봉'),
    meshes, owners, obstacles, lampShade, ceilingFixture, ceilingDiffuser, wallSwitch, switchButton, entranceBlocker,
    targets: [
      { id: 'tv', label: '게임기 사용', box: new Box3().setFromObject(tv).expandByScalar(0.025), outlineObjects: [required('CRT_TV'), required('NES_게임기')] },
      { id: 'blind', label: '블라인드 높이 조절', box: new Box3().setFromObject(pull).union(new Box3().setFromObject(handle)).expandByScalar(0.07), outlineObjects: [pull, handle] },
      { id: 'lamp', label: '무드등 조작', box: lampBox.expandByScalar(0.025), outlineObjects: lampParts },
      { id: 'ceiling-light', label: '천장등 켜기', box: new Box3().setFromObject(ceilingFixture).expandByScalar(0.025), outlineObjects: [ceilingFixture] },
      { id: 'ceiling-switch', label: '천장등 스위치', box: new Box3().setFromObject(wallSwitch).expandByScalar(0.025), outlineObjects: [wallSwitch] }
    ]
  };
}

export function movementInput(forward, right, yaw, seconds, speed = PLAYER_SPEED) {
  const length = Math.max(1, Math.hypot(forward, right));
  const distance = speed * Math.min(Math.max(seconds, 0), 0.05);
  return {
    x: (-Math.sin(yaw) * forward + Math.cos(yaw) * right) / length * distance,
    z: (-Math.cos(yaw) * forward - Math.sin(yaw) * right) / length * distance
  };
}

// 회전된 가구를 각자의 좌표계에서 감싸 충돌 범위로 사용한다.
export function obstacleFromObject(object) {
  object.updateWorldMatrix(true, true);
  const inverse = object.matrixWorld.clone().invert();
  const localBox = new Box3();
  const corner = new Vector3();
  object.traverse(child => {
    if (!child.isMesh) return;
    child.geometry.computeBoundingBox();
    const box = child.geometry.boundingBox;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      corner.set(x, y, z).applyMatrix4(child.matrixWorld).applyMatrix4(inverse);
      localBox.expandByPoint(corner);
    }
  });
  if (localBox.isEmpty()) throw new Error(`충돌 메시가 없습니다: ${object.name}`);
  const center = localBox.getCenter(new Vector3()).applyMatrix4(object.matrixWorld);
  const size = localBox.getSize(new Vector3());
  const axes = [];
  for (let index = 0; index < 3; index++) {
    const axis = new Vector3().setFromMatrixColumn(object.matrixWorld, index);
    const scale = axis.length();
    axis.normalize();
    if (Math.abs(axis.y) < 0.5) axes.push({ x: axis.x, z: axis.z, half: size.getComponent(index) * scale / 2 });
  }
  if (axes.length !== 2) throw new Error(`수평 충돌 범위를 만들 수 없습니다: ${object.name}`);
  return { name: object.name, x: center.x, z: center.z, axes };
}

export function collisionPush(point, obstacle, radius = PLAYER_RADIUS) {
  const [a, b] = obstacle.axes;
  const dx = point.x - obstacle.x;
  const dz = point.z - obstacle.z;
  const u = dx * a.x + dz * a.z;
  const v = dx * b.x + dz * b.z;
  let pu = u - clamp(u, -a.half, a.half);
  let pv = v - clamp(v, -b.half, b.half);
  const distance = Math.hypot(pu, pv);
  if (distance >= radius) return null;
  if (distance > 1e-8) {
    const amount = (radius - distance + 1e-5) / distance;
    pu *= amount;
    pv *= amount;
  } else if (a.half - Math.abs(u) < b.half - Math.abs(v)) {
    pu = (u < 0 ? -1 : 1) * (a.half - Math.abs(u) + radius + 1e-5);
    pv = 0;
  } else {
    pu = 0;
    pv = (v < 0 ? -1 : 1) * (b.half - Math.abs(v) + radius + 1e-5);
  }
  return { x: a.x * pu + b.x * pv, z: a.z * pu + b.z * pv };
}

export function moveCircle(position, delta, obstacles, bounds = ROOM_BOUNDS, radius = PLAYER_RADIUS) {
  const result = { x: position.x, z: position.z };
  const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / (radius * 0.45)));
  for (let step = 0; step < steps; step++) {
    result.x += delta.x / steps;
    result.z += delta.z / steps;
    for (let pass = 0; pass < 3; pass++) {
      for (const obstacle of obstacles) {
        const push = collisionPush(result, obstacle, radius);
        if (push) { result.x += push.x; result.z += push.z; }
      }
      result.x = clamp(result.x, bounds.minX + radius, bounds.maxX - radius);
      result.z = clamp(result.z, bounds.minZ + radius, bounds.maxZ - radius);
    }
  }
  return result;
}

export function blindPose(opening) {
  const open = clamp(opening, 0, 1);
  const height = Math.max(0.025, 1.445 * (1 - open));
  return { opening: open, height, centerY: 2.395 - height / 2, barY: 2.395 - height };
}

export function nearestInteraction(ray, targets, maxDistance = 2.05) {
  const point = new Vector3();
  let result = null;
  for (const target of targets) {
    if (!ray.intersectBox(target.box, point)) continue;
    const distance = ray.origin.distanceTo(point);
    if (distance <= maxDistance && (!result || distance < result.distance)) result = { target, distance };
  }
  return result;
}

export function visibleInteraction(raycaster, targets, meshes, owners) {
  const result = nearestInteraction(raycaster.ray, targets);
  if (!result) return null;
  const obstruction = raycaster.intersectObjects(meshes, false)[0];
  if (obstruction && obstruction.distance + 0.10 < result.distance && owners.get(obstruction.object) !== result.target.id) return null;
  return result.target;
}

export function easeInOut(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
