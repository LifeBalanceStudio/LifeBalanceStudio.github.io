import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createTrafficFlow } from './traffic-flow.mjs';

export const STREET_LIFE = Object.freeze({ cars: 24, bridgeCapacity: 12, roadCapacity: 12, people: 12, carSpeed: 4.2, walkSpeed: 0.85 });

// 도로 중앙선을 왕복한다. 끝의 작은 회전 구간은 방 뒤와 먼 시가지에 놓인다.
export function roundTrip(points, lane) {
  const sides = points.map((point, i) => {
    const direction = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(0, i - 1)]);
    return new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  });
  const path = points.map((point, i) => point.clone().addScaledVector(sides[i], lane));
  function turn(index, sign) {
    const side = sides[index], point = points[index];
    const forward = new THREE.Vector3(side.z, 0, -side.x);
    for (let i = 1; i < 9; i++) {
      const angle = i * Math.PI / 8;
      path.push(point.clone().addScaledVector(side, Math.cos(angle) * lane * sign)
        .addScaledVector(forward, Math.sin(angle) * lane * sign));
    }
  }
  turn(points.length - 1, 1);
  for (let i = points.length - 2; i >= 0; i--) path.push(points[i].clone().addScaledVector(sides[i], -lane));
  turn(0, -1);
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
  return { points: path, lengths, length: lengths.at(-1) };
}

export function sampleRoute(route, distance, position, direction) {
  const at = ((distance % route.length) + route.length) % route.length;
  let index = 1;
  while (index < route.lengths.length - 1 && route.lengths[index] < at) index++;
  const start = route.points[index - 1], end = route.points[index];
  position.copy(start).lerp(end, (at - route.lengths[index - 1]) / (route.lengths[index] - route.lengths[index - 1]));
  direction.copy(end).sub(start).normalize();
}

function bridgeRoute(exterior) {
  exterior.root.updateMatrixWorld(true);
  const get = name => exterior.root.getObjectByName(name);
  const end = (name, z) => get(name).localToWorld(new THREE.Vector3(0, 0.5, z));
  const points = [end('북단_둔치연결부_노면', -0.5), end('북단_경사연결부_노면', -0.5),
    end('북단_경사연결부_노면', 0.5), end('올림픽대교_도로', 0.5)];
  points[0].lerp(points[1], 0.18);
  const ramp = get('남단접속로_노면');
  if (ramp) {
    const vertices = ramp.geometry.getAttribute('position');
    points.pop();
    for (let i = 0; i < vertices.count; i += 2) {
      const center = new THREE.Vector3().fromBufferAttribute(vertices, i)
        .add(new THREE.Vector3().fromBufferAttribute(vertices, i + 1)).multiplyScalar(0.5);
      points.push(ramp.localToWorld(center));
    }
    const exit = get('도시_도로망').children.find(object => object.name === '도시_진입도로' && Math.abs(object.position.x - points.at(-1).x) < 0.01);
    if (exit) points.push(exit.localToWorld(new THREE.Vector3(0, 0.5, 0.5)));
  }
  return roundTrip(points, 0.58);
}

function shape(parts, geometry, size, position, color, paint = 0, lamp = 0) {
  geometry.scale(...size).translate(...position);
  const count = geometry.getAttribute('position').count, rgb = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) rgb.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('paintMask', new THREE.Float32BufferAttribute(new Float32Array(count).fill(paint), 1));
  geometry.setAttribute('lampMask', new THREE.Float32BufferAttribute(new Float32Array(count).fill(lamp), 1));
  parts.push(geometry);
}

function box(parts, size, position, color, paint = 0, lamp = 0) {
  shape(parts, new THREE.BoxGeometry(1, 1, 1), size, position, color, paint, lamp);
}

