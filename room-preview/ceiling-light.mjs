import { Box3, RectAreaLight, Vector3 } from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export const CEILING_LIGHT = Object.freeze({ intensity: 22, color: 0xffedd4 });

export function createCeilingLight(diffuser, switchButton = null) {
  if (!diffuser?.isMesh || !diffuser.material?.emissive) throw new Error('천장등 확산판의 재질을 확인할 수 없습니다.');
  RectAreaLightUniformsLib.init();
  diffuser.material = diffuser.material.clone();
  diffuser.material.emissive.set(CEILING_LIGHT.color);
  diffuser.material.emissiveIntensity = 0;
  const box = new Box3().setFromObject(diffuser), center = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
  const light = new RectAreaLight(CEILING_LIGHT.color, 0, size.x, size.z);
  light.name = '천장등_면광원';
  light.position.set(center.x, box.min.y - 0.006, center.z);
  light.lookAt(center.x, center.y - 1, center.z);
  const switchRestX = switchButton?.rotation.x || 0;
  let on = false;
  function setOn(value) {
    on = Boolean(value);
    light.intensity = on ? CEILING_LIGHT.intensity : 0;
    diffuser.material.emissiveIntensity = on ? 1.4 : 0;
    if (switchButton) {
      switchButton.rotation.x = switchRestX + (on ? 0.02 : -0.02);
      switchButton.updateMatrixWorld(true);
    }
  }
  setOn(false);
  return { light, setOn, toggle() { setOn(!on); return on; }, get on() { return on; } };
}
