import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, NormalBlending, PerspectiveCamera, Scene, UnsignedByteType } from 'three';
import { createInteractionOutline, outlinePulse } from '../outline.mjs';

function fixture() {
  const scene = new Scene();
  scene.background = new Color('#102030');
  const selected = new Group();
  const selectedMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  selected.add(selectedMesh);
  const other = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  other.position.x = 3;
  scene.add(selected, other);
  const camera = new PerspectiveCamera(70, 16 / 9, 0.025, 40);
  camera.position.z = 4;
  camera.updateMatrixWorld();
  const events = [];
  let target = null;
  let color = new Color('#314159');
  let alpha = 1;
  const renderer = {
    autoClear: true,
    shadowMap: { autoUpdate: true },
    getRenderTarget: () => target,
    setRenderTarget(value) { target = value; events.push({ type: 'target', value }); },
    getClearColor(out) { return out.copy(color); },
    getClearAlpha: () => alpha,
    setClearColor(value, nextAlpha) { color = new Color(value); alpha = nextAlpha; },
    clear() { events.push({ type: 'clear', target }); },
    render(object) { events.push({ type: 'render', target, object, material: object.material, shadowUpdate: this.shadowMap.autoUpdate }); }
  };
  const effect = createInteractionOutline(renderer, scene, camera);
  return { scene, selected, selectedMesh, other, renderer, events, effect };
}

test('대상이 없거나 방을 표시하지 않는 상태에서는 추가 렌더를 하지 않는다', () => {
  const { effect, selected, events } = fixture();
  effect.render(0.016);
  assert.equal(events.length, 0);
  effect.setMode('ready');
  effect.render(0.016);
  effect.setTargets([{ outlineObjects: [selected] }]);
  for (const mode of ['loading', 'error', 'tv-enter', 'tv', 'tv-exit']) {
    effect.setMode(mode);
    assert.equal(effect.selectedObjects.length, 0);
    effect.render(0.016);
  }
  assert.equal(events.length, 0);
  effect.dispose();
});

test('방에서는 거리와 시선에 관계없이 모든 대상을 표시하고 메뉴 복귀 시 복원한다', () => {
  const { effect, selected, other } = fixture();
  other.position.set(20, 0, 20);
  effect.setTargets([{ outlineObjects: [selected] }, { outlineObjects: [other] }]);
  for (const mode of ['ready', 'explore', 'paused', 'tv', 'explore']) {
    effect.setMode(mode);
    assert.deepEqual(effect.selectedObjects, mode === 'tv' ? [] : [selected, other]);
  }
  effect.setTargets([]);
  assert.equal(effect.selectedObjects.length, 0);
  effect.dispose();
});

test('반짝임은 테두리가 꺼지지 않고 반복되며 동작 줄이기에서는 고정된다', () => {
  const values = Array.from({ length: 161 }, (_, index) => outlinePulse(index / 100));
  assert.ok(Math.min(...values.map(value => value.opacity)) >= 0.76);
  assert.ok(Math.max(...values.map(value => value.opacity)) <= 1);
  assert.ok(values[40].glow > values[120].glow);
  assert.ok(Math.abs(outlinePulse(0.4).opacity - outlinePulse(2).opacity) < 1e-10);
  assert.deepEqual(outlinePulse(0, true), outlinePulse(0.8, true));
});

test('표준 아웃라인 패스를 실행해도 기본 화면을 지우지 않고 장면 상태를 복원한다', () => {
  const { scene, effect, selected, selectedMesh, other, renderer, events } = fixture();
  const background = scene.background;
  effect.resize(1280, 720);
  effect.setTargets([{ outlineObjects: [selected] }]);
  effect.setMode('explore');
  effect.render(0.016);
  const overlay = events.find(event => event.type === 'render' && event.target === null);
  assert.ok(overlay);
  assert.equal(overlay.material.blending, NormalBlending);
  assert.deepEqual(overlay.material.uniforms.outlineTint.value.toArray(), [0, 1, 170 / 255]);
  assert.ok(events.filter(event => event.type === 'clear').every(event => event.target !== null));
  assert.equal(renderer.getRenderTarget(), null);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(scene.background, background);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(selectedMesh.visible, true);
  assert.equal(other.visible, true);
  effect.dispose();
});

test('아웃라인 마스크 크기를 제한하고 부동소수점 타깃을 요구하지 않는다', () => {
  const { effect, selected, events } = fixture();
  effect.resize(3840, 2160);
  effect.setTargets([{ outlineObjects: [selected] }]);
  effect.setMode('explore');
  effect.render(0.016);
  const targets = events.filter(event => event.type === 'target' && event.value).map(event => event.value);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.ok(target.width <= 1280 && target.height <= 720);
    assert.equal(target.texture.type, UnsignedByteType);
  }
  effect.dispose();
});
