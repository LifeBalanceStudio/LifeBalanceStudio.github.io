import * as THREE from 'three';

// Dylan Ebert의 텍셀 스플래팅을 참고한 WebGL 2 구현. 출처와 차이는 문서에 기록한다.
// 원저자 라이선스: ./vendor/texel-splatting/LICENSE
export const TEXEL_SPLAT = Object.freeze({ resolution: 384, gridStep: 0.25, transition: 0.18 });

const faces = [
  { direction: [1, 0, 0], up: [0, 1, 0] }, { direction: [-1, 0, 0], up: [0, 1, 0] },
  { direction: [0, 1, 0], up: [0, 0, -1] }, { direction: [0, -1, 0], up: [0, 0, 1] },
  { direction: [0, 0, 1], up: [0, 1, 0] }, { direction: [0, 0, -1], up: [0, 1, 0] },
];

export function snapProbePosition(position, target = new THREE.Vector3()) {
  const step = TEXEL_SPLAT.gridStep;
  return target.set(Math.round(position.x / step) * step, Math.round(position.y / step) * step, Math.round(position.z / step) * step);
}

const depthGLSL = `
  float viewDistance(float depth, vec2 range) {
    return range.x * range.y / (range.y - depth * (range.y - range.x));
  }
`;

const splatVertex = `
  uniform sampler2D probeColor;
  uniform sampler2D probeDepth;
  uniform mat3 faceRotation;
  uniform vec3 probeOrigin;
  uniform vec2 probeRange;
  uniform int resolution;
  uniform sampler2D eyeDepth;
  uniform vec2 eyeRange;
  uniform bool eyeProbe;
  flat out vec3 texelColor;
  ${depthGLSL}

  float halfWidth(ivec2 cell, ivec2 offset, float distance, float grazing) {
    ivec2 neighbour = clamp(cell + offset, ivec2(0), ivec2(resolution - 1));
    float nextDepth = texelFetch(probeDepth, neighbour, 0).r;
    float nextDistance = viewDistance(nextDepth, probeRange);
    bool sameSurface = nextDepth < 1.0 && abs(nextDistance - distance) / max(nextDistance, distance) < 0.002;
    // 비슷한 깊이끼리는 조금만 확장해 겹침을 줄이고, 단차에서는 틈을 메운다.
    return sameSurface ? 0.575 / float(resolution) + 0.0005 * grazing : 1.0 / float(resolution);
  }

  void main() {
    ivec2 cell = ivec2(gl_InstanceID % resolution, gl_InstanceID / resolution);
    float depth = texelFetch(probeDepth, cell, 0).r;
    texelColor = texelFetch(probeColor, cell, 0).rgb;
    if (depth >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float distance = viewDistance(depth, probeRange);
    vec2 uv = (vec2(cell) + 0.5) / float(resolution);
    vec3 centerRay = faceRotation * vec3(uv * 2.0 - 1.0, -1.0);
    vec3 centerWorld = probeOrigin + centerRay * distance;
    float footprint = 2.0 * distance / float(resolution);
    vec4 centerView = viewMatrix * vec4(centerWorld, 1.0);
    if (!eyeProbe) {
      vec4 centerClip = projectionMatrix * centerView;
      vec2 screenUV = centerClip.xy / centerClip.w * 0.5 + 0.5;
      if (centerClip.w <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      if (all(greaterThanEqual(screenUV, vec2(0.0))) && all(lessThanEqual(screenUV, vec2(1.0)))) {
        float visibleDistance = viewDistance(texture(eyeDepth, screenUV).r, eyeRange);
        // 가려진 중심은 사각형 전체를 제외한다. 매 픽셀을 잘라 매끈한 원본 화면을 드러내지 않는다.
        if (abs(visibleDistance + centerView.z) > max(0.002, footprint)) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
      }
    }
    vec3 faceNormal = faceRotation * vec3(0.0, 0.0, -1.0);
    float cosine = max(abs(dot(normalize(centerWorld - cameraPosition), faceNormal)), 0.14);
    float grazing = sqrt(max(0.0, 1.0 - cosine * cosine)) / cosine;
    float widthX = halfWidth(cell, ivec2(position.x < 0.0 ? -1 : 1, 0), distance, grazing);
    float widthY = halfWidth(cell, ivec2(0, position.y < 0.0 ? -1 : 1), distance, grazing);
    vec2 cornerUV = uv + sign(position.xy) * vec2(widthX, widthY);
    vec3 ray = faceRotation * vec3(cornerUV * 2.0 - 1.0, -1.0);
    // 중심 텍셀의 깊이로 네 모서리를 복원한다. 화면 격자가 아닌 월드 공간의 사각형이다.
    ray /= max(abs(ray.x), max(abs(ray.y), abs(ray.z)));
    vec3 world = probeOrigin + ray * distance;
    vec4 viewPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    if (eyeProbe && viewPosition.z < 0.0) {
      // 눈 위치 프로브는 빈 곳을 메운다. 원거리 깊이가 뭉개지지 않도록 공간 크기에 비례해 뒤로 민다.
      float biasedDistance = -viewPosition.z + max(0.002, footprint * 4.0);
      float biasedDepth = eyeRange.y * (biasedDistance - eyeRange.x) / (biasedDistance * (eyeRange.y - eyeRange.x));
      gl_Position.z = (2.0 * biasedDepth - 1.0) * gl_Position.w;
    }
    // 동일 평면의 겹친 텍셀이 프레임마다 우선순위를 바꾸지 않도록 고정된 미세 편향을 준다.
    uint hash = uint(gl_InstanceID) * 2654435761u;
    gl_Position.z += float(hash >> 24u) * 1e-9 * gl_Position.w;
    gl_Position.z = min(gl_Position.z, gl_Position.w);
  }
`;

