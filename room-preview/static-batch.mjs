import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function batchStaticExterior(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4(), center = new THREE.Vector3();
  const groups = new Map(), sources = [], batches = [];
  const merged = new THREE.Group(); merged.name = '고정_배경_그리기_묶음';
  root.traverse(mesh => {
    // 물·하늘·건물 셰이더와 기존 인스턴스는 각자의 갱신 방식을 유지한다.
    if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.visible || mesh.children.length || !mesh.material?.isMeshBasicMaterial
      || mesh.material.transparent || mesh.renderOrder !== 0 || mesh.geometry.drawRange.start !== 0
      || mesh.geometry.drawRange.count !== Infinity || Object.keys(mesh.geometry.morphAttributes).length) return;
    center.setFromMatrixPosition(mesh.matrixWorld);
    const attributes = Object.entries(mesh.geometry.attributes).map(([name, value]) => `${name}:${value.itemSize}:${value.normalized}:${value.array.constructor.name}`).sort().join('|');
    const key = [mesh.material.uuid, Math.floor(center.x / 64), Math.floor(center.z / 64), mesh.castShadow, mesh.receiveShadow, Boolean(mesh.geometry.index), attributes].join(';');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 3) continue;
    const geometries = [];
    for (const mesh of meshes) {
      matrix.multiplyMatrices(inverse, mesh.matrixWorld);
      const geometry = mesh.geometry.clone().applyMatrix4(matrix);
      if (matrix.determinant() < 0) {
        if (geometry.index) {
          const index = geometry.index.array;
          for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
        } else {
          for (const attribute of Object.values(geometry.attributes)) {
            const values = attribute.array, size = attribute.itemSize;
            for (let i = 0; i < attribute.count; i += 3) for (let channel = 0; channel < size; channel++) {
              const a = (i + 1) * size + channel, b = (i + 2) * size + channel;
              [values[a], values[b]] = [values[b], values[a]];
            }
          }
        }
      }
      geometries.push(geometry);
    }
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(value => value.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const batch = new THREE.Mesh(geometry, meshes[0].material);
    batch.name = '고정_배경_' + batches.length;
    batch.castShadow = meshes[0].castShadow; batch.receiveShadow = meshes[0].receiveShadow;
    merged.add(batch); batches.push(batch);
    for (const mesh of meshes) { sources.push(mesh); mesh.visible = false; }
  }
  root.add(merged);
  return { root: merged, sourceCount: sources.length, batchCount: batches.length,
    setEnabled(enabled) { merged.visible = Boolean(enabled); for (const mesh of sources) mesh.visible = !enabled; },
    dispose() { for (const mesh of sources) mesh.visible = true; for (const mesh of batches) mesh.geometry.dispose(); root.remove(merged); } };
}
