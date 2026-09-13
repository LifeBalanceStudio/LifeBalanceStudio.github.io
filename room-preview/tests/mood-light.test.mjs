import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { seoulDaylight, createMoodLightController, createMoodLight } from '../mood-light.mjs';

const date = value => new Date(value);
const fails = () => { throw new Error('일출·일몰 계산 불가'); };

test('서울의 계절별 일출·일몰을 계산하고 방문자 시간대에 영향받지 않는다', () => {
  const summer = seoulDaylight(date('2026-06-21T12:00:00+09:00'));
  const winter = seoulDaylight(date('2026-12-21T12:00:00+09:00'));
  assert.equal(summer.source, 'solar');
  assert.equal(winter.source, 'solar');
  assert.ok(summer.sunset - summer.sunrise > winter.sunset - winter.sunrise + 4 * 3600000);
  const previousZone = process.env.TZ;
  try {
    for (const timeZone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = timeZone;
      assert.deepEqual(seoulDaylight(date('2026-06-21T03:00:00Z')), summer);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('일출 직전에 켜지고 일출에는 꺼지며 일몰에는 다시 켜진다', () => {
  const controller = createMoodLightController();
  const { sunrise, sunset } = seoulDaylight(date('2026-09-11T12:00:00+09:00'));
  for (const [time, on] of [[sunrise - 1, true], [sunrise, false], [sunset - 1, false], [sunset, true]]) {
    const state = controller.read(date(time));
    assert.equal(state.on, on);
    assert.equal(state.automatic, true);
    assert.ok(state.nextChange > time);
  }
});

test('수동 소등은 자정에도 유지되고 다음 일출부터 자동으로 복귀한다', () => {
  const controller = createMoodLightController();
  const nextSunrise = seoulDaylight(date('2026-09-12T12:00:00+09:00')).sunrise;
  const manual = controller.toggle(date('2026-09-11T21:00:00+09:00'));
  assert.equal(manual.on, false);
  assert.equal(manual.automatic, false);
  assert.equal(manual.nextChange, nextSunrise);
  assert.equal(controller.read(date('2026-09-12T00:01:00+09:00')).automatic, false);
  assert.equal(controller.read(date(nextSunrise - 1)).on, false);
  assert.equal(controller.read(date(nextSunrise)).automatic, true);
});

test('낮의 수동 점등과 반복 조작은 다음 일몰까지 유지한다', () => {
  const controller = createMoodLightController();
  const noon = date('2026-09-11T12:00:00+09:00');
  const sunset = seoulDaylight(noon).sunset;
  assert.equal(controller.toggle(noon).on, true);
  assert.equal(controller.toggle(noon).on, false);
  assert.equal(controller.read(date(sunset - 1)).automatic, false);
  const state = controller.read(date(sunset));
  assert.equal(state.on, true);
  assert.equal(state.automatic, true);
});

test('장시간 숨겨진 탭이 같은 밤 시간에 복귀해도 지난 수동 설정을 해제한다', () => {
  const controller = createMoodLightController();
  controller.toggle(date('2026-12-31T22:00:00+09:00'));
  const state = controller.read(date('2027-01-02T22:00:00+09:00'));
  assert.equal(state.on, true);
  assert.equal(state.automatic, true);
});

test('계산 실패와 잘못된 결과에서는 서울 시간 18시~06시를 사용한다', () => {
  const noon = date('2026-09-11T12:00:00+09:00');
  for (const calculate of [fails, () => ({ sunrise: null, sunset: null }), () => ({ sunrise: new Date(NaN), sunset: new Date(NaN) })]) {
    const result = seoulDaylight(noon, calculate);
    assert.deepEqual(result, {
      sunrise: Date.parse('2026-09-11T06:00:00+09:00'),
      sunset: Date.parse('2026-09-11T18:00:00+09:00'),
      source: 'fixed'
    });
  }
  const controller = createMoodLightController(fails);
  for (const [time, on] of [['05:59:59', true], ['06:00:00', false], ['17:59:59', false], ['18:00:00', true]]) {
    assert.equal(controller.read(date('2026-09-11T' + time + '+09:00')).on, on);
  }
  controller.toggle(date('2026-09-11T20:00:00+09:00'));
  assert.equal(controller.read(date('2026-09-12T05:59:59+09:00')).automatic, false);
  assert.equal(controller.read(date('2026-09-12T06:00:00+09:00')).automatic, true);
});

test('무드등은 갓과 실제 광원을 함께 전환하고 공유된 원본 재질을 보존한다', () => {
  const material = new MeshStandardMaterial({ color: '#6e5e47' });
  const shade = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), material);
  shade.position.set(-1.21, 0.79, 0.93);
  const lamp = createMoodLight(shade);
  assert.notEqual(shade.material, material);
  assert.ok(lamp.light.position.distanceTo(shade.position) < 1e-8);
  lamp.setOn(false);
  assert.equal(lamp.light.intensity, 0);
  assert.equal(lamp.light.shadow.map, null);
  assert.equal(lamp.light.shadow.needsUpdate, true, '소등 상태의 첫 렌더도 그림자 텍스처 생성을 예약해야 한다');
  lamp.setOn(true);
  assert.ok(lamp.light.intensity > 0 && shade.material.emissiveIntensity > 0);
  assert.equal(material.emissive.getHex(), 0);
  lamp.setOn(false);
  assert.equal(lamp.light.intensity, 0);
  assert.equal(shade.material.emissiveIntensity, 0);
});