const splatFragment = `
  layout(location = 0) out highp vec4 splatColor;
  #define gl_FragColor splatColor
  uniform float transition;
  uniform bool previous;
  uniform bool eyeProbe;
  flat in vec3 texelColor;

  float threshold4(ivec2 point) {
    const float values[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    return (values[(point.y % 4) * 4 + point.x % 4] + 0.5) / 16.0;
  }

  void main() {
    float threshold = threshold4(ivec2(gl_FragCoord.xy));
    if (!eyeProbe && (previous ? threshold < transition : threshold >= transition)) discard;
    gl_FragColor = vec4(texelColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createTexelSplatRenderer(renderer, scene, camera) {
  // 반정밀도 색 버퍼가 없으면 기존 렌더링을 유지한다. WebGPU는 사용하지 않는다.
  const supported = renderer.extensions.has('EXT_color_buffer_float');
  let enabled = supported;
  let dirty = true;
  let changedAt = -Infinity;
  let captureCount = 0;
  let eyeCaptureCount = 0;
  let frame = 0;
  let current = 0;
  const size = new THREE.Vector2(1, 1);
  const nextOrigin = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const range = new THREE.Vector2(camera.near, camera.far);
  const captureHidden = [];
  const sharpObjects = [];
  const sharpScene = new THREE.Scene();
  const splatScene = new THREE.Scene();
  const { resolution } = TEXEL_SPLAT;

  function target(width, height) {
    const result = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    });
    result.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    result.depthTexture.compareFunction = null;
    return result;
  }

  const eye = target(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.instanceCount = resolution * resolution;
  const probes = Array.from({ length: 3 }, (_, index) => {
    const origin = new THREE.Vector3();
    const group = new THREE.Group();
    group.visible = false;
    splatScene.add(group);
    return {
      origin, group, valid: false, eye: index === 2,
      faces: faces.map(face => {
        const view = new THREE.PerspectiveCamera(90, 1, camera.near, camera.far);
        view.up.fromArray(face.up);
        view.lookAt(new THREE.Vector3().fromArray(face.direction));
        view.updateMatrixWorld(true);
        const buffer = target(resolution, resolution);
        const material = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3, vertexShader: splatVertex, fragmentShader: splatFragment,
          side: THREE.DoubleSide,
          uniforms: {
            probeColor: { value: buffer.texture }, probeDepth: { value: buffer.depthTexture },
            faceRotation: { value: new THREE.Matrix3().setFromMatrix4(view.matrixWorld) },
            probeOrigin: { value: origin }, probeRange: { value: range }, resolution: { value: resolution },
            eyeDepth: { value: eye.depthTexture }, eyeRange: { value: range },
            transition: { value: 1 }, previous: { value: false }, eyeProbe: { value: index === 2 },
          },
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = index === 2 ? 0 : 1;
        group.add(mesh);
        return { view, buffer, material, mesh, valid: false };
      }),
    };
  });

  const baseScene = new THREE.Scene();
  const baseCamera = new THREE.Camera();
  const baseGeometry = new THREE.PlaneGeometry(2, 2);
  const baseUniforms = {
    inverseProjection: { value: camera.projectionMatrixInverse },
    cameraRotation: { value: new THREE.Matrix3() },
  };
  for (const [index, face] of probes[2].faces.entries()) {
    baseUniforms['cube' + index] = { value: face.buffer.texture };
    baseUniforms['rotation' + index] = face.material.uniforms.faceRotation;
  }
  const baseMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: baseUniforms,
    vertexShader: 'varying vec2 texUV; void main() { texUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform mat4 inverseProjection;
      uniform mat3 cameraRotation;
      varying vec2 texUV;
      ${faces.map((_, i) => `
        uniform sampler2D cube${i};
        uniform mat3 rotation${i};
        vec4 face${i}(vec3 ray) {
          vec3 localRay = transpose(rotation${i}) * ray;
          return texture2D(cube${i}, localRay.xy / -localRay.z * 0.5 + 0.5);
        }
      `).join('\n')}
      void main() {
        vec3 ray = cameraRotation * (inverseProjection * vec4(texUV * 2.0 - 1.0, 1.0, 1.0)).xyz;
        vec3 axis = abs(ray);
        // 빈 곳과 하늘도 눈 위치 큐브 텍셀로 채운다. 일반 원근 화면의 색은 합성하지 않는다.
        if (axis.x >= max(axis.y, axis.z)) gl_FragColor = ray.x >= 0.0 ? face0(ray) : face1(ray);
        else if (axis.y >= axis.z) gl_FragColor = ray.y >= 0.0 ? face2(ray) : face3(ray);
        else gl_FragColor = ray.z >= 0.0 ? face4(ray) : face5(ray);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.frustumCulled = false;
  baseScene.add(base);

  function bindScene(objects = []) {
    captureHidden.length = 0;
    for (const item of sharpObjects) item.mesh.material.dispose();
    sharpObjects.length = 0;
    sharpScene.clear();
    scene.traverse(object => {
      if (!object.isMesh) return;
      const material = Array.isArray(object.material) ? object.material.find(item => item.transmission > 0) : object.material;
      if (material?.transmission > 0) {
        // 굴절로 섞인 색에는 한 점의 깊이를 붙일 수 없다. 맑은 유리는 옅은 색조로 나중에 합성한다.
        captureHidden.push({ original: object, visible: object.visible });
        addSharp(object, new THREE.MeshBasicMaterial({ color: material.color, transparent: true, opacity: 0.025, side: material.side, toneMapped: false }));
      }
    });
    for (const original of objects) addSharp(original, original.material.clone());
    dirty = true;
  }

  function addSharp(original, material) {
    material.depthTest = false;
    material.depthWrite = false;
    material.onBeforeCompile = shader => {
      shader.uniforms.splatEyeDepth = { value: eye.depthTexture };
      shader.uniforms.splatEyeSize = { value: size };
      shader.fragmentShader = 'uniform sampler2D splatEyeDepth; uniform vec2 splatEyeSize;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        if (gl_FragCoord.z > texture2D(splatEyeDepth, gl_FragCoord.xy / splatEyeSize).r + 0.000002) discard;
      `);
    };
    const mesh = new THREE.Mesh(original.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    sharpObjects.push({ original, mesh });
    sharpScene.add(mesh);
  }

  function capture(probe, mask) {
    for (const [index, face] of probe.faces.entries()) {
      if (!(mask & (1 << index))) continue;
      face.view.position.copy(probe.origin);
      renderer.setRenderTarget(face.buffer);
      renderer.render(scene, face.view);
      face.valid = true;
    }
    probe.valid = true;
    if (probe.eye) eyeCaptureCount++;
    else captureCount++;
  }

  function render(time) {
    if (!enabled) { renderer.render(scene, camera); return; }
    const savedTarget = renderer.getRenderTarget();
    const savedAutoClear = renderer.autoClear;
    const savedShadowUpdate = renderer.shadowMap.autoUpdate;
    try {
      for (const item of captureHidden) { item.visible = item.original.visible; item.original.visible = false; }
      renderer.autoClear = true;
      renderer.setRenderTarget(eye);
      renderer.render(scene, camera);
      renderer.shadowMap.autoUpdate = false;
      camera.getWorldDirection(forward);
      const halfDiagonal = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.sqrt(1 + camera.aspect ** 2));
      const threshold = Math.cos(Math.min(Math.PI, halfDiagonal + Math.atan(Math.SQRT2) + 0.12));
      let mask = 0;
      for (const [index, face] of faces.entries()) {
        const [x, y, z] = face.direction;
        if (forward.x * x + forward.y * y + forward.z * z >= threshold) mask |= 1 << index;
      }
      // 원본의 눈·고정 격자·이전 격자 프로브 구성을 따른다. 눈 위치는 매 프레임 새로 캡처한다.
      probes[2].origin.copy(camera.position);
      capture(probes[2], mask);
      snapProbePosition(camera.position, nextOrigin);
      let transition = Math.min(1, Math.max(0, (time - changedAt) / TEXEL_SPLAT.transition));
      let moved = false;
      if (!probes[current].valid) {
        probes[current].origin.copy(nextOrigin);
        moved = true;
      } else if (transition === 1 && !probes[current].origin.equals(nextOrigin)) {
        current = 1 - current;
        probes[current].origin.copy(nextOrigin);
        for (const face of probes[current].faces) face.valid = false;
        changedAt = time;
        transition = 0;
        moved = true;
      }
      // 전환 중에는 두 고정 프로브를 번갈아 갱신해 조명·수면·블라인드가 함께 따라오게 한다.
      const refreshed = moved || dirty || transition === 1 || frame % 2 === 0 ? current : 1 - current;
      capture(probes[refreshed], mask);
      dirty = false;
      frame++;
      probes.forEach((probe, index) => {
        probe.group.visible = probe.valid && (probe.eye || index === current || transition < 1);
        for (const [faceIndex, face] of probe.faces.entries()) {
          face.mesh.visible = face.valid && Boolean(mask & (1 << faceIndex));
          face.material.uniforms.transition.value = transition;
          face.material.uniforms.previous.value = !probe.eye && index !== current;
        }
      });
      baseUniforms.cameraRotation.value.setFromMatrix4(camera.matrixWorld);
      renderer.setRenderTarget(savedTarget);
      renderer.clear();
      renderer.autoClear = false;
      renderer.render(baseScene, baseCamera);
      renderer.render(splatScene, camera);
      for (const item of captureHidden) item.original.visible = item.visible;
      for (const item of sharpObjects) {
        item.mesh.matrix.copy(item.original.matrixWorld);
        item.mesh.visible = item.original.visible;
      }
      if (sharpObjects.length) renderer.render(sharpScene, camera);
    } finally {
      for (const item of captureHidden) item.original.visible = item.visible;
      renderer.autoClear = savedAutoClear;
      renderer.shadowMap.autoUpdate = savedShadowUpdate;
      renderer.setRenderTarget(savedTarget);
    }
  }

  return {
    supported, render, bindScene,
    invalidate() { dirty = true; },
    setEnabled(value) { enabled = supported && value; dirty = true; },
    resize() { renderer.getDrawingBufferSize(size); eye.setSize(Math.max(1, size.x), Math.max(1, size.y)); },
    get state() { return { enabled, resolution, origin: probes[current].origin.toArray(), captureCount, eyeCaptureCount, probeCount: probes.length }; },
    dispose() {
      eye.dispose(); geometry.dispose(); baseGeometry.dispose(); baseMaterial.dispose();
      for (const probe of probes) for (const face of probe.faces) { face.buffer.dispose(); face.material.dispose(); }
      for (const item of sharpObjects) item.mesh.material.dispose();
    },
  };
}
