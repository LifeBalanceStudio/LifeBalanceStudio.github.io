import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { CEILING_LIGHT, createCeilingLight } from '../ceiling-light.mjs';

test('천장등은 소등 상태에서 시작하고 확산판 아래에서 바닥을 비춘다', () => {
  const material = new MeshStandardMaterial(), geometry = new BoxGeometry(0.66, 0.012, 0.66);
  const diffuser = new Mesh(geometry, material); diffuser.position.set(0, 2.441, -0.05);
  const lamp = createCeilingLight(diffuser);
  assert.equal(lamp.on, false); assert.equal(lamp.light.intensity, 0);
  assert.ok(Math.abs(lamp.light.width - 0.66) < 0.00001 && Math.abs(lamp.light.height - 0.66) < 0.00001);
  assert.ok(lamp.light.position.y < 2.435);
  const direction = new Vector3(0, 0, -1).applyQuaternion(lamp.light.quaternion);
  assert.ok(direction.y < -0.999);
  assert.notEqual(diffuser.material, material);
  assert.equal(diffuser.geometry, geometry);
});

test('켜기·끄기는 광원과 발광만 바꾸고 같은 객체를 재사용한다', () => {
  const diffuser = new Mesh(new BoxGeometry(0.66, 0.012, 0.66), new MeshStandardMaterial());
  diffuser.position.y = 2.441;
  const lamp = createCeilingLight(diffuser), light = lamp.light, material = diffuser.material;
  assert.equal(lamp.toggle(), true); assert.equal(light.intensity, CEILING_LIGHT.intensity);
  assert.ok(material.emissiveIntensity > 0);
  assert.equal(lamp.toggle(), false); assert.equal(light.intensity, 0); assert.equal(material.emissiveIntensity, 0);
  for (let i = 0; i < 100; i++) lamp.toggle();
  assert.equal(lamp.light, light); assert.equal(diffuser.material, material); assert.equal(lamp.on, false);
});

test('벽 스위치의 버튼 자세는 같은 천장등 상태를 따르며 반복 조작에도 누적되지 않는다', () => {
  const diffuser = new Mesh(new BoxGeometry(0.66, 0.012, 0.66), new MeshStandardMaterial());
  const rocker = new Mesh(new BoxGeometry(0.05, 0.078, 0.008), new MeshStandardMaterial());
  rocker.rotation.x = 0.3;
  const lamp = createCeilingLight(diffuser, rocker);
  assert.ok(Math.abs(rocker.rotation.x - 0.28) < 1e-10);
  const light = lamp.light;
  lamp.toggle();
  assert.ok(Math.abs(rocker.rotation.x - 0.32) < 1e-10);
  assert.equal(light.intensity, CEILING_LIGHT.intensity);
  lamp.setOn(false);
  for (let i = 0; i < 100; i++) lamp.toggle();
  assert.ok(Math.abs(rocker.rotation.x - 0.28) < 1e-10);
  assert.equal(lamp.light, light);
  assert.equal(lamp.on, false);
});
