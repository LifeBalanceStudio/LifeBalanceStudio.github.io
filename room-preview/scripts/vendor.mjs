import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = path.join(root, 'node_modules/three');
for (const file of ['RectAreaLightUniformsLib.js', 'RectAreaLightTexturesLib.js']) {
  const target = path.join(root, 'vendor/three/examples/jsm/lights', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(library, 'examples/jsm/lights', file), target);
}
for (const file of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/postprocessing/OutlinePass.js', 'examples/jsm/postprocessing/Pass.js', 'examples/jsm/shaders/CopyShader.js', 'LICENSE']) {
  const target = path.join(root, 'vendor/three', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(library, file), target);
}
const assets = path.join(root, 'assets');
fs.mkdirSync(path.join(root, 'vendor/suncalc'), { recursive: true });
for (const file of ['index.js', 'LICENSE']) {
  fs.copyFileSync(path.join(root, 'node_modules/suncalc', file), path.join(root, 'vendor/suncalc', file));
}
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(path.join(assets, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/galmuri/dist/Galmuri11.woff2'), path.join(assets, 'fonts/Galmuri11.woff2'));
fs.copyFileSync(path.join(root, 'node_modules/galmuri/ofl.md'), path.join(assets, 'fonts/OFL-Galmuri.txt'));
fs.copyFileSync(path.join(root, '../modeling/output/room.glb'), path.join(assets, 'room.glb'));
for (const file of ['uncap.png', 'fastpop.png', 'pachipachi.png', 'questionmark.png']) {
  fs.copyFileSync(path.join(root, '../img', file), path.join(assets, file));
}
console.log('고정 버전 라이브러리와 모델·이미지 사본을 준비했습니다.');
