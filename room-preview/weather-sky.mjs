import * as THREE from 'three';
import { getPosition, getMoonIllumination } from './vendor/suncalc/index.js';
import { DEFAULT_WEATHER } from './seoul-weather.mjs';
import { seoulDaylight } from './mood-light.mjs';
import { sunsetStrength, SUNSET_GLSL } from './sunset.mjs';

function skyDirection(position, target) {
  // SunCalc 2는 북쪽 0°, 동쪽 90°의 도 단위다. 방은 남쪽(-Z)을 바라보며 동쪽은 -X다.
  const azimuth = THREE.MathUtils.degToRad(position.azimuth);
  const altitude = THREE.MathUtils.degToRad(position.altitude);
  return target.set(-Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), Math.cos(azimuth) * Math.cos(altitude)).normalize();
}

export function seoulSunDirection(date, target = new THREE.Vector3()) {
  return skyDirection(getPosition(date, 37.5665, 126.9780), target);
}

export function seoulMoonState(date, target = new THREE.Vector3()) {
  const illumination = getMoonIllumination(date), today = seoulDaylight(date), time = date.getTime();
  if (time >= today.sunrise && time < today.sunset) target.set(0, -1, 0);
  else {
    // 달은 밤 동안 동쪽 앞에서 서쪽 앞으로 이동한다. 자정에도 같은 밤을 이어 간다.
    const beforeSunrise = time < today.sunrise;
    const sunset = beforeSunrise ? seoulDaylight(new Date(time - 86400000)).sunset : today.sunset;
    const nextSunrise = beforeSunrise ? today.sunrise : seoulDaylight(new Date(time + 86400000)).sunrise;
    const progress = THREE.MathUtils.clamp((time - sunset) / (nextSunrise - sunset), 0, 1);
    // 창가에서 창틀·천장을 피하도록 정면 기준 좌우 60°, 고도 12~48°의 호를 사용한다.
    const side = THREE.MathUtils.degToRad(-60 + 120 * progress);
    const altitude = THREE.MathUtils.degToRad(12 + 36 * Math.sin(Math.PI * progress));
    target.set(Math.sin(side) * Math.cos(altitude), Math.sin(altitude), -Math.cos(side) * Math.cos(altitude));
  }
  return { direction: target, fraction: illumination.fraction, phase: illumination.phase, waxing: illumination.waxing };
}

