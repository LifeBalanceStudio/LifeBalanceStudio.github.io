import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const files = ['index.html', 'styles.css', 'app.mjs', 'world.mjs', 'portfolio.mjs', 'unity-demo.mjs', 'unity-player.html', 'assets/room.glb', 'assets/uncap.png', 'assets/fastpop.png', 'assets/pachipachi.png', 'assets/questionmark.png', 'assets/fonts/Galmuri11.woff2', 'assets/fonts/PressStart2P-Regular.ttf', 'assets/fonts/OFL-Galmuri.txt', 'vendor/texel-splatting/LICENSE'];
const ownModules = ['app.mjs', 'world.mjs', 'portfolio.mjs', 'outline.mjs', 'mood-light.mjs', 'exterior.mjs', 'backdrop.mjs', 'city-layout.mjs', 'texel-splat.mjs', 'seoul-weather.mjs', 'weather-sky.mjs', 'sunset.mjs', 'street-life.mjs', 'server.mjs', 'scripts/vendor.mjs', 'scripts/check-texel-webgl.mjs', 'scripts/check-weather-webgl.mjs', 'scripts/check-street-life.mjs', 'scripts/check-park-layout.mjs', 'scripts/check-celestial-sky.mjs', 'scripts/check-sky-performance.mjs', 'scripts/check-sunset-colors.mjs'];
ownModules.push('unity-demo.mjs', 'scripts/check-unity-demo.mjs');
ownModules.push('seoul-traffic.mjs', 'traffic-proxy.mjs', 'traffic-flow.mjs', 'precipitation.mjs', 'static-batch.mjs', 'ceiling-light.mjs', 'review-mode.mjs', 'scripts/check-completion.mjs', 'scripts/check-resilience.mjs', 'scripts/check-static-origin.mjs', 'scripts/verify-site.mjs', 'scripts/check-review-mode.mjs');
ownModules.push('scripts/check-portfolio-detail.mjs');
ownModules.push('scripts/check-interaction-controls.mjs');
for (const file of ownModules) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(file + ': ' + result.stderr);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const app = fs.readFileSync(path.join(root, 'app.mjs'), 'utf8');
for (const match of app.matchAll(/\$\('#([^']+)'\)/g)) if (!ids.has(match[1])) failures.push('HTML 대상 누락: ' + match[1]);
const checked = new Set();
function inspectImports(file) {
  if (checked.has(file)) return;
  checked.add(file);
  if (!fs.existsSync(path.join(root, file))) { failures.push('모듈 누락: ' + file); return; }
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const pattern = /^(?:import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)|export\s+\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    const target = specifier === 'three' ? 'vendor/three/build/three.module.js' : specifier.startsWith('three/addons/') ? 'vendor/three/examples/jsm/' + specifier.slice(13) : path.posix.join(path.posix.dirname(file), specifier);
    inspectImports(target);
  }
}
inspectImports('app.mjs');
for (const module of checked) if (!files.includes(module)) files.push(module);
const model = fs.readFileSync(path.join(root, 'assets/room.glb'));
const original = fs.readFileSync(path.join(root, '../modeling/output/room.glb'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (hash(model) !== hash(original)) failures.push('웹 모델 사본이 모델링 원본과 다릅니다.');
const http = [];
if (process.argv[2]) {
  for (const file of files) {
    const response = await fetch(new URL(file === 'index.html' ? './' : file, process.argv[2]));
    const served = Buffer.from(await response.arrayBuffer());
    const expected = fs.readFileSync(path.join(root, file));
    http.push({ 파일: file, 상태: response.status, 바이트: served.length });
    if (!response.ok || hash(served) !== hash(expected)) failures.push('HTTP 파일 응답 오류: ' + file);
  }
}
const report = { 통과: failures.length === 0, 오류: failures, 모듈수: checked.size, 모델_SHA256: hash(model), HTTP: http, 검증범위: '모듈 참조·문법·HTML 대상·자산 사본·HTTP 응답. 실제 브라우저 실행 검사는 미수행.' };
fs.writeFileSync(path.join(root, 'static-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
