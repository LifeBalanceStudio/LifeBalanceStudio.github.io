import * as THREE from 'three';

export const PRECIPITATION = Object.freeze({ rain: 640, snow: 384, nearZ: -3.2, farZ: -48, floorY: -9.8, topY: 13 });
const kinds = ['rain', 'snow'];

export function precipitationLevels(weather) {
  const wet = ['rain', 'snow', 'sleet', 'storm'].includes(weather?.condition);
  if (!wet) return { rain: 0, snow: 0 };
  // 강수량이 없는 예보는 기호를 약하게 표현하며, 확인된 0mm는 내리지 않는 것으로 처리한다.
  const rate = weather.precipitationRate;
  const strength = typeof rate === 'number' && Number.isFinite(rate)
    ? rate <= 0 ? 0 : Math.min(1, 0.18 + Math.sqrt(rate / 6) * 0.82) : 0.3;
  return { rain: weather.condition === 'snow' ? 0 : strength * (weather.condition === 'sleet' ? 0.6 : 1),
    snow: ['snow', 'sleet'].includes(weather.condition) ? strength * (weather.condition === 'sleet' ? 0.65 : 1) : 0 };
}

export function createPrecipitation(dayUniform = { value: 1 }) {
  const root = new THREE.Group(); root.name = '창밖_비와_눈'; root.visible = false;
  const viewport = new THREE.Vector4();
  const wind = new THREE.Vector2();
  const time = { value: 0 };
  const levels = { rain: 0, snow: 0 }, target = { rain: 0, snow: 0 };
  const points = [];
  let enabled = true, reducedMotion = false;
  for (const kind of kinds) {
    const count = PRECIPITATION[kind], seeds = new Float32Array(count * 4);
    let random = kind === 'rain' ? 1709 : 2903;
    for (let i = 0; i < seeds.length; i++) { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; seeds[i] = random / 4294967296; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, -25.6), 45);
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uDay: dayUniform, uWind: { value: wind }, uDensity: { value: 0 }, uHeight: { value: 800 }, uSnow: { value: kind === 'snow' ? 1 : 0 } },
      depthWrite: true, depthTest: true,
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime, uDensity, uHeight, uSnow;
        uniform vec2 uWind;
        varying float vSnow, vShade;
        void main() {
          float fallSpeed = mix(10.0, 1.1, uSnow) * (0.85 + aSeed.w * 0.3);
          float phase = fract(aSeed.z + uTime * fallSpeed / 22.8);
          vec3 p = vec3(-28.0 + fract(aSeed.x + uTime * uWind.x / 56.0) * 56.0,
            13.0 - phase * 22.8, -48.0 + fract(aSeed.y + uTime * uWind.y / 44.8) * 44.8);
          p.x += sin(uTime * 0.75 + aSeed.z * 40.0) * uSnow * 0.16;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          if (aSeed.w > uDensity) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = clamp(mix(0.19, 0.075, uSnow) * uHeight * projectionMatrix[1][1] / max(0.1, -mv.z), 1.0, 22.0);
          vSnow = uSnow; vShade = 0.78 + aSeed.z * 0.22;
        }
      `,
      fragmentShader: `
        uniform float uDay;
        varying float vSnow, vShade;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          if (vSnow > 0.5) { if (dot(p, p) > 0.21) discard; }
          else { if (abs(p.x + p.y * 0.12) > 0.09 || abs(p.y) > 0.47) discard; }
          gl_FragColor = vec4(mix(vec3(0.22, 0.29, 0.38), vec3(0.72, 0.79, 0.83), uDay) * vShade * mix(1.0, 1.18, vSnow), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const mesh = new THREE.Points(geometry, material); mesh.name = kind === 'rain' ? '창밖_빗줄기' : '창밖_눈송이';
    // 프로브와 본 화면의 서로 다른 해상도에 맞춰 실제 투영 크기를 유지한다.
    mesh.onBeforeRender = renderer => { renderer.getCurrentViewport(viewport); material.uniforms.uHeight.value = viewport.w; };
    root.add(mesh); points.push(mesh);
  }
  function setWeather(weather) {
    Object.assign(target, precipitationLevels(weather));
    const speed = Math.min(8, Math.max(0, Number(weather?.windSpeed) || 0)) * 0.18;
    const angle = THREE.MathUtils.degToRad(Number(weather?.windFromDegrees) || 0);
    wind.set(Math.sin(angle) * speed, -Math.cos(angle) * speed);
  }
  function update(seconds, visible = true) {
    const dt = Math.max(0, Math.min(0.1, seconds));
    if (enabled && !reducedMotion && visible) time.value += dt;
    for (const kind of kinds) levels[kind] += (target[kind] - levels[kind]) * (1 - Math.exp(-dt / 2.5));
    points[0].material.uniforms.uDensity.value = levels.rain;
    points[1].material.uniforms.uDensity.value = levels.snow;
    points[0].visible = levels.rain > 0.005; points[1].visible = levels.snow > 0.005;
    root.visible = enabled && !reducedMotion && visible && (points[0].visible || points[1].visible);
  }
  return { root, setWeather, update,
    setEnabled(value) { enabled = Boolean(value); }, setReducedMotion(value) { reducedMotion = Boolean(value); },
    get state() { return { ...levels, target: { ...target }, visible: root.visible, time: time.value }; },
    dispose() { for (const mesh of points) { mesh.geometry.dispose(); mesh.material.dispose(); } } };
}