function join(parts) {
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

function carGeometry(type) {
  const parts = [];
  const length = type === 1 ? 2.05 : 2.45, roofHeight = type === 2 ? 0.68 : 0.41;
  box(parts, [0.94, 0.36, length], [0, 0.38, 0], '#deded8', 1);
  const cabin = new THREE.BoxGeometry(0.85, roofHeight, type === 0 ? 1.15 : 1.48);
  const positions = cabin.getAttribute('position');
  for (let i = 0; i < positions.count; i++) if (positions.getY(i) > 0) {
    positions.setX(i, positions.getX(i) * 0.83);
    positions.setZ(i, positions.getZ(i) * (type === 2 ? 0.94 : 0.75));
  }
  cabin.computeVertexNormals();
  shape(parts, cabin, [1, 1, 1], [0, 0.55 + roofHeight / 2, -0.12], '#293e46');
  // 유리와 차체를 한 번에 그린다. 유리 투명도와 실제 전조등 조명은 사용하지 않는다.
  for (const side of [-1, 1]) box(parts, [0.012, roofHeight * 0.54, type === 0 ? 0.85 : 1.1], [side * 0.406, 0.58 + roofHeight * 0.44, -0.12], '#243942');
  box(parts, [0.64, roofHeight * 0.59, 0.04], [0, 0.57 + roofHeight * 0.47, type === 0 ? 0.387 : 0.54], '#32464b');
  box(parts, [0.69, 0.07, type === 0 ? 0.82 : 1.23], [0, 0.56 + roofHeight, -0.12], '#deded8', 1);
  for (const side of [-1, 1]) {
    for (const z of [-length * 0.3, length * 0.3]) {
      const wheel = new THREE.CylinderGeometry(0.21, 0.21, 0.12, 6).rotateZ(Math.PI / 2);
      shape(parts, wheel, [1, 1, 1], [side * 0.47, 0.22, z], '#20262b');
    }
    box(parts, [0.19, 0.12, 0.028], [side * 0.28, 0.43, length / 2 + 0.015], '#fff0c4', 0, 1);
    box(parts, [0.18, 0.12, 0.028], [side * 0.28, 0.43, -length / 2 - 0.015], '#cf5440', 0, 1);
  }
  return join(parts);
}

function personGeometry() {
  const parts = [];
  box(parts, [0.42, 0.64, 0.26], [0, 0.98, 0], '#e3ded2', 1);
  box(parts, [0.24, 0.30, 0.24], [0, 1.45, 0], '#d8a582');
  box(parts, [0.26, 0.10, 0.25], [0, 1.63, -0.01], '#373230');
  for (const side of [-1, 1]) {
    box(parts, [0.13, 0.37, 0.15], [side * 0.27, 1.08, 0], '#e3ded2', 1);
    box(parts, [0.10, 0.22, 0.12], [side * 0.27, 0.82, 0.02], '#d8a582');
  }
  return join(parts);
}

function legGeometry() {
  const parts = [];
  box(parts, [0.15, 0.64, 0.17], [0, -0.32, 0], '#485560');
  box(parts, [0.17, 0.08, 0.27], [0, -0.66, 0.04], '#303536');
  return join(parts);
}

export function createStreetLife(exterior, dayUniform = { value: 1 }) {
  const root = new THREE.Group(); root.name = '차량과_보행자';
  const carRoute = bridgeRoute(exterior);
  const road = exterior.park.getObjectByName('공원밖_차도');
  const roadPosition = road.getWorldPosition(new THREE.Vector3());
  const roadY = roadPosition.y + road.scale.y / 2;
  const roadRoute = roundTrip([new THREE.Vector3(-72, roadY, roadPosition.z), new THREE.Vector3(72, roadY, roadPosition.z)], 0.95);
  const walkway = exterior.park.getObjectByName('공원_산책로');
  const walkwayPosition = walkway.getWorldPosition(new THREE.Vector3());
  const y = walkwayPosition.y + walkway.scale.y / 2 + 0.012;
  const walkRoute = roundTrip([new THREE.Vector3(-43, y, walkwayPosition.z), new THREE.Vector3(43, y, walkwayPosition.z)], 0.55);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uDay: dayUniform }, vertexColors: true, fog: true,
    vertexShader: `
      attribute float paintMask;
      attribute float lampMask;
      varying vec3 vColor;
      varying float vLamp;
      #include <fog_pars_vertex>
      void main() {
        vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        float shade = 0.62 + 0.38 * max(dot(n, normalize(vec3(-0.35, 0.8, 0.45))), 0.0);
        vColor = color * mix(vec3(1.0), instanceColor, paintMask) * mix(shade, 1.0, lampMask);
        vLamp = lampMask;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float uDay;
      varying vec3 vColor;
      varying float vLamp;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(vColor * mix(0.12 + 0.88 * uDay, 1.4 - 0.4 * uDay, vLamp), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `
  });
  function instances(name, geometry, count, route) {
    const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const bounds = new THREE.Box3().setFromPoints(route.points).expandByScalar(3);
    mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color('#ffffff'));
    root.add(mesh); return mesh;
  }
  const carBounds = { points: [...carRoute.points, ...roadRoute.points] };
  const cars = ['세단', '해치백', '소형밴'].map((name, i) => instances(name, carGeometry(i), STREET_LIFE.cars / 3, carBounds));
  const bodies = instances('산책하는_사람', personGeometry(), STREET_LIFE.people, walkRoute);
  const legs = instances('보행자_걸음', legGeometry(), STREET_LIFE.people * 2, walkRoute);
  const carColors = ['#c1cdc9', '#bf7962', '#d6c78e', '#718eaa', '#bfc0b7', '#80937a'];
  const pooledColors = carColors.map(color => new THREE.Color(color));
  const shirts = ['#b58967', '#789591', '#b6aa83', '#6a7e94', '#a06d6b', '#a6ac94'];
  cars.forEach((mesh, type) => { for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, pooledColors[(type * 2 + i) % pooledColors.length]); });
  for (let i = 0; i < bodies.count; i++) bodies.setColorAt(i, new THREE.Color(shirts[i % shirts.length]));
  const pose = new THREE.Object3D(), limb = new THREE.Object3D(), legMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), direction = new THREE.Vector3();
  // 러시아워에도 고정된 풀과 GPU 버퍼를 재사용한다. 숨은 슬롯은 그리지 않는다.
  const bridgeFlow = createTrafficFlow({ length: carRoute.length, capacity: STREET_LIFE.bridgeCapacity,
    gates: [carRoute.lengths[2] + 32, carRoute.length - carRoute.lengths[2] - 6],
    near: carRoute.lengths[2], far: carRoute.lengths[3], cruise: STREET_LIFE.carSpeed });
  const roadFlow = createTrafficFlow({ length: roadRoute.length, capacity: STREET_LIFE.roadCapacity,
    gates: [roadRoute.length * 0.32, roadRoute.length * 0.82], cruise: STREET_LIFE.carSpeed });
  const flows = [bridgeFlow, roadFlow], routes = [carRoute, roadRoute];
  const view = new THREE.Frustum(), viewMatrix = new THREE.Matrix4(), carSphere = new THREE.Sphere(new THREE.Vector3(), 3.5);
  let hasCamera = false;
  function canToggle(route, distance) {
    if (!hasCamera) return true;
    sampleRoute(route, distance, carSphere.center, direction); carSphere.center.y += 0.8;
    return !view.intersectsSphere(carSphere);
  }
  const toggleTests = [distance => canToggle(carRoute, distance), distance => canToggle(roadRoute, distance)];
  const walkOffsets = [0.025, 0.115, 0.141, 0.278, 0.356, 0.461, 0.544, 0.622, 0.649, 0.763, 0.851, 0.945];
  let elapsed = 0, performanceAllowed = true, warmupMs = 0, sampleMs = 0, sampleFrames = 0;
  function setTraffic({ bridge, road, rush = 0, morning = rush, evening = rush }, immediate = false) {
    if (!Number.isInteger(bridge) || !Number.isInteger(road)) return;
    if (immediate) bridgeFlow.reset(bridge, rush);
    else bridgeFlow.setTarget(bridge, rush);
    // +X는 서쪽이다. 아침 서향, 저녁 동향 정체를 기존 왕복 경로에 반영한다.
    if (immediate) roadFlow.reset(road, morning, evening);
    else roadFlow.setTarget(road, morning, evening);
    if (immediate) update(0);
  }
  // 기존 장면 자체가 무거운 기기도 보수적으로 보호한다. 자동 중지는 새로고침까지 유지한다.
  function setFrameState(frameMs, active) {
    root.visible = active && performanceAllowed;
    if (!root.visible || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) {
      warmupMs = sampleMs = sampleFrames = 0; return false;
    }
    if (warmupMs < 3000) { warmupMs += frameMs; return false; }
    sampleMs += frameMs; sampleFrames++;
    if (sampleMs < 6000) return false;
    const slow = sampleMs / sampleFrames > 40;
    sampleMs = sampleFrames = 0;
    if (slow) { performanceAllowed = false; root.visible = false; return true; }
    return false;
  }
  function update(seconds, camera = null) {
    if (!root.visible) return;
    elapsed += Math.max(0, Math.min(0.05, seconds));
    hasCamera = Boolean(camera);
    if (camera) {
      camera.updateMatrixWorld();
      view.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    for (const mesh of cars) mesh.count = 0;
    pose.rotation.order = 'YXZ';
    for (let road = 0; road < flows.length; road++) {
      const flow = flows[road]; flow.update(seconds, toggleTests[road]);
      for (let i = 0; i < flow.active.length; i++) {
        if (!flow.active[i]) continue;
        sampleRoute(routes[road], flow.positions[i], position, direction);
        pose.position.copy(position); pose.position.y += 0.015;
        pose.rotation.set(-Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), Math.atan2(direction.x, direction.z), 0);
        pose.scale.setScalar(1); pose.updateMatrix();
        const mesh = cars[(i + road) % 3], slot = mesh.count++;
        mesh.setMatrixAt(slot, pose.matrix);
        mesh.setColorAt(slot, pooledColors[(i + road * 3) % pooledColors.length]);
      }
    }
    for (const mesh of cars) { mesh.visible = mesh.count > 0; mesh.instanceColor.needsUpdate = true; }
    for (let i = 0; i < STREET_LIFE.people; i++) {
      sampleRoute(walkRoute, walkOffsets[i] * walkRoute.length + elapsed * STREET_LIFE.walkSpeed, position, direction);
      const step = Math.sin(elapsed * 5.2 + i * 2.7) * 0.42;
      pose.position.copy(position); pose.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      pose.scale.setScalar(0.93 + (i % 4) * 0.035); pose.updateMatrix();
      bodies.setMatrixAt(i, pose.matrix);
      for (let side = 0; side < 2; side++) {
        limb.position.set(side ? 0.115 : -0.115, 0.71, 0);
        limb.rotation.x = side ? step : -step; limb.updateMatrix();
        legMatrix.multiplyMatrices(pose.matrix, limb.matrix); legs.setMatrixAt(i * 2 + side, legMatrix);
      }
    }
    for (const mesh of root.children) mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { root, carRoute, roadRoute, walkRoute, update, setFrameState, setTraffic, bridgeFlow, roadFlow,
    get trafficState() { return { bridge: bridgeFlow.state.target, road: roadFlow.state.target,
      active: bridgeFlow.state.active + roadFlow.state.active, capacity: STREET_LIFE.cars }; } };
}
