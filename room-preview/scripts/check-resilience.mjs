import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/completion-2026-09-12');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const app = fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + '\nglobalThis.__qa = {renderer, camera, streetLife, precipitation, texelSplat, enterTV, exitTV, get mode(){return mode;}, get tweenDuration(){return cameraTween?.duration;}, get root(){return root;}};';
const checks = [];
const executables = [['Chrome', process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['Edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']].filter(([, file]) => fs.existsSync(file));
for (const [name, executablePath] of executables) {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const scenario of name === 'Chrome' ? ['조작', '저장소 차단', 'WebGL 없음', '모델 실패', '그래픽 연결 중단'] : ['조작']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.route('**/room-preview/app.mjs', route => route.fulfill({ contentType: 'text/javascript', body: app }));
      await page.route('**/api/seoul-weather', route => route.fulfill({ status: 503, body: '{}' }));
      await page.route('**/api/seoul-traffic', route => route.fulfill({ contentType: 'application/json', body: '{"source":"schedule","reason":"unconfigured"}' }));
      await page.addInitScript(scenario => {
        HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error('검사용 마우스 고정 거부'));
        if (scenario === '저장소 차단') Object.defineProperty(window, 'localStorage', { get() { throw new Error('검사용 저장소 차단'); } });
        if (scenario === 'WebGL 없음') {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args); };
        }
      }, scenario);
      if (scenario === '모델 실패') await page.route('**/assets/room.glb', route => route.fulfill({ status: 503, body: '' }));
      await page.goto(new URL('room-preview/', base).href);
      if (['WebGL 없음', '모델 실패'].includes(scenario)) {
        await page.waitForFunction(() => globalThis.__qa?.mode === 'error');
        checks.push({ browser: name, scenario, pass: await page.locator('#entry-panel a[href="../classic.html"]').isVisible() && await page.locator('#enter-button').isEnabled(), pageErrors });
        await page.screenshot({ path: path.join(output, scenario === 'WebGL 없음' ? 'fallback-webgl.png' : 'fallback-model.png') });
      } else {
        await page.waitForFunction(() => globalThis.__qa?.mode === 'ready');
        if (scenario === '그래픽 연결 중단') {
          await page.evaluate(() => __qa.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
          await page.waitForFunction(() => __qa.mode === 'error');
          checks.push({ browser: name, scenario, pass: await page.locator('#entry-panel a[href="../classic.html"]').isVisible(), pageErrors });
        } else {
          await page.locator('#enter-button').click();
          await page.waitForFunction(() => __qa.mode === 'explore');
          const before = await page.evaluate(() => __qa.camera.position.z);
          await page.keyboard.down('KeyW'); await page.waitForTimeout(220); await page.keyboard.up('KeyW');
          const moved = await page.evaluate(() => __qa.camera.position.z);
          const dragHelp = await page.locator('#look-help').innerText();
          await page.keyboard.press('Escape');
          await page.locator('#view-settings summary').click(); await page.locator('#reduce-motion').check();
          await page.locator('#resume-button').click();
          const shortTween = await page.evaluate(() => { __qa.enterTV(); return __qa.tweenDuration === 1; });
          await page.waitForFunction(() => __qa.mode === 'tv');
          await page.evaluate(() => __qa.exitTV()); await page.waitForFunction(() => __qa.mode === 'explore');
          await page.keyboard.press('KeyT'); await page.waitForTimeout(100);
          const texel = await page.evaluate(() => __qa.texelSplat.state.enabled);
          checks.push({ browser: name, scenario, pass: moved < before && dragHelp.includes('드래그') && shortTween && texel,
            moved: before - moved, shortTween, texel, pageErrors });
        }
      }
      await page.close();
    }
  } finally { await browser.close(); }
}
const report = { checkedAt: new Date().toISOString(), checks, scope: 'Chrome·Edge 독립 자동 검사. 실제 사용자 프로필·기기 설정은 변경하지 않음.' };
fs.writeFileSync(path.join(output, 'resilience-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!executables.length || checks.some(check => !check.pass || check.pageErrors.length)) process.exitCode = 1;
