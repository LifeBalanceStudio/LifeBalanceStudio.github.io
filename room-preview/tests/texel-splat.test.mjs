import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TEXEL_SPLAT, snapProbePosition, createTexelSplatRenderer } from '../texel-splat.mjs';

test('텍셀 원점은 같은 셀 안에서 고정되며 셀 경계를 넘으면 정확히 한 칸 이동한다', () => {
  const target = new THREE.Vector3();
  assert.equal(snapProbePosition({ x: 0.02, y: 1.35, z: -0.06 }, target), target);
  assert.deepEqual(target.toArray(), [0, 1.25, -0]);
  assert.deepEqual(snapProbePosition({ x: 0.12, y: 1.36, z: 0.08 }).toArray(), [0, 1.25, 0]);
  assert.equal(snapProbePosition({ x: 0.13, y: 1.36, z: 0.08 }).x, TEXEL_SPLAT.gridStep);
  assert.equal(snapProbePosition({ x: -0.13, y: 1.36, z: 0.08 }).x, -TEXEL_SPLAT.gridStep);
});

test('지원하지 않는 색 버퍼에서는 원래 장면을 렌더링한다', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.025, 520);
  let draws = 0;
  const effect = createTexelSplatRenderer({
    extensions: { has: () => false },
    render(actualScene, actualCamera) { assert.equal(actualScene, scene); assert.equal(actualCamera, camera); draws++; },
  }, scene, camera);
  effect.setEnabled(true);
  effect.render(0);
  assert.equal(effect.supported, false);
  assert.equal(effect.state.enabled, false);
  assert.equal(draws, 1);
  effect.dispose();
});

test('샘플 캡처가 실패해도 유리의 가시성과 렌더러 상태를 복구한다', () => {
  const scene = new THREE.Scene();
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1 });
  const window = new THREE.Mesh(new THREE.PlaneGeometry(), glass);
  scene.add(window);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.025, 520);
  const originalTarget = { name: '원래 타깃' };
  const renderer = {
    extensions: { has: () => true }, autoClear: false, shadowMap: { autoUpdate: true },
    currentTarget: originalTarget,
    getRenderTarget() { return this.currentTarget; },
    setRenderTarget(value) { this.currentTarget = value; },
    render() { assert.equal(window.visible, false); throw new Error('검증용 캡처 실패'); },
  };
  const effect = createTexelSplatRenderer(renderer, scene, camera);
  effect.bindScene();
  assert.throws(() => effect.render(0), /검증용 캡처 실패/);
  assert.equal(glass.depthWrite, true);
  assert.equal(window.visible, true);
  assert.equal(renderer.autoClear, false);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.currentTarget, originalTarget);
  effect.dispose();
});
