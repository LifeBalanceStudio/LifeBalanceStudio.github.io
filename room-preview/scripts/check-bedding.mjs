import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Raycaster, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 실제 GLB에 내보낸 표면·변환으로 침구가 지지면 아래로 파고드는지 확인한다.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] || path.join(root, 'assets/room.glb'));
globalThis.self = globalThis;
const loader = new GLTFLoader();
loader.register(() => ({ name: '검증용_텍스처생략', loadTexture: () => Promise.resolve(new Texture()) }));
const bytes = await fs.readFile(input);
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const required = name => {
  const object = gltf.scene.getObjectByName(name);
  if (!object?.isMesh) throw new Error('침구 검사 대상 누락: ' + name);
  return object;
};
const duvet = required('이불_고정주름');
const throwCloth = required('황토색_담요');
const bed = [required('매트리스'), required('침대_프레임')];
const weights = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [1 / 3, 1 / 3, 1 / 3]];
const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 4);
const point = new Vector3();
const hits = [];

function inspect(cloth, supports) {
  const bounds = supports.map(object => ({ object, box: new Box3().setFromObject(object) }));
  const positions = cloth.geometry.getAttribute('position');
  const vertices = Array.from({ length: positions.count }, (_, i) => new Vector3().fromBufferAttribute(positions, i).applyMatrix4(cloth.matrixWorld));
  const indices = cloth.geometry.getIndex();
  const count = indices ? indices.count : positions.count;
  const zones = { 전체: { 표본: 0, 파고듦: 0, 최소여유_m: Infinity }, 좌측: { 표본: 0, 파고듦: 0, 최소여유_m: Infinity }, 우측: { 표본: 0, 파고듦: 0, 최소여유_m: Infinity }, 발치: { 표본: 0, 파고듦: 0, 최소여유_m: Infinity } };
  const examples = [];
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(offset => vertices[indices ? indices.getX(i + offset) : i + offset]);
    for (const [u, v, w] of weights) {
      point.set(a.x * u + b.x * v + c.x * w, a.y * u + b.y * v + c.y * w, a.z * u + b.z * v + c.z * w);
      let supportY = -Infinity;
      ray.ray.origin.set(point.x, 3, point.z);
      for (const { object, box } of bounds) {
        if (point.x < box.min.x || point.x > box.max.x || point.z < box.min.z || point.z > box.max.z) continue;
        hits.length = 0;
        ray.intersectObject(object, false, hits);
        if (hits.length) supportY = Math.max(supportY, hits[0].point.y);
      }
      if (!Number.isFinite(supportY)) continue;
      const gap = point.y - supportY;
      for (const name of ['전체', ...(point.x < -1.31 ? ['좌측'] : point.x > -0.51 ? ['우측'] : []), ...(point.z > 0.38 ? ['발치'] : [])]) {
        zones[name].표본++;
        zones[name].최소여유_m = Math.min(zones[name].최소여유_m, gap);
        if (gap < -0.0005) zones[name].파고듦++;
      }
      if (gap < -0.0005 && examples.length < 5) examples.push({ 위치: point.toArray().map(n => +n.toFixed(5)), 여유_m: +gap.toFixed(5) });
    }
  }
  for (const zone of Object.values(zones)) zone.최소여유_m = Number.isFinite(zone.최소여유_m) ? +zone.최소여유_m.toFixed(6) : null;
  return { 영역: zones, 파고듦_예시: examples };
}

const report = {
  검사파일: input,
  회색이불_대_침대: inspect(duvet, bed),
  갈색천_대_침대와이불: inspect(throwCloth, [...bed, duvet]),
  검증범위: '실제 GLB의 삼각형 정점·변 중앙·중심에서 지지면 위쪽과 비교, 0.5mm 오차 허용. 내보내지 않은 Blender 수정자와 모든 면 교차의 수학적 증명, 수동 검수는 포함하지 않음.',
};
console.log(JSON.stringify(report, null, 2));
if (report.회색이불_대_침대.영역.전체.파고듦 || report.갈색천_대_침대와이불.영역.전체.파고듦) process.exitCode = 1;
