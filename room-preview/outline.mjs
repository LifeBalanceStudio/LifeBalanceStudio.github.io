import { NormalBlending, UnsignedByteType, Vector2, Vector3 } from 'three';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

export function outlinePulse(seconds, reducedMotion = false) {
  const wave = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(seconds * Math.PI * 2 / 1.6);
  return { opacity: 0.76 + 0.24 * wave, glow: 0.24 + 0.40 * wave };
}

export function createInteractionOutline(renderer, scene, camera) {
  const pass = new OutlinePass(new Vector2(1, 1), scene, camera);
  pass.visibleEdgeColor.set('#ffffff');
  pass.hiddenEdgeColor.set('#000000');
  pass.edgeStrength = 4;
  pass.edgeGlow = 0.4;
  pass.edgeThickness = 1.75;
  pass.pulsePeriod = 0;
  pass.downSampleRatio = 1;
  pass.renderToScreen = false;

  // 흰 마스크의 테두리 양과 표시 색을 분리한다. 밝은 배경에서도 색이 씻기지 않도록
  // 더하기 합성 대신 알파 합성을 쓰며, 검은 숨은 테두리는 투명하게 처리한다.
  pass.overlayMaterial.blending = NormalBlending;
  pass.overlayMaterial.uniforms.outlineTint = { value: new Vector3(0, 1, 170 / 255) };
  pass.overlayMaterial.uniforms.outlineOpacity = { value: 1 };
  pass.overlayMaterial.fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D maskTexture;
    uniform sampler2D edgeTexture1;
    uniform sampler2D edgeTexture2;
    uniform float edgeStrength;
    uniform float edgeGlow;
    uniform vec3 outlineTint;
    uniform float outlineOpacity;
    void main() {
      float mask = texture2D(maskTexture, vUv).r;
      float edge = texture2D(edgeTexture1, vUv).r;
      float halo = texture2D(edgeTexture2, vUv).r;
      float coverage = clamp(edgeStrength * mask * (edge + halo * edgeGlow), 0.0, 1.0);
      gl_FragColor = vec4(outlineTint, coverage * outlineOpacity);
    }
  `;
  pass.overlayMaterial.needsUpdate = true;

  // 마스크와 깊이는 정규화된 값이므로 부동소수점 렌더 타깃을 요구하지 않는다.
  for (const target of [pass.renderTargetMaskBuffer, pass.renderTargetDepthBuffer, pass.renderTargetMaskDownSampleBuffer, pass.renderTargetBlurBuffer1, pass.renderTargetBlurBuffer2, pass.renderTargetEdgeBuffer1, pass.renderTargetEdgeBuffer2]) {
    target.texture.type = UnsignedByteType;
  }

  let mode = 'loading';
  let objects = [];
  let elapsed = 0;
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const syncSelection = () => { pass.selectedObjects = ['ready', 'explore', 'paused'].includes(mode) ? objects : []; };
  return {
    setTargets(targets) {
      objects = [...new Set(targets.flatMap(target => target.outlineObjects || []))];
      syncSelection();
    },
    setMode(next) {
      mode = next;
      syncSelection();
    },
    resize(width, height) {
      // 기본 화면 해상도는 유지하고 선택 마스크의 최대 크기만 제한한다.
      const scale = Math.min(1, 1280 / Math.max(width, height));
      pass.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    },
    render(seconds) {
      if (!pass.selectedObjects.length) return;
      elapsed += Math.max(0, seconds);
      const pulse = outlinePulse(elapsed, motionQuery?.matches);
      pass.overlayMaterial.uniforms.outlineOpacity.value = pulse.opacity;
      pass.edgeGlow = pulse.glow;
      const target = renderer.getRenderTarget();
      const autoUpdate = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      try {
        // 고정한 Three.js 0.186.0의 추가 합성 경로를 사용한다.
        // 기본 화면을 다시 복사하거나 톤 매핑하지 않고 테두리만 현재 타깃에 합성한다.
        pass.render(renderer, null, target, seconds, false);
      } finally {
        renderer.shadowMap.autoUpdate = autoUpdate;
        renderer.setRenderTarget(target);
      }
    },
    dispose() { pass.dispose(); },
    get selectedObjects() { return pass.selectedObjects; }
  };
}
