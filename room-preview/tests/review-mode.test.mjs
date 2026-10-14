import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewController, mountReviewMode, parseReviewTime, reviewEnabled, seoulReviewParts } from '../review-mode.mjs';
import { seoulDaylight } from '../mood-light.mjs';
import { createStreetLife } from '../street-life.mjs';
import { createExterior } from '../exterior.mjs';
import { scheduledTraffic } from '../seoul-traffic.mjs';

const now = Date.parse('2026-09-13T22:15:00+09:00');

test('검수 메뉴는 로컬 주소와 명시적인 검수 매개변수가 모두 있어야 열린다', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(reviewEnabled({ hostname, search: '?review=1' }), true);
    assert.equal(reviewEnabled({ hostname, search: '' }), false);
  }
  const location = { hostname: 'lifebalancestudio.github.io', search: '?review=1' };
  assert.equal(reviewEnabled(location), false);
  assert.equal(mountReviewMode({ location, document: new Proxy({}, { get() { assert.fail('공개 페이지에 검수 DOM을 만들면 안 된다'); } }) }), null);
});

test('서울 날짜와 시각을 검증하며 잘못된 값은 현재 상태를 바꾸지 않는다', () => {
  const review = createReviewController({ now: () => now });
  assert.deepEqual(seoulReviewParts(now), { date: '2026-09-13', time: '22:15' });
  assert.equal(review.setTime('2026-02-30', '12:00'), false);
  assert.equal(review.setTime('2026-09-13', '24:00'), false);
  assert.equal(parseReviewTime('2026-09-13', '23:59'), Date.parse('2026-09-13T23:59:00+09:00'));
  assert.equal(review.state.active, false);
  assert.equal(review.setTime('2031-06-20', '12:30'), true);
  assert.equal(review.date().getTime(), Date.parse('2031-06-20T12:30:00+09:00'));
});

test('시간대 바로가기와 일몰 직전은 선택한 서울 날짜를 기준으로 계산한다', () => {
  const review = createReviewController({ now: () => now });
  for (const [preset, time] of [['noon', '12:00'], ['night', '22:00'], ['morning', '09:00'], ['evening', '18:30']]) {
    review.preset(preset, '2026-12-15');
    assert.deepEqual(seoulReviewParts(review.date().getTime()), { date: '2026-12-15', time });
  }
  review.preset('sunset', '2026-12-15');
  const sunset = seoulDaylight(new Date('2026-12-15T12:00:00+09:00')).sunset;
  assert.ok(sunset - review.date().getTime() >= 15 * 60000 && sunset - review.date().getTime() < 16 * 60000);
});

test('검수 날씨는 실제 데이터와 시계를 바꾸지 않으며 복귀하면 최신 실제 시각을 쓴다', () => {
  let current = now;
  const review = createReviewController({ now: () => current });
  const clock = Date.now;
  const live = Object.freeze({ condition: 'overcast', label: '흐림', source: 'live', cloudCover: 0.95, validAt: now });
  assert.equal(review.resolveWeather(live), live);
  review.setTime('2031-06-20', '12:30'); review.setWeather('rain'); review.setRate(6);
  const fake = review.resolveWeather(live);
  assert.equal(fake.source, 'review'); assert.equal(fake.precipitationRate, 6); assert.equal(live.condition, 'overcast');
  assert.equal(review.setRate(-1), false); assert.equal(review.setWeather('__proto__'), false);
  current += 60000;
  review.reset();
  assert.equal(review.state.active, false); assert.equal(review.date().getTime(), current);
  assert.equal(review.resolveWeather(live), live); assert.equal(Date.now, clock);
});

test('검수 시간 전환은 기존 차량 버퍼로 즉시 목표 대수를 배치한다', () => {
  const life = createStreetLife(createExterior());
  life.update(0.02);
  const buffers = life.root.children.map(mesh => mesh.instanceMatrix.array);
  const positions = life.bridgeFlow.positions;
  life.setTraffic(scheduledTraffic(Date.parse('2026-09-13T09:00:00+09:00')), true);
  assert.equal(life.trafficState.active, 20);
  assert.equal(life.root.children.slice(0, 3).reduce((sum, mesh) => sum + mesh.count, 0), 20);
  life.setTraffic(scheduledTraffic(Date.parse('2026-09-13T02:00:00+09:00')), true);
  assert.equal(life.trafficState.active, 2);
  assert.equal(life.bridgeFlow.positions, positions);
  life.root.children.forEach((mesh, index) => assert.equal(mesh.instanceMatrix.array, buffers[index]));
});
