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
  const fog = new THREE.Fog('#a0b3bc', 150, 420);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.025, 520);
  const originalTarget = { name: '원래 타깃' };
  const renderer = {
    extensions: { has: () => true }, autoClear: false, shadowMap: { autoUpdate: true },
    currentTarget: originalTarget,
    getRenderTarget() { return this.currentTarget; },
    setRenderTarget(value) { this.currentTarget = value; },
    // 눈 위치 깊이는 통과시키고 그림자 갱신을 끈 뒤의 첫 프로브 캡처에서 실패시킨다.
    calls: 0,
    render() { assert.equal(window.visible, false); assert.equal(scene.fog, null); if (++this.calls < 2) return; throw new Error('검증용 캡처 실패'); },
  };
  const effect = createTexelSplatRenderer(renderer, scene, camera);
  effect.bindScene();
  assert.throws(() => effect.render(0), /검증용 캡처 실패/);
  assert.equal(window.visible, true);
  assert.equal(scene.fog, fog);
  assert.equal(renderer.autoClear, false);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.currentTarget, originalTarget);
  effect.dispose();
});

test('점광원은 캡처에서 빼고, 꺼진 순간에 묶여도 원본 재질의 켜짐을 따라 덧그린다', () => {
  const scene = new THREE.Scene();
  const lightMaterial = new THREE.ShaderMaterial({ uniforms: { uSize: { value: 0.3 } } });
  lightMaterial.visible = false;
  const light = new THREE.Points(new THREE.BufferGeometry(), lightMaterial);
  light.userData.splatOverlay = true;
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.025, 520);
  const overlays = [];
  const renderer = {
    extensions: { has: () => true }, autoClear: true, shadowMap: { autoUpdate: true }, target: null,
    getRenderTarget() { return this.target; }, setRenderTarget(value) { this.target = value; }, clear() {},
    render(actualScene) {
      if (actualScene === scene) { assert.equal(light.visible, false); return; }
      const overlay = actualScene.children.find(child => child.isPoints);
      if (overlay) overlays.push(overlay.visible && overlay.material.visible);
    },
  };
  const effect = createTexelSplatRenderer(renderer, scene, camera);
  effect.bindScene();
  effect.render(0);
  lightMaterial.visible = true;
  effect.render(0.1);
  assert.deepEqual(overlays, [false, true]);
  assert.equal(light.visible, true);
  effect.dispose();
});
