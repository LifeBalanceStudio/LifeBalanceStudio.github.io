import * as THREE from 'three';
import { CITY_GROUND_COLOR } from './city-layout.mjs';
import { SUNSET_GLSL } from './sunset.mjs';

export const BACKDROP = { halfWidth: 280, backZ: -330, frontZ: 30 };

export function createBackdrop(dayUniform, horizon, groundY, skyUniforms = {}) {
  const root = new THREE.Group();
  root.name = '원경_배경판';
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uDay: dayUniform, uHorizon: { value: horizon }, uGround: { value: groundY },
      uSun: skyUniforms.uSun || { value: new THREE.Vector3() }, uSunset: skyUniforms.uSunset || { value: 0 }, uCover: skyUniforms.uCover || { value: 0 },
      uLand: { value: new THREE.Color('#556c49') }, uCity: { value: new THREE.Color('#8b9a9b') },
      uCityGround: { value: new THREE.Color(CITY_GROUND_COLOR) }
    },
    fog: true,
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      ${SUNSET_GLSL}
      varying vec3 vWorld;
      uniform float uDay;
      uniform vec3 uSun;
      uniform float uSunset;
      uniform float uCover;
      uniform float uGround;
      uniform vec3 uHorizon;
      uniform vec3 uLand;
      uniform vec3 uCity;
      uniform vec3 uCityGround;
      #include <fog_pars_fragment>

      float hash(float value) { return fract(sin(value * 127.1 + 41.7) * 43758.5453); }

      void main() {
        // 같은 방위각과 높이를 사용해 후면·측면 판의 그림이 모서리에서도 이어지게 한다.
        float angle = atan(vWorld.x, -vWorld.z);
        float height = (vWorld.y - uGround) / max(1.0, length(vWorld.xz));
        float aa = max(fwidth(height) * 1.5, 0.00015);
        // 정면 원경이 가까운 건물 뒤에 묻히지 않도록 높이고, 측면으로 갈수록 원래 높이에 연결한다.
        float front = 1.0 - smoothstep(0.30, 1.10, abs(angle));
        float farRidge = 0.050 + sin(angle * 3.7 + 0.6) * 0.012
                       + sin(angle * 9.3) * 0.008 + sin(angle * 18.2 + 2.0) * 0.003 + front * 0.080;
        float nearRidge = 0.021 + sin(angle * 6.1 + 1.8) * 0.007 + sin(angle * 14.0) * 0.003 + front * 0.030;
        float hills = 1.0 - smoothstep(farRidge - aa, farRidge + aa, height);
        float nearHills = 1.0 - smoothstep(nearRidge - aa, nearRidge + aa, height);

        float cell = floor(angle * 125.0);
        float across = fract(angle * 125.0);
        float buildingHeight = 0.013 + hash(cell) * 0.030 + front * 0.035;
        float buildings = step(0.13, across) * step(across, 0.88)
                        * (1.0 - smoothstep(buildingHeight - aa, buildingHeight + aa, height))
                        * smoothstep(0.001, 0.005, height);
        float opacity = max(hills, buildings);
        if (opacity < 0.01) discard;

        vec3 land = uLand * (0.12 + uDay * 0.88);
        vec3 distant = mix(uHorizon, land, 0.32 + front * 0.18);
        vec3 color = mix(distant, mix(land, uHorizon, 0.18), nearHills);
        vec3 ground = mix(land, uCityGround * (0.12 + uDay * 0.88), 1.0 - smoothstep(-151.0, -149.0, vWorld.z));
        color = mix(color, ground, 1.0 - smoothstep(0.0, 0.009, height));
        vec3 buildingsColor = uCity * (0.09 + uDay * 0.61) * (0.8 + hash(cell + 9.0) * 0.2);
        color = mix(color, buildingsColor, buildings);

        float windows = step(0.28, fract(across * 3.0)) * step(fract(across * 3.0), 0.63)
                      * step(0.22, fract(height * 1300.0)) * step(fract(height * 1300.0), 0.58);
        windows *= step(0.68, hash(cell + floor(height * 1300.0) * 11.0));
        color += vec3(0.27, 0.17, 0.065) * windows * buildings * (1.0 - uDay);

        // 측면에서 한강이 끝나는 높이는 수면과 같은 기본색으로 이어 붙인다.
        float river = smoothstep(-143.0, -140.0, vWorld.z) * (1.0 - smoothstep(-29.0, -26.0, vWorld.z));
        river *= 1.0 - smoothstep(0.0, 0.004, height);
        color = mix(color, mix(vec3(0.008, 0.02, 0.036), vec3(0.1175, 0.21, 0.225), uDay), river);
        vec3 skyEdge = uHorizon;
        if (uSunset > 0.0) skyEdge = sunsetSkyColor(skyEdge, normalize(vWorld), uSun, uSunset, uCover);
        color = mix(skyEdge, color, opacity);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `
  });
  // 불투명 재질과 상단 버리기를 사용해 유리의 투과 렌더에도 원경이 포함되게 한다.
  const bottom = groundY - 40, top = groundY + 95;
  const height = top - bottom;
  function panel(name, width, x, z, rotation) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name;
    mesh.position.set(x, (top + bottom) / 2, z);
    mesh.rotation.y = rotation;
    root.add(mesh);
  }
  panel('원경_후면판', BACKDROP.halfWidth * 2 + 2, 0, BACKDROP.backZ, 0);
  const depth = BACKDROP.frontZ - BACKDROP.backZ + 2;
  const centerZ = (BACKDROP.frontZ + BACKDROP.backZ) / 2;
  panel('원경_좌측판', depth, -BACKDROP.halfWidth, centerZ, Math.PI / 2);
  panel('원경_우측판', depth, BACKDROP.halfWidth, centerZ, -Math.PI / 2);
  return root;
}
