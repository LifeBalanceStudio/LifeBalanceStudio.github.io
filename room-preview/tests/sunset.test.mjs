import test from 'node:test';
import assert from 'node:assert/strict';
import { sunsetStrength } from '../sunset.mjs';
import { seoulSunDirection } from '../weather-sky.mjs';
import { createExterior } from '../exterior.mjs';
import { DEFAULT_WEATHER } from '../seoul-weather.mjs';

test('노을은 서쪽의 낮은 태양에서 강해지고 대낮·새벽·깊은 밤에는 꺼진다', () => {
  const amount = time => sunsetStrength(seoulSunDirection(new Date(time)));
  assert.equal(amount('2026-09-12T12:00:00+09:00'), 0);
  assert.equal(amount('2026-09-12T06:15:00+09:00'), 0);
  assert.equal(amount('2026-09-12T20:30:00+09:00'), 0);
  assert.ok(amount('2026-09-12T18:30:00+09:00') > 0.8);
  assert.ok(amount('2026-09-12T19:00:00+09:00') > 0);
  let previous = 0;
  const start = Date.parse('2026-09-12T16:00:00+09:00');
  for (let minute = 0; minute <= 300; minute++) {
    const current = amount(start + minute * 60000);
    assert.ok(current >= 0 && current <= 1);
    assert.ok(Math.abs(current - previous) < 0.06, '노을 강도가 분 단위로 갑자기 바뀌지 않아야 한다');
    previous = current;
  }
});

test('하늘·물·원경이 같은 태양 방향과 부드럽게 변하는 운량·노을 값을 공유한다', () => {
  const exterior = createExterior();
  const sky = exterior.sky.mesh.material.uniforms, water = exterior.water.material.uniforms;
  const backdrop = exterior.backdrop.children[0].material.uniforms;
  for (const key of ['uSun', 'uSunset', 'uCover']) {
    assert.equal(water[key], sky[key]); assert.equal(backdrop[key], sky[key]);
  }
  exterior.setTime(new Date('2026-09-12T18:30:00+09:00'));
  assert.ok(water.uSunset.value > 0.8);
  exterior.setWeather({ ...DEFAULT_WEATHER, cloudCover: 1 }); exterior.update(2);
  assert.ok(water.uCover.value > 0.25 && water.uCover.value < 1);
  assert.equal(water.uCover.value, exterior.sky.state.cloudCover);
  exterior.setTime(new Date('2026-09-12T20:30:00+09:00'));
  assert.equal(water.uSunset.value, 0);
});
