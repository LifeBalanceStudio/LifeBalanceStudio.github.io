import test from 'node:test';
import assert from 'node:assert/strict';
import { isSoftwareRenderer, helpBrowser, createFrameMonitor } from '../graphics-help.mjs';

test('알려진 소프트웨어 렌더러만 감지한다', () => {
  for (const value of ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) D3D11)', 'Google SwiftShader', 'llvmpipe (LLVM)', 'softpipe', 'D3D11 WARP']) assert.equal(isSoftwareRenderer(value), true);
  for (const value of ['', null, 'ANGLE (NVIDIA GeForce RTX 3080)', 'ANGLE (Intel UHD Graphics)', 'Apple M2', 'Microsoft Corporation']) assert.equal(isSoftwareRenderer(value), false);
});

test('PC 크롬·파이어폭스를 구분하고 모바일과 다른 브라우저에 PC 설정을 단정하지 않는다', () => {
  assert.equal(helpBrowser('Mozilla/5.0 (Windows NT 10.0) Chrome/153.0 Safari/537.36'), 'chrome');
  assert.equal(helpBrowser('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/153.0'), 'firefox');
  for (const value of ['Chrome/153.0 Edg/153.0', 'Android Firefox/153.0 Mobile', 'iPhone CriOS/153.0', 'Version/18 Safari/605']) assert.equal(helpBrowser(value), 'other');
});

function observe(fps, seconds = 11, monitor = createFrameMonitor()) {
  const results = [];
  for (let i = 0; i < fps * seconds; i++) {
    const result = monitor.sample(1000 / fps, true);
    if (result) results.push(result);
  }
  return results;
}

test('지속적인 저프레임을 감지하고 의도한 30FPS 절전은 문제로 취급하지 않는다', () => {
  const slow = observe(10);
  assert.equal(slow.length, 1);
  assert.equal(slow[0].fps, 10);
  assert.equal(slow[0].slow, true);
  for (const fps of [20, 30, 60, 120]) assert.equal(observe(fps)[0].slow, false);
});

test('초기 로딩 구간·비활성 상태·긴 중단은 저프레임으로 누적하지 않는다', () => {
  const monitor = createFrameMonitor();
  assert.deepEqual(observe(5, 2, monitor), []);
  for (const value of [0, NaN, -1, 6000]) assert.equal(monitor.sample(value, true), null);
  assert.deepEqual(observe(10, 5, monitor), []);
  monitor.sample(100, false);
  assert.deepEqual(observe(10, 8, monitor), []);
});

test('느린 상태 이후의 새 관찰 구간에서 회복을 판단할 수 있다', () => {
  const monitor = createFrameMonitor();
  assert.equal(observe(10, 9, monitor)[0].slow, true);
  assert.equal(observe(60, 7, monitor)[0].slow, false);
});

test('1FPS보다 낮은 지속적인 렌더링도 장치 정보 없이 감지한다', () => {
  const result = observe(0.5, 20)[0];
  assert.equal(result.fps, 0.5);
  assert.equal(result.slow, true);
});
