import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrecipitation, precipitationLevels, PRECIPITATION } from '../precipitation.mjs';
import { parseSeoulForecast } from '../seoul-weather.mjs';

test('강수량은 해당 예보 기간으로 나누며 잘못된 단위와 0mm를 구분한다', () => {
  const time = Date.parse('2026-09-12T12:00:00Z');
  const payload = { properties: { meta: { updated_at: new Date(time).toISOString(), units: {
    cloud_area_fraction: '%', wind_speed: 'm/s', wind_from_direction: 'degrees', precipitation_amount: 'mm'
  } }, timeseries: [{ time: new Date(time).toISOString(), data: {
    instant: { details: { cloud_area_fraction: 100, wind_speed: 3, wind_from_direction: 90 } },
    next_6_hours: { summary: { symbol_code: 'rain' }, details: { precipitation_amount: 12 } }
  } }] } };
  let weather = parseSeoulForecast(payload, time);
  assert.equal(weather.precipitationRate, 2); assert.equal(weather.precipitationHours, 6);
  payload.properties.timeseries[0].data.next_1_hours = { summary: { symbol_code: 'rain' }, details: { precipitation_amount: 0 } };
  weather = parseSeoulForecast(payload, time);
  assert.equal(weather.precipitationRate, 0); assert.equal(weather.precipitationHours, 1);
  assert.deepEqual(precipitationLevels(weather), { rain: 0, snow: 0 });
  payload.properties.meta.units.precipitation_amount = 'cm';
  weather = parseSeoulForecast(payload, time);
  assert.equal(weather.precipitationRate, null);
  assert.equal(precipitationLevels(weather).rain, 0.3);
});

test('맑음·비·눈·진눈깨비는 정해진 입자 범위에서 구분한다', () => {
  assert.deepEqual(precipitationLevels({ condition: 'clear', precipitationRate: 20 }), { rain: 0, snow: 0 });
  assert.deepEqual(precipitationLevels({ condition: 'snow', precipitationRate: 30 }), { rain: 0, snow: 1 });
  const sleet = precipitationLevels({ condition: 'sleet', precipitationRate: 1 });
  assert.ok(sleet.rain > 0 && sleet.snow > 0 && sleet.rain < 1 && sleet.snow < 1);
  assert.ok(precipitationLevels({ condition: 'rain', precipitationRate: 4 }).rain > precipitationLevels({ condition: 'rain', precipitationRate: 0.1 }).rain);
});

test('강수 버퍼는 재사용하고 닫힌 창·동작 줄이기·자동 중지에서는 그리지 않는다', () => {
  const precipitation = createPrecipitation();
  const buffers = precipitation.root.children.map(mesh => mesh.geometry.attributes.aSeed.array);
  assert.equal(buffers[0].length, PRECIPITATION.rain * 4); assert.equal(buffers[1].length, PRECIPITATION.snow * 4);
  assert.ok(PRECIPITATION.nearZ < -3 && PRECIPITATION.floorY < 0);
  precipitation.setWeather({ condition: 'rain', precipitationRate: 6, windSpeed: 8, windFromDegrees: 90 });
  for (let i = 0; i < 100; i++) precipitation.update(0.05);
  assert.equal(precipitation.root.visible, true);
  precipitation.update(0.05, false); assert.equal(precipitation.root.visible, false);
  const paused = precipitation.state.time;
  precipitation.setReducedMotion(true); precipitation.update(0.05);
  assert.equal(precipitation.state.time, paused); assert.equal(precipitation.root.visible, false);
  precipitation.setReducedMotion(false); precipitation.setEnabled(false); precipitation.update(0.05);
  assert.equal(precipitation.root.visible, false);
  precipitation.setEnabled(true); precipitation.setWeather({ condition: 'clear' });
  for (let i = 0; i < 400; i++) precipitation.update(0.05);
  assert.equal(precipitation.root.visible, false);
  precipitation.root.children.forEach((mesh, i) => assert.equal(mesh.geometry.attributes.aSeed.array, buffers[i]));
  precipitation.dispose();
});
