import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoQuality } from '../auto-quality.mjs';

function controller(hz = 60) {
  const quality = createAutoQuality();
  for (let i = 0; i <= 8; i++) quality.tick(i * 1000 / hz);
  return quality;
}

function run(quality, seconds, actualFps, limit = 60) {
  const changes = [];
  for (let i = 0; i < seconds * actualFps; i++) {
    if (quality.sample(1000 / actualFps, limit)) changes.push(quality.scale);
  }
  return changes;
}

test('초기 측정은 긴 로딩 지연과 한 번의 짧은 간격을 제외한다', () => {
  const quality = createAutoQuality();
  let time = 0;
  assert.equal(quality.tick(time), true);
  for (const ms of [200, 16, 16, 16, 5, 40, 16, 16]) {
    time += ms;
    assert.equal(quality.tick(time), true);
  }
  assert.equal(quality.tick(time + 16), false);
  assert.equal(quality.displayMs, 16);
});

test('30·60·75·120·144Hz 화면과 선택한 FPS 상한을 성능 부족으로 오판하지 않는다', () => {
  for (const hz of [30, 60, 75, 120, 144]) {
    for (const limit of [30, 45, 60, 75, 90, 120]) {
      const quality = controller(hz);
      let next = 0, previous = 0;
      for (let i = 1; i <= hz * 40; i++) {
        const time = i * 1000 / hz;
        if (time + 0.25 < next) continue;
        next += 1000 / limit;
        if (next <= time + 0.25) next = time + 1000 / limit;
        quality.sample(time - previous, limit);
        previous = time;
      }
      assert.equal(quality.scale, 1, `${hz}Hz · ${limit}FPS`);
    }
  }
});

test('지속적인 저속 상태만 단계적으로 낮추며 최소 60%를 지킨다', () => {
  const quality = controller();
  assert.deepEqual(run(quality, 3, 20), []);
  assert.deepEqual(run(quality, 30, 20), [0.85, 0.7, 0.6]);
  assert.equal(quality.scale, 0.6);
});

test('한 번의 긴 지연과 짧은 부하 상승에는 해상도를 바꾸지 않는다', () => {
  const quality = controller();
  run(quality, 4, 60);
  quality.sample(1400, 60);
  run(quality, 8, 60);
  run(quality, 1, 20);
  run(quality, 10, 60);
  assert.equal(quality.scale, 1);
});

test('안정적으로 회복된 경우에만 한 단계씩 복원한다', () => {
  const quality = controller();
  run(quality, 30, 20);
  assert.equal(quality.scale, 0.6);
  assert.deepEqual(run(quality, 10, 60), []);
  assert.deepEqual(run(quality, 15, 60), [0.7]);
  assert.deepEqual(run(quality, 60, 60), [0.85, 1]);
});

test('복원 직후 다시 느려지면 재복원 대기를 60초로 늘린다', () => {
  const quality = controller();
  run(quality, 8, 20);
  assert.equal(quality.scale, 0.85);
  run(quality, 28, 60);
  assert.equal(quality.scale, 1);
  run(quality, 8, 20);
  assert.equal(quality.scale, 0.85);
  assert.deepEqual(run(quality, 40, 60), []);
  assert.deepEqual(run(quality, 30, 60), [1]);
});

test('정지·재개와 유효하지 않은 간격은 관측을 새로 시작한다', () => {
  for (const invalid of [0, -1, NaN, Infinity, 60000]) {
    const quality = controller();
    run(quality, 5, 20);
    quality.sample(invalid, 60);
    run(quality, 2, 20);
    assert.equal(quality.scale, 1);
  }
  const quality = controller();
  run(quality, 5, 20);
  quality.reset();
  run(quality, 2, 20);
  assert.equal(quality.scale, 1);
});

test('끄면 원래 해상도로 돌아가고 다시 측정할 때 주사율을 갱신한다', () => {
  const quality = controller(120);
  run(quality, 20, 20);
  quality.restore();
  assert.equal(quality.scale, 1);
  quality.calibrate();
  for (let i = 0; i <= 8; i++) quality.tick(i * 1000 / 60);
  assert.ok(Math.abs(quality.displayMs - 1000 / 60) < 0.001);
  run(quality, 40, 60, 120);
  assert.equal(quality.scale, 1);
});
