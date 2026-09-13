import { MathUtils } from 'three';

export function sunsetStrength(sunDirection) {
  const altitude = MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunDirection.y, -1, 1)));
  const evening = MathUtils.smoothstep(sunDirection.x, 0.05, 0.25);
  const lowSun = 1 - MathUtils.smoothstep(altitude, 2, 12);
  const afterglow = MathUtils.smoothstep(altitude, -9, -1.5);
  return evening * lowSun * afterglow;
}

// 하늘과 원경판이 같은 방향·날씨 조건으로 물들도록 공통 색 함수를 사용한다.
export const SUNSET_GLSL = `
  float duskFacing(vec3 direction, vec3 sunDirection) {
    vec2 view = direction.xz / max(length(direction.xz), 0.0001);
    vec2 sun = sunDirection.xz / max(length(sunDirection.xz), 0.0001);
    return pow(clamp(dot(view, sun) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  }
  float duskTransmission(float cover) {
    return mix(1.0, 0.25, smoothstep(0.35, 1.0, cover));
  }
  vec3 sunsetSkyColor(vec3 base, vec3 direction, vec3 sun, float strength, float cover) {
    float lowerSky = 1.0 - smoothstep(0.0, 0.65, max(direction.y, 0.0));
    float glow = strength * duskTransmission(cover) * (0.13 + 0.87 * duskFacing(direction, sun)) * lowerSky;
    vec3 warm = mix(vec3(0.85, 0.20, 0.055), vec3(0.36, 0.12, 0.24), smoothstep(0.1, 0.48, direction.y));
    return mix(base, warm, min(0.8, glow * 0.9));
  }
`;