export function createWeatherSky(top, horizon) {
  const uniforms = {
    uTop: { value: top }, uHorizon: { value: horizon }, uSun: { value: new THREE.Vector3() },
    uSunset: { value: 0 },
    uMoon: { value: new THREE.Vector3(0, -1, 0) }, uMoonRight: { value: new THREE.Vector3(1, 0, 0) },
    uMoonUp: { value: new THREE.Vector3(0, 1, 0) }, uMoonLight: { value: new THREE.Vector3(0, 0, -1) }, uMoonFraction: { value: 0 },
    uDay: { value: 0 }, uStars: { value: 1 }, uCover: { value: DEFAULT_WEATHER.cloudCover }, uCloudShift: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: 'varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      ${SUNSET_GLSL}
      varying vec3 vDirection;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform float uSunset;
      uniform vec3 uMoon;
      uniform vec3 uMoonRight;
      uniform vec3 uMoonUp;
      uniform vec3 uMoonLight;
      uniform float uMoonFraction;
      uniform float uDay;
      uniform float uStars;
      uniform float uCover;
      uniform vec2 uCloudShift;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 cell = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
                   mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
      }
      float cloudNoise(vec2 p) {
        return noise(p) * 0.57 + noise(p * 2.07 + 17.0) * 0.28 + noise(p * 4.13 + 31.0) * 0.15;
      }
      vec3 stars(vec3 direction) {
        float latitude = asin(clamp(direction.y, -1.0, 1.0));
        vec2 grid = vec2(atan(direction.x, direction.z) / 6.2831853 + 0.5, latitude / 3.1415927 + 0.5) * vec2(120.0, 60.0);
        vec2 cell = floor(grid);
        float seed = hash(cell);
        vec2 center = 0.28 + 0.44 * vec2(hash(cell + 13.7), hash(cell + 71.3));
        vec2 delta = (fract(grid) - center) * vec2(max(cos(latitude), 0.35), 1.0);
        float distance = length(delta), radius = mix(0.025, 0.063, fract(seed * 17.7));
        // 셀 경계에서 불연속인 해시 거리 대신 연속적인 시선 방향으로 픽셀 폭을 계산한다.
        float aa = clamp(max(length(dFdx(direction)), length(dFdy(direction))) * 19.0986, 0.004, 0.035);
        float point = 1.0 - smoothstep(radius - aa, radius + aa, distance);
        float visible = step(0.88, seed) * smoothstep(0.03, 0.28, direction.y);
        vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.89, 0.72), fract(seed * 37.0));
        // 시간과 바람을 사용하지 않는 고정 별 배치다. 별자리를 재현한 지도는 아니다.
        return tint * point * visible * (0.55 + 0.9 * fract(seed * 23.0));
      }
      void main() {
        vec3 direction = normalize(vDirection);
        float height = smoothstep(0.0, 0.62, direction.y);
        vec3 background = mix(uHorizon, uTop, height);
        if (uSunset > 0.0) background = sunsetSkyColor(background, direction, uSun, uSunset, uCover);
        vec3 color = background;
        float celestialVisibility = 1.0 - smoothstep(0.9, 1.0, uCover);
        if (uStars > 0.0 && celestialVisibility > 0.0) color += stars(direction) * uStars * celestialVisibility;
        float sunAngle = dot(direction, uSun);
        float sunVisible = smoothstep(-0.025, 0.025, uSun.y);
        // 실제 각크기보다 창가에서의 식별을 우선한 약 4.8° 지름의 태양이다.
        float sun = smoothstep(0.99892015, 0.99928006, sunAngle) * sunVisible;
        float halo = pow(max(sunAngle, 0.0), 70.0) * 0.22 * sunVisible;
        vec3 sunColor = mix(vec3(1.0, 0.37, 0.10), vec3(1.0, 0.91, 0.68), smoothstep(0.0, 0.35, uSun.y));
        color += sunColor * (sun * 3.8 + halo) * (1.0 - smoothstep(0.8, 1.0, uCover));

        float moonAngle = dot(direction, uMoon);
        // 일출·일몰에서 uDay는 0.5다. 낮에는 달과 광륜을 숨기고 밤 쪽에서만 부드럽게 표시한다.
        float moonNight = 1.0 - smoothstep(0.0, 0.5, uDay);
        float moonVisible = smoothstep(-0.025, 0.025, uMoon.y) * smoothstep(-0.005, 0.012, direction.y) * celestialVisibility * moonNight;
        vec3 moonHalo = vec3(0.43, 0.52, 0.65) * pow(max(moonAngle, 0.0), 162.5) * uMoonFraction * moonVisible * (1.0 - uDay) * 0.055;
        color += moonHalo;
        if (moonAngle > 0.998 && moonVisible > 0.0) {
          // 약 5.6° 지름의 연출용 달이다. 날짜별 밝은 면의 비율로 초승·보름·그믐을 표현한다.
          vec2 p = vec2(dot(direction, uMoonRight), dot(direction, uMoonUp)) / 0.04885;
          float radius2 = dot(p, p);
          float edge = max(fwidth(radius2), 0.004);
          float disc = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, radius2)) * moonVisible;
          vec3 normal = vec3(p, sqrt(max(0.0, 1.0 - radius2)));
          float light = dot(normal, uMoonLight);
          float terminator = max(fwidth(light), 0.008);
          float litSide = smoothstep(-terminator, terminator, light);
          float surface = 0.88 + 0.12 * noise(p * 5.7 + 18.0) - 0.10 * smoothstep(0.43, 0.72, noise(p * 2.8 + 4.0));
          vec3 moonColor = vec3(0.73, 0.80, 0.88) * surface * mix(1.55, 0.68, uDay) * (0.62 + 0.38 * sqrt(max(light, 0.0)));
          // 달의 어두운 면 뒤에 있는 별도 가린다. 어두운 면은 해당 방향의 하늘색에 맞춘다.
          color = mix(color, mix(background + moonHalo, moonColor, litSide), disc);
        }

        vec2 cloudPosition = direction.xz / max(direction.y, 0.055) * 2.4 - uCloudShift;
        float density = cloudNoise(cloudPosition);
        float threshold = mix(0.82, 0.24, uCover);
        float cloud = smoothstep(threshold - 0.06, threshold + 0.12, density);
        cloud = mix(cloud, 1.0, smoothstep(0.85, 1.0, uCover));
        cloud *= smoothstep(0.0, 0.08, uCover) * smoothstep(0.015, 0.18, direction.y);
        float thickness = smoothstep(threshold, threshold + 0.30, density);
        vec3 shade = mix(vec3(0.015, 0.025, 0.048), vec3(0.34, 0.40, 0.44), uDay);
        vec3 lit = mix(vec3(0.055, 0.075, 0.12), vec3(0.91, 0.93, 0.91), uDay);
        vec3 cloudColor = mix(shade, lit, 0.3 + 0.7 * thickness);
        if (uSunset > 0.0 && cloud > 0.0) {
          float facing = 0.20 + 0.80 * duskFacing(direction, uSun);
          float warmth = uSunset * duskTransmission(uCover) * facing * (1.0 - smoothstep(0.10, 0.75, direction.y));
          vec3 duskCloud = mix(vec3(0.25, 0.105, 0.14), vec3(0.80, 0.29, 0.11), 1.0 - thickness * 0.75);
          cloudColor = mix(cloudColor, duskCloud, warmth * 0.8);
          cloudColor += vec3(1.0, 0.42, 0.12) * warmth * (1.0 - thickness) * 0.1;
        }
        // 같은 구름 분포를 마지막에 겹쳐 해·달·별을 해당 위치의 구름으로 가린다.
        color = mix(color, cloudColor, cloud);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), material);
  mesh.name = '창밖_하늘';
  let weather = DEFAULT_WEATHER;
  let targetCover = weather.cloudCover;
  const wind = new THREE.Vector2();
  const up = new THREE.Vector3(0, 1, 0);
  let moonPhase = 0;
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function setWeather(next) {
    weather = next;
    targetCover = Math.max(next.cloudCover, ['rain', 'snow', 'sleet', 'storm', 'fog'].includes(next.condition) ? 0.72 : 0);
    const angle = THREE.MathUtils.degToRad(next.windFromDegrees);
    // 기상 자료의 바람은 불어오는 방향이므로 구름은 그 반대쪽으로 흐른다.
    wind.set(Math.sin(angle), -Math.cos(angle)).multiplyScalar(Math.min(8, Math.max(0, next.windSpeed)) * 0.002);
  }
  setWeather(weather);
  return {
    mesh, setWeather,
    setTime(date, lighting) {
      seoulSunDirection(date, uniforms.uSun.value); uniforms.uDay.value = lighting.day; uniforms.uStars.value = Math.pow(1 - lighting.day, 3);
      uniforms.uSunset.value = sunsetStrength(uniforms.uSun.value);
      const moon = seoulMoonState(date, uniforms.uMoon.value);
      moonPhase = moon.phase; uniforms.uMoonFraction.value = moon.fraction;
      const right = uniforms.uMoonRight.value.crossVectors(moon.direction, up);
      if (right.lengthSq() < 0.000001) right.set(1, 0, 0);
      right.normalize(); uniforms.uMoonUp.value.crossVectors(right, moon.direction).normalize();
      // 연출 궤도에서는 실제 태양과의 각도 대신 차고 기우는 방향을 사용해 밝은 면의 뒤집힘을 막는다.
      const z = 2 * moon.fraction - 1, tangent = Math.sqrt(Math.max(0, 1 - z * z));
      uniforms.uMoonLight.value.set(moon.waxing ? tangent : -tangent, 0, z);
    },
    update(seconds) {
      const dt = Math.max(0, seconds);
      uniforms.uCover.value = THREE.MathUtils.lerp(uniforms.uCover.value, targetCover, 1 - Math.exp(-dt / 2));
      if (!reducedMotion?.matches) uniforms.uCloudShift.value.addScaledVector(wind, dt);
    },
    get state() { return { cloudCover: uniforms.uCover.value, targetCover, sunDirection: uniforms.uSun.value.toArray(), sunsetStrength: uniforms.uSunset.value, moonDirection: uniforms.uMoon.value.toArray(), moonPhase, moonIlluminatedFraction: uniforms.uMoonFraction.value, wind: wind.toArray() }; },
  };
}
