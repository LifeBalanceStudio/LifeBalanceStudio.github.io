import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStaticExterior } from '../static-batch.mjs';
import { createExterior } from '../exterior.mjs';

test('고정 배경을 묶어도 원본 형상·재질과 거울 변환의 앞면을 유지한다', () => {
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial({ color: '#abcdef' });
  const meshes = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.position.set(3 + i * 2, 0, 4); mesh.rotation.y = i * 0.3;
    mesh.scale.set(i === 2 ? -1 : 1, 2, 1.5); root.add(mesh); meshes.push(mesh);
  }
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const positions = meshes.map(mesh => Array.from(mesh.geometry.attributes.position.array));
  const batch = batchStaticExterior(root);
  assert.equal(batch.sourceCount, 4); assert.equal(batch.batchCount, 1);
  const merged = batch.root.children[0];
  assert.equal(merged.material, material);
  const after = new THREE.Box3().setFromObject(merged);
  assert.ok(bounds.min.distanceTo(after.min) < 0.00001 && bounds.max.distanceTo(after.max) < 0.00001);
  meshes.forEach((mesh, i) => assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), positions[i]));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  const geometry = merged.geometry, index = geometry.index.array;
  for (let i = 0; i < index.length; i += 3) {
    a.fromBufferAttribute(geometry.attributes.position, index[i]); b.fromBufferAttribute(geometry.attributes.position, index[i + 1]); c.fromBufferAttribute(geometry.attributes.position, index[i + 2]);
    normal.fromBufferAttribute(geometry.attributes.normal, index[i]);
    assert.ok(b.sub(a).cross(c.sub(a)).dot(normal) > 0);
  }
  batch.setEnabled(false); assert.ok(meshes.every(mesh => mesh.visible)); assert.equal(batch.root.visible, false);
  batch.dispose(); assert.ok(meshes.every(mesh => mesh.visible));
});

test('실제 외부 장면의 물·하늘·건물 셰이더를 유지하면서 고정 묶음 수를 줄인다', () => {
  const exterior = createExterior();
  const batch = batchStaticExterior(exterior.root);
  assert.ok(batch.sourceCount > 500 && batch.batchCount < batch.sourceCount / 2);
  assert.equal(exterior.water.visible, true); assert.equal(exterior.sky.mesh.visible, true);
  exterior.setTime(new Date('2026-09-12T22:00:00+09:00'));
  assert.ok(batch.root.children.every(mesh => mesh.material.isMeshBasicMaterial || (mesh.isInstancedMesh && mesh.material.userData.staticFacadeInstances)));
  assert.ok(batch.root.children.some(mesh => mesh.isInstancedMesh));
  batch.dispose();
});

test('건물 인스턴스는 원본의 개별 변환·공유 재질을 보존하고 원본 기하를 해제하지 않는다', () => {
  const root = new THREE.Group(); root.position.set(3, 0, 4); root.rotation.y = 0.2;
  const geometry = new THREE.BoxGeometry(), material = new THREE.ShaderMaterial();
  material.userData.staticFacadeInstances = true;
  let disposed = false; geometry.addEventListener('dispose', () => { disposed = true; });
  const meshes = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(i * 2, 1, 4); mesh.rotation.y = i * 0.3; mesh.scale.set(1 + i, 2 + i, 1.5);
    root.add(mesh); meshes.push(mesh);
  }
  root.updateMatrixWorld(true);
  const original = meshes.map(mesh => mesh.matrixWorld.clone());
  const grouped = batchStaticExterior(root); root.updateMatrixWorld(true);
  const batch = grouped.root.children[0];
  assert.equal(batch.isInstancedMesh, true); assert.equal(batch.count, 4); assert.equal(batch.material, material);
  assert.notEqual(batch.geometry, geometry);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 4; i++) {
    batch.getMatrixAt(i, matrix); matrix.premultiply(batch.matrixWorld);
    matrix.elements.forEach((value, index) => assert.ok(Math.abs(value - original[i].elements[index]) < 1e-5));
  }
  grouped.dispose(); assert.equal(disposed, false); assert.ok(meshes.every(mesh => mesh.visible));
});

test('반전된 건물과 지정되지 않은 셰이더는 인스턴스로 묶지 않는다', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry();
  const material = new THREE.ShaderMaterial(); material.userData.staticFacadeInstances = true;
  const mirror = new THREE.Mesh(geometry, material); mirror.scale.x = -1; root.add(mirror);
  const other = new THREE.ShaderMaterial();
  for (let i = 0; i < 4; i++) { const mesh = new THREE.Mesh(geometry, other); mesh.position.x = i; root.add(mesh); }
  const grouped = batchStaticExterior(root);
  assert.equal(grouped.sourceCount, 0); assert.equal(mirror.visible, true);
});
