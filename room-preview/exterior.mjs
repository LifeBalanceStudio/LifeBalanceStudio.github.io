import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seoulDaylight } from './mood-light.mjs';
import { BACKDROP, createBackdrop } from './backdrop.mjs';
import { CITY_GROUND_COLOR, CITY_PAVEMENT_COLOR, createCityLayout } from './city-layout.mjs';
import { createWeatherSky } from './weather-sky.mjs';
import { SUNSET_GLSL } from './sunset.mjs';

export const EXTERIOR = { groundY: -10, riverY: -10.35, parkZ: -18, towerX: 14, towerZ: -190, towerHeight: 56, far: 520 };

export function exteriorLighting(date, times = seoulDaylight(date)) {
  const time = date.getTime();
  const edge = 30 * 60000;
  const rise = THREE.MathUtils.smoothstep(time, times.sunrise - edge, times.sunrise + edge);
  const set = THREE.MathUtils.smoothstep(time, times.sunset - edge, times.sunset + edge);
  const day = rise * (1 - set);
  return { day, night: 1 - day, twilight: 4 * day * (1 - day), source: times.source };
}

// 실내 블라인드가 외부 전체의 밝기를 바꾸지 않도록 외부 재질은 별도로 명암을 표현한다.
function shadedGeometry(geometry) {
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  const sun = new THREE.Vector3(-0.35, 0.8, 0.45).normalize();
  const n = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    const shade = 0.58 + 0.42 * Math.max(0, n.fromBufferAttribute(normal, i).dot(sun));
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function windowTexture() {
  const width = 64, height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const window = x % 8 >= 2 && x % 8 <= 5 && y % 8 >= 2 && y % 8 <= 5;
    const lit = (Math.floor(x / 8) * 17 + Math.floor(y / 8) * 23) % 7 < 3;
    const i = (y * width + x) * 4;
    data.set([window ? 255 : 0, window && lit ? 255 : 0, 0, 255], i);
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function contactTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(0, Math.abs((x + 0.5) / size - 0.5) - 0.30);
    const dy = Math.max(0, Math.abs((y + 0.5) / size - 0.5) - 0.30);
    const shade = 1 - 0.32 * (1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dy), 0.015, 0.19));
    const value = Math.round(shade * 255);
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function towerGeometry(height) {
  const positions = [], uv = [], indices = [];
  const rings = [[0, 3.15], [0.18, 3.05], [0.44, 2.75], [0.69, 2.15], [0.88, 1.38], [1, 0.26]];
  const segments = 16;
  rings.forEach(([level, radius]) => {
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      positions.push(Math.sign(c) * Math.pow(Math.abs(c), 0.68) * radius, level * height, Math.sign(s) * Math.pow(Math.abs(s), 0.68) * radius);
      uv.push(i / segments * 2, level * 4);
    }
  });
  for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < segments; i++) {
    const a = row * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createExterior() {
  const root = new THREE.Group();
  root.name = '창밖_한강풍경';
  const materials = [];
  const dayUniform = { value: 1 };
  const timeUniform = { value: 0 };
  const boxGeometry = shadedGeometry(new THREE.BoxGeometry(1, 1, 1));
  const poleGeometry = shadedGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
  const foliageGeometry = shadedGeometry(new THREE.IcosahedronGeometry(1, 0));
  const windows = windowTexture();
  const ground = EXTERIOR.groundY;
  const outerWidth = (BACKDROP.halfWidth + 20) * 2;
  const material = color => {
    const value = new THREE.MeshBasicMaterial({ color, vertexColors: true });
    materials.push({ value, color: new THREE.Color(color) });
    return value;
  };
  const grass = material('#6d7952'), grassDark = material('#556c49');
  const path = material('#b1a48a'), asphalt = material('#5a6267');
  const stone = material('#9b9e94'), concrete = material('#b2b1a4');
  const bark = material('#645244'), foliage = [material('#647747'), material('#778557'), material('#4f694b')];
  const rail = material('#7a8380'), wood = material('#967456'), line = material('#c7c6ad');
  const lampMaterial = new THREE.MeshBasicMaterial({ color: '#ffca86', toneMapped: false });
  const crownMaterial = new THREE.MeshBasicMaterial({ color: '#d8b57b', toneMapped: false });

  function group(name, parent = root) {
    const object = new THREE.Group();
    object.name = name;
    parent.add(object);
    return object;
  }
  function box(name, position, size, mat, parent = root) {
    const object = new THREE.Mesh(boxGeometry, mat);
    object.name = name;
    object.position.set(...position);
    object.scale.set(...size);
    parent.add(object);
    return object;
  }
  function beam(name, start, end, width, mat, parent = root) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const object = new THREE.Mesh(poleGeometry, mat);
    object.name = name;
    object.position.copy(a).add(b).multiplyScalar(0.5);
    object.scale.set(width, a.distanceTo(b), width);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    parent.add(object);
    return object;
  }
  function tree(x, z, height, variant = 0, parent = root) {
    const object = group('공원_나무', parent);
    object.position.set(x, ground, z);
    beam('나무_줄기', [0, 0, 0], [0, height * 0.7, 0], height * 0.11, bark, object);
    const crown = new THREE.Mesh(foliageGeometry, foliage[variant % foliage.length]);
    crown.name = '나무_수관';
    crown.position.y = height * 0.72;
    crown.scale.set(height * 0.39, height * 0.48, height * 0.37);
    object.add(crown);
  }

  const park = group('한강공원');
  // 기존 창턱을 유지하면서 가까운 차도의 차량까지 보이도록 공원 전체를 6m 물가 쪽으로 옮긴다.
  park.position.z = -6;
  // 남단에서 설명한 공간의 순서를 구도에 적용하되, 특정 장소의 실제 좌표를 복제하지 않는다.
  box('공원_지면', [0, ground - 0.4, -1], [outerWidth, 0.8, 66], grass, park);
  box('강변_석축', [0, ground - 0.42, -34], [outerWidth, 0.85, 1.3], stone, park);
  box('공원밖_차도', [0, ground + 0.025, -10], [outerWidth, 0.05, 4.2], asphalt, park);
  box('차도_공원_완충녹지', [0, ground + 0.015, -13.2], [outerWidth, 0.025, 2.0], grassDark, park);
  box('공원_잔디광장', [0, ground + 0.015, -20.3], [outerWidth, 0.025, 12.0], grass, park);
  const cycleSurface = material('#ac6252'), roadMark = material('#d5b46b');
  box('공원_자전거길', [0, ground + 0.04, -27.8], [outerWidth, 0.05, 2.4], cycleSurface, park);
  box('공원_잔디띠', [0, ground + 0.015, -29.35], [outerWidth, 0.025, 0.6], grassDark, park);
  box('공원_산책로', [0, ground + 0.025, -31.5], [outerWidth, 0.045, 3.6], path, park);
  for (const z of [-10.07, -9.93]) box('차도_황색중앙선', [0, ground + 0.06, z], [outerWidth, 0.015, 0.045], roadMark, park);
  for (const z of [-11.93, -8.07]) box('차도_가장자리선', [0, ground + 0.06, z], [outerWidth, 0.015, 0.06], line, park);

  // 반복되는 노면 표시는 묶어서 그려 부두를 추가해도 호출 수가 크게 늘지 않게 한다.
  function paintRects(name, rectangles) {
    const mesh = new THREE.InstancedMesh(boxGeometry, line, rectangles.length);
    mesh.name = name;
    const pose = new THREE.Object3D();
    rectangles.forEach((rectangle, i) => {
      pose.position.set(rectangle.x, ground + 0.077, rectangle.z);
      pose.scale.set(rectangle.width, 0.008, rectangle.depth); pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix);
    });
    park.add(mesh);
  }
  const cycleDashes = [];
  for (let x = -288; x <= 288; x += 4) cycleDashes.push({ x, z: -27.8, width: 0.95, depth: 0.045 });
  paintRects('자전거길_중앙선', cycleDashes);
  const crossings = [];
  for (const x of [-40, 13.5, 46]) {
    box('공원_녹지연결길', [x, ground + 0.032, -20.5], [1.6, 0.035, 12.2], path, park);
    box('공원_수변연결길', [x, ground + 0.033, -29.45], [1.6, 0.035, 0.9], path, park);
    for (let dx = -0.6; dx <= 0.61; dx += 0.3) crossings.push({ x: x + dx, z: -27.8, width: 0.16, depth: 2.2 });
  }
  paintRects('자전거길_보행횡단표시', crossings);
  {
    const parts = [];
    for (const x of [-0.36, 0.36]) parts.push(new THREE.RingGeometry(0.15, 0.21, 10).rotateX(-Math.PI / 2).translate(x, 0, 0));
    for (const [ax, az, bx, bz] of [[-0.36, 0, -0.08, -0.4], [-0.08, -0.4, 0.1, 0], [0.1, 0, -0.36, 0], [-0.08, -0.4, 0.2, -0.4], [0.2, -0.4, 0.1, 0], [0.2, -0.4, 0.36, 0], [-0.17, -0.44, 0.02, -0.44], [0.17, -0.49, 0.34, -0.49], [0.77, 0, 1.15, 0], [1.15, 0, 1.0, -0.14], [1.15, 0, 1.0, 0.14]]) {
      parts.push(new THREE.PlaneGeometry(Math.hypot(bx - ax, bz - az), 0.04).rotateX(-Math.PI / 2).rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, 0.002, (az + bz) / 2));
    }
    const geometry = shadedGeometry(mergeGeometries(parts)); parts.forEach(part => part.dispose());
    const symbols = new THREE.InstancedMesh(geometry, line, 12); symbols.name = '자전거길_자전거와방향기호';
    const pose = new THREE.Object3D();
    for (let i = 0; i < 12; i++) {
      pose.position.set(-66 + Math.floor(i / 2) * 24, ground + 0.083, -27.8 + (i % 2 ? -0.57 : 0.57));
      pose.rotation.y = i % 2 ? Math.PI : 0; pose.updateMatrix(); symbols.setMatrixAt(i, pose.matrix);
    }
    park.add(symbols);
  }
  for (let x = -288; x <= 288; x += 8) {
    if (x > 12.1 && x < 14.9) continue;
    beam('강변_난간기둥', [x, ground, -33.4], [x, ground + 0.9, -33.4], 0.07, rail, park);
  }
  beam('강변_난간상단', [-outerWidth / 2, ground + 0.9, -33.4], [12.1, ground + 0.9, -33.4], 0.06, rail, park);
  beam('강변_난간상단', [14.9, ground + 0.9, -33.4], [outerWidth / 2, ground + 0.9, -33.4], 0.06, rail, park);
  for (let i = 0; i < 27; i++) {
    const x = (i - 13) * 9 + Math.sin(i * 4.1) * 2;
    if ([-40, 13.5, 46].some(pathX => Math.abs(x - pathX) < 1.8)) continue;
    tree(x, i % 2 ? -16.3 : -23.8, 2.5 + (i % 4) * 0.25, i, park);
  }
  for (const x of [-38, -15, 6, 28, 52]) {
    const bench = group('공원_벤치', park);
    bench.position.set(x, ground, -30.0);
    box('벤치_좌판', [0, 0.5, 0], [1.9, 0.12, 0.65], wood, bench);
    box('벤치_등받이', [0, 0.87, 0.29], [1.9, 0.5, 0.1], wood, bench);
    for (const side of [-0.68, 0.68]) box('벤치_다리', [side, 0.23, 0], [0.09, 0.46, 0.55], rail, bench);
  }
  for (let x = -72; x <= 72; x += 12) {
    beam('공원_가로등기둥', [x, ground, -29.45], [x, ground + 2.65, -29.45], 0.1, rail, park);
    box('공원_가로등불빛', [x, ground + 2.7, -29.45], [0.34, 0.18, 0.34], lampMaterial, park);
  }

  const dock = group('수변_부두', park);
  const boat = group('계류_식당선박', park);
  const hullMaterial = material('#415862'), cabinMaterial = material('#d8d1b7'), roofMaterial = material('#425b57');
  function gangway(name, start, end, width) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const plank = box(name, a.clone().add(b).multiplyScalar(0.5).toArray(), [width, 0.12, direction.length()], wood, dock);
    plank.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
    return plank;
  }
  box('부두_접안데크', [18, ground + 0.01, -36.4], [17, 0.18, 2.7], wood, dock);
  gangway('부두_육지연결다리', [13.5, ground - 0.008, -32.8], [13.5, ground + 0.04, -35.5], 2.4);
  for (const x of [12.36, 14.64]) beam('부두_진입난간', [x, ground + 0.74, -32.8], [x, ground + 0.79, -35.3], 0.055, rail, dock);
  for (const x of [12.36, 14.64]) for (const z of [-32.8, -35.3]) beam('부두_진입난간기둥', [x, ground + 0.06, z], [x, ground + 0.79, z], 0.055, rail, dock);
  for (const x of [10, 25.8]) for (const z of [-35.4, -37.4]) {
    beam('부두_지지말뚝', [x, EXTERIOR.riverY - 1.0, z], [x, ground + 0.32, z], 0.2, rail, dock);
  }
  for (const [dockX, boatX] of [[11, 13.5], [23.5, 25]]) beam('부두_계류줄', [dockX, ground + 0.25, -37.3], [boatX, EXTERIOR.riverY + 0.72, -38.7], 0.035, bark, dock);

  boat.position.set(20, EXTERIOR.riverY, -40.5);
  const footprint = new THREE.Shape();
  footprint.moveTo(-7, -2); footprint.lineTo(5.2, -2); footprint.lineTo(7, 0); footprint.lineTo(5.2, 2); footprint.lineTo(-7, 2); footprint.closePath();
  const hull = new THREE.Mesh(shadedGeometry(new THREE.ExtrudeGeometry(footprint, { depth: 0.88, bevelEnabled: false, steps: 1 }).rotateX(-Math.PI / 2).translate(0, -0.5, 0)), hullMaterial);
  hull.name = '식당선박_선체'; boat.add(hull);
  box('식당선박_갑판', [-0.4, 0.48, 0], [12.8, 0.2, 3.95], wood, boat);
  box('식당선박_실내', [-1.4, 1.4, 0], [8.2, 1.65, 3.3], cabinMaterial, boat);
  box('식당선박_지붕', [-1.4, 2.33, 0], [8.8, 0.18, 3.8], roofMaterial, boat);
  for (const z of [-1.66, 1.66]) {
    box('식당선박_따뜻한창', [-1.4, 1.45, z], [7.7, 0.93, 0.025], lampMaterial, boat);
    for (const x of [-4.6, -2.6, -0.6, 1.4]) box('식당선박_창틀', [x, 1.45, z * 1.01], [0.09, 1.03, 0.06], roofMaterial, boat);
  }
  box('식당선박_선수창', [2.71, 1.45, 0], [0.025, 0.93, 2.8], lampMaterial, boat);
  box('식당선박_출입문틀', [-1.5, 1.28, 1.69], [0.94, 1.4, 0.055], roofMaterial, boat);
  box('식당선박_출입문유리', [-1.5, 1.3, 1.725], [0.71, 1.12, 0.015], lampMaterial, boat);
  for (const x of [-6.5, 5]) beam('식당선박_계류고리', [x, 0.58, 1.8], [x, 0.78, 1.8], 0.11, rail, boat);
  for (const z of [-1.91, 1.91]) beam('식당선박_갑판난간', [2.85, 1.13, z], [5.8, 1.13, z], 0.055, rail, boat);
  for (const z of [-0.85, 0.85]) {
    const table = new THREE.Mesh(poleGeometry, wood); table.name = '식당선박_야외탁자';
    table.position.set(4.25, 1.15, z); table.scale.set(0.75, 0.075, 0.75); boat.add(table);
    beam('식당선박_탁자다리', [4.25, 0.58, z], [4.25, 1.12, z], 0.11, rail, boat);
    for (const x of [3.45, 5.05]) {
      box('식당선박_의자좌판', [x, 0.84, z], [0.38, 0.09, 0.4], roofMaterial, boat);
      box('식당선박_의자등받이', [x + Math.sign(x - 4.25) * 0.18, 1.06, z], [0.07, 0.4, 0.4], roofMaterial, boat);
      box('식당선박_의자다리', [x, 0.69, z], [0.1, 0.22, 0.1], rail, boat);
    }
  }
  const buoy = new THREE.Mesh(shadedGeometry(new THREE.TorusGeometry(0.24, 0.065, 4, 10)), material('#d98255'));
  buoy.name = '식당선박_구명환'; buoy.position.set(-5.95, 0.94, 2.02); boat.add(buoy);
  gangway('부두_선박승선다리', [18.5, ground + 0.04, -37.55], [18.5, EXTERIOR.riverY + 0.52, -38.8], 1.25);
  const signCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  let signTexture = null;
  if (signCanvas) {
    signCanvas.width = 256; signCanvas.height = 64;
    const context = signCanvas.getContext('2d');
    context.fillStyle = '#253d3c'; context.fillRect(0, 0, 256, 64);
    context.fillStyle = '#f7db9e'; context.font = 'bold 34px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText('수변 식당', 128, 33);
    signTexture = new THREE.CanvasTexture(signCanvas); signTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.575), new THREE.MeshBasicMaterial({ map: signTexture, color: signTexture ? '#ffffff' : '#f7db9e', toneMapped: false }));
  sign.name = '식당선박_간판'; sign.position.set(-1.4, 2.17, 1.94); boat.add(sign);

  // 고정된 선박의 같은 형상·재질 부품은 한 묶음으로 그린다. 접안 검사에 쓰는 갑판은 별도로 둔다.
  const boatParts = new Map();
  for (const part of boat.children) {
    if (part.name === '식당선박_갑판') continue;
    const key = part.geometry.uuid + ':' + part.material.uuid;
    if (!boatParts.has(key)) boatParts.set(key, []);
    boatParts.get(key).push(part);
  }
  for (const parts of boatParts.values()) {
    if (parts.length < 2) continue;
    const batch = new THREE.InstancedMesh(parts[0].geometry, parts[0].material, parts.length);
    batch.name = parts[0].name + '_부품묶음'; batch.userData.parts = parts.map(part => part.name);
    parts.forEach((part, i) => { part.updateMatrix(); batch.setMatrixAt(i, part.matrix); boat.remove(part); });
    boat.add(batch);
  }

  const water = new THREE.Mesh(new THREE.PlaneGeometry(outerWidth, 114, 48, 24), new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uDay: dayUniform, uTime: timeUniform },
    fog: true,
    vertexShader: `
      varying vec3 vWorld;
      uniform float uTime;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.z += sin(p.x * 0.65 + uTime * 0.34) * cos(p.y * 0.7 + uTime * 0.22) * 0.035;
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      ${SUNSET_GLSL}
      varying vec3 vWorld;
      uniform float uDay;
      uniform float uTime;
      uniform vec3 uSun;
      uniform float uSunset;
      uniform float uCover;
      #include <fog_pars_fragment>
      void main() {
        float waves = sin(vWorld.x * 1.1 + vWorld.z * 1.8 + uTime * 0.45)
                    * sin(vWorld.x * 0.4 - vWorld.z * 3.7 + uTime * 0.28);
        float light = smoothstep(0.74, 1.0, waves);
        vec3 day = mix(vec3(0.055, 0.13, 0.15), vec3(0.18, 0.29, 0.30), 0.5 + waves * 0.22);
        vec3 night = vec3(0.008, 0.02, 0.036);
        float reflection = exp(-pow((vWorld.x - 14.0) / 4.8, 2.0)) * (1.0 - smoothstep(-130.0, -35.0, vWorld.z));
        vec3 color = mix(night, day, uDay) + light * mix(0.014, 0.055, uDay);
        color += vec3(0.10, 0.16, 0.20) * reflection * light * (1.0 - uDay);
        if (uSunset > 0.0) {
          vec3 sight = normalize(vWorld - cameraPosition);
          float facing = duskFacing(sight, uSun);
          float warmth = uSunset * duskTransmission(uCover) * (0.12 + 0.40 * facing);
          color = mix(color, vec3(0.30, 0.115, 0.09), warmth * 0.6);
          vec2 sunHorizontal = uSun.xz / max(length(uSun.xz), 0.0001);
          vec2 viewHorizontal = sight.xz / max(length(sight.xz), 0.0001);
          float alignment = pow(max(dot(viewHorizontal, sunHorizontal), 0.0), 18.0);
          float visibleSun = smoothstep(-0.015, 0.015, uSun.y) * (1.0 - smoothstep(0.65, 1.0, uCover));
          float ripple = 0.18 + 0.82 * smoothstep(0.4, 0.94, waves);
          float grazing = pow(1.0 - abs(sight.y), 3.0);
          color += vec3(0.80, 0.30, 0.07) * uSunset * visibleSun * alignment * ripple * (0.2 + 1.2 * grazing);
        }
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `
  }));
  water.name = '한강_수면';
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, EXTERIOR.riverY, -84.5);
  root.add(water);

  const bridge = group('올림픽대교');
  const bridgeStart = new THREE.Vector3(-24, -5.6, -24);
  const bridgeEnd = new THREE.Vector3(-45, -5.6, -143);
  const length = bridgeStart.distanceTo(bridgeEnd);
  bridge.position.copy(bridgeStart).add(bridgeEnd).multiplyScalar(0.5);
  bridge.rotation.y = Math.atan2(bridgeEnd.x - bridgeStart.x, bridgeEnd.z - bridgeStart.z);
  box('올림픽대교_상판', [0, 0, 0], [3.8, 0.38, length], concrete, bridge);
  box('올림픽대교_도로', [0, 0.205, 0], [3.45, 0.025, length], asphalt, bridge);
  for (const side of [-1.86, 1.86]) beam('올림픽대교_난간', [side, 0.62, -length / 2], [side, 0.62, length / 2], 0.1, rail, bridge);
  for (let z = -length / 2 + 7; z < length / 2; z += 13) {
    beam('올림픽대교_교각', [0, -4.75, z], [0, -0.12, z], 0.85, concrete, bridge);
    box('올림픽대교_차선', [0, 0.23, z], [0.05, 0.018, 4], line, bridge);
  }
  // 주탑 위치를 유지한 채 북단 상판에서 둔치 도로까지 이어 창 앞에 끝단이 드러나지 않게 한다.
  const approach = group('올림픽대교_북단접속도로', bridge);
  const join = new THREE.Vector3(0, 0, -length / 2 + 0.25);
  const landing = new THREE.Vector3(0, ground - bridge.position.y - 0.1775, -length / 2 - 36);
  function roadSection(name, start, end) {
    const center = start.clone().add(end).multiplyScalar(0.5);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), end.clone().sub(start).normalize());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const distance = start.distanceTo(end);
    const deck = box(name + '_상판', center.toArray(), [3.8, 0.38, distance], concrete, approach);
    deck.quaternion.copy(rotation);
    const road = box(name + '_노면', center.clone().addScaledVector(up, 0.205).toArray(), [3.45, 0.025, distance], asphalt, approach);
    road.quaternion.copy(rotation);
    const marking = box(name + '_차선', center.clone().addScaledVector(up, 0.23).toArray(), [0.05, 0.018, distance], line, approach);
    marking.quaternion.copy(rotation);
    for (const x of [-1.86, 1.86]) beam(name + '_난간', [x, start.y + 0.62, start.z], [x, end.y + 0.62, end.z], 0.1, rail, approach);
  }
  roadSection('북단_경사연결부', landing, join);
  roadSection('북단_둔치연결부', landing.clone().add(new THREE.Vector3(0, 0, -10)), landing.clone().add(new THREE.Vector3(0, 0, 0.2)));
  for (const t of [0.22, 0.54]) {
    const point = join.clone().lerp(landing, t);
    beam('북단_연결교각', [0, ground - bridge.position.y, point.z], [0, point.y - 0.19, point.z], 0.7, concrete, approach);
  }
  const pylon = group('올림픽대교_주탑', bridge);
  pylon.position.z = -10;
  for (const x of [-1.38, 1.38]) for (const z of [-0.95, 0.95]) {
    beam('올림픽대교_주탑기둥', [x, -0.1, z], [Math.sign(x) * 0.25, 19.8, Math.sign(z) * 0.25], 0.6, concrete, pylon);
  }
  box('올림픽대교_주탑상부', [0, 19.9, 0], [1.2, 0.4, 1.2], concrete, pylon);
  for (const side of [-1, 1]) for (let i = 1; i <= 7; i++) {
    for (const x of [-1.6, 1.6]) beam('올림픽대교_케이블', [Math.sign(x) * 0.25, 18.8 - i * 0.24, side * 0.28], [x, 0.25, side * (5 + i * 4.6)], 0.055, concrete, pylon);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.66, 2.0, 5), crownMaterial);
  flame.name = '올림픽대교_상부조형물';
  flame.position.set(0.15, 21.05, 0);
  flame.rotation.z = -0.2;
  pylon.add(flame);

  const city = group('강건너_도시');
  const landBack = BACKDROP.backZ - 20, landFront = -140;
  box('강건너_둔치', [0, ground - 0.4, (landBack + landFront) / 2], [outerWidth, 0.8, landFront - landBack], grassDark, city);
  box('강건너_강변도로', [0, ground + 0.02, -146], [outerWidth, 0.05, 3.0], asphalt, city);
  const urbanGround = material(CITY_GROUND_COLOR);
  const pavement = material(CITY_PAVEMENT_COLOR);
  const cityAsphalt = material('#4b5155');
  const cityMarking = material('#c9c5b9');
  const storefront = material('#344d58');
  const contact = material(CITY_PAVEMENT_COLOR);
  contact.map = contactTexture();
  // 원거리에서 겹치는 지면·도로·명암이 번갈아 보이지 않도록 표면 순서를 분리한다.
  for (const [index, mat] of [urbanGround, pavement, cityAsphalt, cityMarking, contact].entries()) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -(index + 1);
    mat.polygonOffsetUnits = -(index + 1);
  }
  const contactGeometry = shadedGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  box('도시_기반지면', [0, ground + 0.01, (landBack - 151) / 2], [outerWidth, 0.02, -151 - landBack], urbanGround, city);
  box('강변_보행로', [0, ground + 0.03, -142.6], [outerWidth, 0.06, 1.5], path, city);
  for (const z of [-144.35, -147.65]) box('강변도로_경계석', [0, ground + 0.1, z], [outerWidth, 0.2, 0.18], concrete, city);
  const facadeVertex = `
    varying vec2 vUv;
    varying float vShade;
    varying float vWall;
    uniform float uUseDimensions;
    uniform float uWindowPitch;
    uniform float uGround;
    #include <fog_pars_vertex>
    void main() {
      vec3 size = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
      vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
      float width = mix(size.z, size.x, step(0.5, abs(normal.z)));
      vec2 measuredUv = vec2(uv.x * width / (uWindowPitch * 8.0), (world.y - uGround) / (0.9 * 16.0));
      vUv = mix(uv, measuredUv, uUseDimensions);
      vWall = step(abs(normal.y), 0.5);
      vec3 n = normalize(mat3(modelMatrix) * normal);
      vShade = 0.56 + 0.44 * max(0.0, dot(n, normalize(vec3(-0.35, 0.8, 0.45))));
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `;
  const facadeFragment = `
    varying vec2 vUv;
    varying float vShade;
    varying float vWall;
    uniform sampler2D uWindows;
    uniform vec3 uColor;
    uniform float uDay;
    #include <fog_pars_fragment>
    void main() {
      vec2 pattern = texture2D(uWindows, vUv).rg * vWall;
      vec3 day = uColor * vShade * mix(1.0, 0.46, pattern.r);
      vec3 night = uColor * vShade * 0.075 + vec3(0.54, 0.32, 0.13) * pattern.g;
      gl_FragColor = vec4(mix(night, day, uDay), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `;
  const facade = (color, measured = true, pitch = 0.9) => new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uDay: dayUniform, uWindows: { value: windows }, uColor: { value: new THREE.Color(color) }, uUseDimensions: { value: measured ? 1 : 0 }, uWindowPitch: { value: pitch }, uGround: { value: ground } },
    vertexShader: facadeVertex, fragmentShader: facadeFragment, fog: true
  });
  const facades = ['#b6bdb9', '#9baab0', '#a7afaf', '#bdb4a4', '#889da6'].map(color => facade(color));
  const officeFacades = ['#8cabb5', '#91a6ad', '#94a8ab', '#a4aca9', '#718f9d'].map(color => facade(color, true, 0.65));
  const parcels = [];
  for (const district of createCityLayout(EXTERIOR.towerX, EXTERIOR.towerZ)) {
    const block = group('도시_' + district.kind, city);
    block.position.set(district.x, ground, district.z);
    block.rotation.y = district.rotation;
    const solidBuildings = [];
    for (const item of district.buildings) {
      const building = group('도시_건물묶음', block);
      building.position.set(item.x, 0, item.z);
      building.rotation.y = item.rotation;
      building.userData.kind = district.kind;
      building.userData.height = item.height;
      solidBuildings.push(building);
      if (district.kind === '업무지구') {
        const lower = Math.round(item.height * 0.35 / 0.9) * 0.9;
        box('강건너_건물', [0, lower / 2, 0], [item.width, lower, item.depth], officeFacades[item.palette], building);
        box('업무동_상부', [item.width * 0.05, lower + (item.height - lower) / 2, -item.depth * 0.05], [item.width * 0.84, item.height - lower, item.depth * 0.82], officeFacades[item.palette], building);
      } else {
        box('강건너_건물', [0, item.height / 2, 0], [item.width, item.height, item.depth], facades[item.palette], building);
      }
      if (district.kind === '주거단지') {
        const coreWidth = Math.min(1.3, item.width * 0.18);
        box('주거동_계단실', [item.width / 2 - coreWidth / 2, (item.height + 0.35) / 2, item.depth / 2 - 0.16], [coreWidth, item.height + 0.35, 0.36], concrete, building);
      } else if (item.height < 10) {
        box('상가_유리전면', [0, 0.7, item.depth / 2 + 0.02], [item.width * 0.87, 0.8, 0.05], storefront, building);
        box('상가_차양', [0, 1.32, item.depth / 2 + 0.18], [item.width * 1.03, 0.1, 0.48], concrete, building);
        box('상가_간판띠', [0, 1.16, item.depth / 2 + 0.06], [item.width * 0.68, 0.13, 0.05], lampMaterial, building);
      }
      box('건물_옥상', [item.roofOffset, item.height + item.roofHeight / 2, -item.depth * 0.08], [item.width * 0.48, item.roofHeight, item.depth * 0.46], stone, building);
      const shadow = new THREE.Mesh(contactGeometry, contact);
      shadow.name = '건물_접지명암';
      shadow.position.set(item.x, 0.065, item.z);
      shadow.rotation.y = item.rotation;
      shadow.scale.set(item.width + 2.0, 1, item.depth + 2.0);
      block.add(shadow);
    }
    if (district.kind === '낮은시가지') {
      const frontZ = Math.max(...district.buildings.map(item => item.z));
      const front = district.buildings.filter(item => item.z > frontZ - district.pitchZ * 0.5);
      const left = Math.min(...front.map(item => item.x - item.width / 2));
      const right = Math.max(...front.map(item => item.x + item.width / 2));
      const edge = Math.max(...front.map(item => item.z + item.depth / 2));
      box('저층_연결상가', [(left + right) / 2, 0.6, edge - 0.7], [right - left, 1.2, 1.8], facades[district.palette], block);
      box('저층_연속차양', [(left + right) / 2, 1.25, edge + 0.05], [right - left + 0.2, 0.1, 0.7], concrete, block);
    }
    block.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    for (const building of solidBuildings) bounds.union(new THREE.Box3().setFromObject(building));
    bounds.expandByScalar(1.3);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    box('도시_보도부지', [center.x, ground + 0.03, center.z], [size.x, 0.04, size.z], pavement, city);
    parcels.push(bounds);
  }
  const roads = group('도시_도로망', city);
  const rearRoad = [[-300, -217], [-150, -220], [25, -223], [180, -218], [300, -220]];
  function street(name, start, end, width) {
    const dx = end[0] - start[0], dz = end[1] - start[1];
    const length = Math.hypot(dx, dz), rotation = Math.atan2(dx, dz);
    const road = box(name, [(start[0] + end[0]) / 2, ground + 0.035, (start[1] + end[1]) / 2], [width, 0.05, length + 0.1], cityAsphalt, roads);
    road.rotation.y = rotation;
    const marking = box('도시도로_중앙선', [road.position.x, ground + 0.065, road.position.z], [0.045, 0.018, length], cityMarking, roads);
    marking.rotation.y = rotation;
    return road;
  }
  for (let i = 1; i < rearRoad.length; i++) street('도시_후면연결도로', rearRoad[i - 1], rearRoad[i], 3.2);
  const bounds = parcels.sort((a, b) => a.min.x - b.min.x);
  const entries = [-274, ...bounds.slice(1).map((next, i) => (bounds[i].max.x + next.min.x) / 2), 274];
  for (const x of entries) {
    const segment = rearRoad.findIndex((point, i) => i > 0 && x <= point[0]);
    const a = rearRoad[segment - 1], b = rearRoad[segment];
    const backZ = THREE.MathUtils.lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
    const nearest = Math.min(...bounds.map(parcel => x < parcel.min.x ? parcel.min.x - x : x > parcel.max.x ? x - parcel.max.x : 0));
    const width = Math.min(2.6, nearest * 2 - 0.25);
    if (width < 1.2) continue;
    street('도시_진입도로', [x, -146], [x, backZ], width);
    for (let offset = -1.05; offset <= 1.05; offset += 0.42) {
      box('도시_횡단보도', [x, ground + 0.078, -149.5 + offset], [width * 0.85, 0.016, 0.2], cityMarking, roads);
    }
  }
  const bridgeExit = roads.children.filter(object => object.name === '도시_진입도로')
    .sort((a, b) => Math.abs(a.position.x - bridgeEnd.x) - Math.abs(b.position.x - bridgeEnd.x))[0];
  if (bridgeExit) {
    const ramp = group('올림픽대교_남단접속로', city);
    const points = [
      // 꺾이는 노면을 교량 안쪽까지 겹쳐 양쪽 차로의 접속 모서리에 틈이 남지 않게 한다.
      bridgeEnd.clone().addScaledVector(bridgeEnd.clone().sub(bridgeStart).normalize(), -1.2).add(new THREE.Vector3(0, 0.2175, 0)),
      bridgeEnd.clone().add(new THREE.Vector3(0, 0.2175, 0)),
      new THREE.Vector3(bridgeEnd.x + 5, -6.4, -148.5),
      new THREE.Vector3(bridgeExit.position.x, ground + 0.06, -151),
      new THREE.Vector3(bridgeExit.position.x, ground + 0.06, -155)
    ];
    const widths = [3.45, 3.45, 3.3, bridgeExit.scale.x, bridgeExit.scale.x];
    function ribbon(lineWidth, lift) {
      const vertices = [], indices = [];
      for (let i = 0; i < points.length; i++) {
        const direction = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(0, i - 1)]);
        const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize().multiplyScalar((lineWidth || widths[i]) / 2);
        for (const sign of [-1, 1]) vertices.push(...points[i].clone().addScaledVector(side, sign).add(new THREE.Vector3(0, lift, 0)).toArray());
        if (i < points.length - 1) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return shadedGeometry(geometry);
    }
    const surface = new THREE.Mesh(ribbon(0, 0), cityAsphalt);
    surface.name = '남단접속로_노면';
    ramp.add(surface);
    const marking = new THREE.Mesh(ribbon(0.045, 0.018), cityMarking);
    marking.name = '남단접속로_차선';
    ramp.add(marking);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const direction = b.clone().sub(a);
      const horizontal = Math.hypot(direction.x, direction.z);
      const deck = box('남단접속로_상판', a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.23, 0)).toArray(), [Math.max(widths[i - 1], widths[i]) + 0.25, 0.4, direction.length() + 0.25], concrete, ramp);
      deck.rotation.set(-Math.atan2(direction.y, horizontal), Math.atan2(direction.x, direction.z), 0, 'YXZ');
      const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
      for (const sign of [-1, 1]) beam('남단접속로_난간', a.clone().addScaledVector(side, sign * widths[i - 1] / 2).add(new THREE.Vector3(0, 0.45, 0)).toArray(), b.clone().addScaledVector(side, sign * widths[i] / 2).add(new THREE.Vector3(0, 0.45, 0)).toArray(), 0.075, rail, ramp);
    }
    for (const point of points.slice(0, 2)) beam('남단접속로_교각', [point.x, ground, point.z], [point.x, point.y - 0.4, point.z], 0.65, concrete, ramp);
  }
  for (let i = 0; i < 34; i++) tree((i - 17) * 10, -143.8, 1.9 + i % 3 * 0.25, i, city);
  const tower = group('롯데월드타워', city);
  tower.position.set(EXTERIOR.towerX, ground, EXTERIOR.towerZ);
  const towerBody = new THREE.Mesh(towerGeometry(EXTERIOR.towerHeight), facade('#9bb7c3', false));
  towerBody.name = '롯데월드타워_곡선입면';
  tower.add(towerBody);
  box('롯데월드타워_기단', [0, 0.7, 0], [11, 1.4, 8], facades[2], tower);
  beam('롯데월드타워_첨탑', [0, EXTERIOR.towerHeight - 0.1, 0], [0, EXTERIOR.towerHeight + 1.6, 0], 0.11, crownMaterial, tower);

  const hills = new THREE.Shape();
  hills.moveTo(-250, ground - 2);
  for (let i = 0; i <= 24; i++) hills.lineTo(-250 + i * 21, ground + 11 + Math.sin(i * 0.84) * 5 + Math.sin(i * 2.1) * 3);
  hills.lineTo(254, ground - 2);
  const hill = new THREE.Mesh(new THREE.ShapeGeometry(hills), new THREE.MeshBasicMaterial({ color: '#859291', fog: true }));
  hill.name = '먼_산능선';
  hill.position.z = -340;
  root.add(hill);

  const skyTop = new THREE.Color(), horizon = new THREE.Color();
  const sky = createWeatherSky(skyTop, horizon);
  // 태양 방향·운량·노을 값을 공유해 하늘과 물의 색이 서로 다른 시점에 바뀌지 않게 한다.
  for (const key of ['uSun', 'uSunset', 'uCover']) water.material.uniforms[key] = sky.mesh.material.uniforms[key];
  root.add(sky.mesh);
  const fog = new THREE.Fog('#a0b3bc', 150, 420);
  const backdrop = createBackdrop(dayUniform, horizon, ground, sky.mesh.material.uniforms);
  root.add(backdrop);
  const topDay = new THREE.Color('#719bad'), topNight = new THREE.Color('#101d34');
  const horizonDay = new THREE.Color('#c0cbc6'), horizonNight = new THREE.Color('#304055'), horizonEvening = new THREE.Color('#c99277');
  let dateKey;
  let times;
  return {
    root, fog, park, bridge, tower, water, backdrop, sky,
    setWeather(weather) { sky.setWeather(weather); },
    setTime(date = new Date()) {
      const key = new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
      if (key !== dateKey) { dateKey = key; times = seoulDaylight(date); }
      const lighting = exteriorLighting(date, times);
      sky.setTime(date, lighting);
      dayUniform.value = lighting.day;
      skyTop.lerpColors(topNight, topDay, lighting.day);
      horizon.lerpColors(horizonNight, horizonDay, lighting.day).lerp(horizonEvening, lighting.twilight * 0.6);
      fog.color.copy(horizon);
      hill.material.color.copy(horizon).multiplyScalar(0.63);
      for (const entry of materials) entry.value.color.copy(entry.color).multiplyScalar(0.12 + lighting.day * 0.88);
      lampMaterial.color.set('#ffca86').multiplyScalar(0.15 + lighting.night * 1.25);
      crownMaterial.color.set('#d8b57b').multiplyScalar(0.55 + lighting.night * 0.65);
      return lighting;
    },
    update(seconds) { timeUniform.value += Math.max(0, seconds); sky.update(seconds); }
  };
}
