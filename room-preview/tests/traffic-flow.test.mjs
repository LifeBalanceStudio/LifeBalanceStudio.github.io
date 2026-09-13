import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_GAP, createTrafficFlow } from '../traffic-flow.mjs';

const make = () => createTrafficFlow({ length: 521.46, capacity: 12, gates: [100, 475], near: 44.7, far: 164.1 });

test('선두 차량부터 반응 간격을 두고 뒤차가 차례로 출발한다', () => {
  const flow = make(); flow.setTarget(3, 1);
  flow.positions.set([99.8, 99.8 - CAR_GAP, 99.8 - CAR_GAP * 2]); flow.speeds.fill(0);
  const starts = [null, null, null];
  for (let frame = 0; frame < 240; frame++) {
    flow.update(0.05);
    for (let i = 0; i < 3; i++) if (starts[i] === null && flow.speeds[i] > 0.12) starts[i] = frame * 0.05;
  }
  assert.ok(starts.every(value => value !== null));
  assert.ok(starts[1] - starts[0] >= 0.3, JSON.stringify(starts));
  assert.ok(starts[2] - starts[1] >= 0.3, JSON.stringify(starts));
});

test('긴 정체·회복 실행에서도 차량이 겹치거나 역주행하지 않는다', () => {
  const flow = make(); flow.setTarget(12, 1);
  const positions = flow.positions, speeds = flow.speeds, active = flow.active;
  let stops = 0;
  for (let frame = 0; frame < 12000; frame++) {
    if (frame === 7000) flow.setTarget(3, 0);
    if (frame === 9000) flow.setTarget(12, 1);
    flow.update(0.05);
    for (let i = 0; i < 12; i++) if (active[i]) {
      assert.ok(speeds[i] >= 0 && speeds[i] <= 4.200001);
      if (speeds[i] < 0.1) stops++;
      for (let j = i + 1; j < 12; j++) if (active[j]) {
        const difference = Math.abs(positions[i] - positions[j]);
        assert.ok(Math.min(difference, 521.46 - difference) >= CAR_GAP - 0.00001);
      }
    }
  }
  assert.ok(stops > 100, '정체 중에는 정지 후 재출발이 실제로 발생해야 한다');
  assert.equal(flow.positions, positions); assert.equal(flow.speeds, speeds); assert.equal(flow.active, active);
});

test('시야 안 생성·제거를 미루고 롯데타워 쪽 해소 강도는 양방향에서 증가한다', () => {
  const flow = make(); flow.setTarget(12, 1); flow.update(0.05);
  flow.setTarget(2, 0); flow.update(0.05, () => false); assert.equal(flow.state.active, 12);
  flow.update(0.05, () => true); assert.equal(flow.state.active, 2);
  assert.equal(flow.relief(44.7), 0); assert.equal(flow.relief(164.1), 1);
  assert.ok(flow.relief(100) > flow.relief(50));
  assert.ok(flow.relief(521.46 - 150) > flow.relief(521.46 - 50));
});
