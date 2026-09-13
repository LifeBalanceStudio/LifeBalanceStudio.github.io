import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/portfolio-fastpop-2026-09-13');
const base = process.argv[2] || 'http://127.0.0.1:4174/';
const checks = [], errors = [];
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /WebGL|GL_INVALID|THREE/.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('lifebalance.room.preferences.v1', JSON.stringify({ reducedMotion: true, lowPower: false }));
    localStorage.setItem('lifebalance.texel-splat.enabled', 'false');
  });
  await page.route('**/room-preview/app.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: fs.readFileSync(path.join(root, 'room-preview/app.mjs'), 'utf8') + '\nglobalThis.__portfolioQA = { setMode, enterTV, setTexelOption, renderer, camera, get mode() { return mode; }, get menu() { return tvMenu; }, get screen() { return screen; } };'
  }));
  await page.goto(new URL('room-preview/', base).href);
  await page.waitForFunction(() => !document.querySelector('#enter-button')?.disabled && globalThis.__portfolioQA?.menu);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { __portfolioQA.setMode('explore'); __portfolioQA.enterTV(); });
  await page.waitForFunction(() => __portfolioQA.mode === 'tv');
  await page.locator('#tv-choose').click();
  await page.locator('#tv-choose').click();

  const state = () => page.evaluate(() => ({
    stage: __portfolioQA.menu.stage, page: __portfolioQA.menu.detailPage,
    count: __portfolioQA.menu.detailPageCount, title: __portfolioQA.menu.current?.title,
    label: document.querySelector('#tv-selection').textContent,
    description: document.querySelector('#tv-description').textContent,
    focus: document.activeElement?.id, url: location.href
  }));
  const initial = await state();
  assert.match(initial.label, /Uncap · 게임 소개 · 1\/2/);
  assert.match(initial.description, /1인 개발/);
  assert.match(initial.description, /2025.08.05/);
  assert.equal(await page.locator('#tv-contact-link, #tv-controls a[href^="mailto:"]').count(), 0);
  checks.push('기존 페이지·게임 목록을 거쳐 소개 1/2 진입');

  async function capture(name) {
    const result = await page.evaluate(() => {
      const canvas = __portfolioQA.screen.material.map.image;
      const context = canvas.getContext('2d'), original = context.fillText, text = [];
      context.fillText = function (value, x, y, ...rest) {
        text.push({ value, x, y, width: this.measureText(value).width, align: this.textAlign, font: this.font });
        return original.call(this, value, x, y, ...rest);
      };
      try { __portfolioQA.menu.draw(); } finally { context.fillText = original; }
      return { image: canvas.toDataURL('image/png'), text };
    });
    assert(result.text.every(item => {
      const left = item.align === 'center' ? item.x - item.width / 2 : item.x;
      return left >= 32 && left + item.width <= 232 && item.y + 8 <= 224;
    }), '모든 문구가 CRT 본문 영역 안에 있어야 한다');
    fs.writeFileSync(path.join(output, name + '-menu.png'), Buffer.from(result.image.split(',')[1], 'base64'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(output, name + '-room.png') });
    return result.text;
  }
  const introduction = await capture('introduction');
  assert(introduction.some(item => item.value.includes('Android')), '소개 정보를 스크롤 없이 끝까지 표시해야 한다');
  checks.push('소개 본문·개발 기간·기술·전환 버튼의 실제 글꼴 배치');

  await page.locator('#tv-next').click();
  const features = await state();
  assert.equal(features.page, 1);
  assert.equal(features.title, initial.title);
  assert.equal(features.url, initial.url);
  assert.equal(features.focus, 'tv-previous');
  assert.match(features.label, /개발 특징 · 2\/2/);
  assert.match(features.description, /병 오브젝트 재사용/);
  const featureText = await capture('features');
  assert.equal(featureText.filter(item => /^\d\. /.test(item.value)).length, 3);
  assert(featureText.some(item => item.value === '다음 등장에 다시 사용합니다.'));
  assert((await page.locator('#tv-game-link').getAttribute('href')).includes('com.LifeBalance.Uncap'));
  checks.push('같은 URL·게임의 특징 3개와 스토어 링크 유지');

  await page.keyboard.press('Enter');
  assert.equal((await state()).page, 0);
  await page.keyboard.press('Space');
  assert.equal((await state()).page, 1);
  checks.push('하단 전환 버튼의 초점 유지와 Enter·Space 단일 동작');

  await page.locator('canvas').focus();
  for (const [key, expected] of [['ArrowLeft', 0], ['ArrowRight', 1], ['a', 0], ['d', 1], ['f', 0], ['Space', 1], ['Enter', 0]]) {
    await page.keyboard.press(key);
    assert.equal((await state()).page, expected, key);
  }
  checks.push('좌우·A/D·F·Space·Enter로 상세 화면 전환');
  const buttonPoint = await page.evaluate(() => {
    const { screen, camera, renderer } = __portfolioQA;
    const { position, uv } = screen.geometry.attributes, indices = screen.geometry.index;
    const count = indices ? indices.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const [a, b, c] = [0, 1, 2].map(offset => indices ? indices.getX(i + offset) : i + offset);
      const [au, av, bu, bv, cu, cv] = [uv.getX(a), uv.getY(a), uv.getX(b), uv.getY(b), uv.getX(c), uv.getY(c)];
      const denominator = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
      if (Math.abs(denominator) < 1e-8) continue;
      const wa = ((bv - cv) * (132 / 256 - cu) + (cu - bu) * (195 / 240 - cv)) / denominator;
      const wb = ((cv - av) * (132 / 256 - cu) + (au - cu) * (195 / 240 - cv)) / denominator;
      const wc = 1 - wa - wb;
      if ([wa, wb, wc].some(weight => weight < -1e-6)) continue;
      const point = screen.position.clone().set(
        position.getX(a) * wa + position.getX(b) * wb + position.getX(c) * wc,
        position.getY(a) * wa + position.getY(b) * wb + position.getY(c) * wc,
        position.getZ(a) * wa + position.getZ(b) * wb + position.getZ(c) * wc
      );
      screen.localToWorld(point).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
    }
    return null;
  });
  assert(buttonPoint, 'CRT 내부 버튼의 실제 화면 좌표를 구해야 한다');
  await page.mouse.click(buttonPoint.x, buttonPoint.y);
  assert.equal((await state()).page, 1);
  await page.keyboard.press('ArrowDown');
  assert.equal((await state()).page, 1);
  checks.push('CRT 내부 버튼의 실제 마우스 클릭과 세로 키의 화면 전환 분리');

  await page.evaluate(() => __portfolioQA.setTexelOption(true));
  await capture('features-texel');
  assert.equal(await page.evaluate(() => __portfolioQA.renderer.getContext().getError()), 0);
  checks.push('텍셀 스플래팅 상태에서 동일한 특징 화면 렌더링');
  await page.evaluate(() => __portfolioQA.setTexelOption(false));
  await page.keyboard.press('Escape');
  assert.equal((await state()).stage, 'games');
  assert.equal((await state()).title, 'Uncap');
  await page.locator('#tv-choose').click();
  assert.equal((await state()).page, 0);
  checks.push('특징에서 Esc 목록 복귀와 재진입 시 소개부터 표시');

  await page.setViewportSize({ width: 960, height: 600 });
  await capture('introduction-small');
  const buttons = await page.locator('#tv-controls').boundingBox();
  assert(buttons.x >= 0 && buttons.x + buttons.width <= 960);
  checks.push('작은 데스크톱 화면의 하단 조작부 배치');
  await page.locator('#tv-back').click();
  await page.locator('#tv-next').click();
  await page.locator('#tv-choose').click();
  assert.equal((await state()).title, 'Fast Pop!!');
  assert.equal((await state()).page, 0);
  assert.equal((await state()).count, 2);
  assert.match((await state()).description, /일반·엔드리스/);
  assert.match((await state()).description, /2025.09.01~2025.10.22/);
  await page.setViewportSize({ width: 1280, height: 800 });
  const fastPopIntroduction = await capture('fastpop-introduction');
  assert(fastPopIntroduction.some(item => item.value.includes('Android')));
  await page.locator('#tv-next').click();
  assert.match((await state()).description, /피버·황금 러시/);
  assert.doesNotMatch((await state()).description, /드래그 입력 대상/);
  const fastPopFeatures = await capture('fastpop-features');
  assert.equal(fastPopFeatures.filter(item => /^\d\. /.test(item.value)).length, 3);
  assert(fastPopFeatures.some(item => item.value === '풀링으로 사용한 오브젝트를 재사용합니다.'));
  assert((await page.locator('#tv-game-link').getAttribute('href')).endsWith('com.LifeBalance.FastPop'));
  assert.equal(await page.locator('#tv-contact-link, #tv-controls a[href^="mailto:"]').count(), 0);
  checks.push('FastPop 소개·기간·특징 3개와 게임별 스토어 연결');
  checks.push('Uncap·FastPop 상세에서 게임 문의 버튼 제거');
  await page.keyboard.press('Enter');
  assert.equal((await state()).page, 0);
  await page.locator('#tv-next').click();
  await page.keyboard.press('Escape');
  assert.equal((await state()).stage, 'games');
  assert.equal((await state()).title, 'Fast Pop!!');
  await page.locator('#tv-choose').click();
  assert.equal((await state()).page, 0);
  checks.push('FastPop 특징 복귀·목록 선택 보존·재진입 초기화');
  await page.locator('#tv-back').click();
  await page.locator('#tv-next').click();
  await page.locator('#tv-choose').click();
  assert.equal((await state()).title, 'PachiPachi');
  assert.equal((await state()).count, 1);
  assert.equal(await page.locator('#tv-next').isVisible(), false);
  assert.equal(await page.locator('#tv-previous').isVisible(), false);
  checks.push('상세 자료가 없는 다른 게임의 기존 소개 유지');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'browser-check.json'), JSON.stringify({ passed: true, checks, errors, introduction, features: featureText, fastPopIntroduction, fastPopFeatures }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} finally {
  await browser.close();
}
