import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/completion-2026-09-12');
const base = process.argv[2];
const files = new Set(['index.html', 'site.css', 'classic.html', 'index_v2.html', 'app-ads.txt', '.nojekyll', 'room-preview/index.html', 'room-preview/styles.css', 'room-preview/vendor/three/LICENSE', 'room-preview/vendor/suncalc/LICENSE', 'room-preview/vendor/texel-splatting/LICENSE', 'room-preview/assets/fonts/OFL-Galmuri.txt']);
const modules = new Set(), failures = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function collect(directory) {
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (item.name.startsWith('.') || /\.md$/i.test(item.name)) continue;
    const relative = path.posix.join(directory, item.name);
    if (item.isDirectory()) collect(relative); else files.add(relative);
  }
}
collect('img'); collect('room-preview/assets'); collect('games/fastpop_webgl');
files.add('room-preview/unity-player.html');
function inspect(file) {
  if (modules.has(file)) return;
  modules.add(file); files.add(file);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const imports = /^(?:import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)|export\s+(?:\{[^}]*\}|\*))\s+from\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(imports)) {
    const specifier = match[1];
    const target = specifier === 'three' ? 'room-preview/vendor/three/build/three.module.js'
      : specifier.startsWith('three/addons/') ? 'room-preview/vendor/three/examples/jsm/' + specifier.slice(13)
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    if (target.startsWith('../')) { failures.push('프로젝트 밖 참조: ' + target); continue; }
    inspect(target);
  }
}
inspect('room-preview/app.mjs');
const original = JSON.parse(fs.readFileSync(path.join(output, 'before/hashes.json'), 'utf8'));
const preserved = {
  classic: hash(fs.readFileSync(path.join(root, 'classic.html'))) === original['index.html'],
  alternate: hash(fs.readFileSync(path.join(root, 'index_v2.html'))) === original['index_v2.html'],
  ads: hash(fs.readFileSync(path.join(root, 'app-ads.txt'))) === original['app-ads.txt']
};
for (const [name, pass] of Object.entries(preserved)) if (!pass) failures.push('기존 원본 변경: ' + name);
const entries = [];
const names = new Map();
for (const file of [...files].sort()) {
  let directory = root;
  for (const part of file.split('/')) {
    if (!names.has(directory)) names.set(directory, fs.readdirSync(directory));
    if (!names.get(directory).includes(part)) failures.push('대소문자 불일치: ' + file);
    directory = path.join(directory, part);
  }
  const contents = fs.readFileSync(path.join(root, file));
  const entry = { file, bytes: contents.length, sha256: hash(contents) };
  if (base && file !== '.nojekyll') {
    const response = await fetch(new URL(file, base));
    entry.httpStatus = response.status;
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== entry.sha256) failures.push('웹 파일 불일치: ' + file);
  }
  entries.push(entry);
}
const report = { checkedAt: new Date().toISOString(), passed: failures.length === 0, failures, preserved,
  count: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), files: entries,
  scope: '배포에 필요한 정적 파일과 경로의 확인 목록. 파일 업로드·원격 배포는 수행하지 않음.' };
fs.writeFileSync(path.join(output, 'DEPLOY_FILES.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failures, preserved, count: report.count, bytes: report.bytes }));
if (failures.length) process.exitCode = 1;
