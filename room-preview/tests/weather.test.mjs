import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { DEFAULT_WEATHER, WEATHER_CACHE_KEY, WEATHER_REFRESH_MS, createSeoulWeather, parseSeoulForecast, weatherEndpoint } from '../seoul-weather.mjs';
import { createWeatherSky, seoulSunDirection, seoulMoonState } from '../weather-sky.mjs';

const time = Date.parse('2026-09-12T03:30:00Z');
function forecast(cover = 95) {
  return { properties: {
    meta: { updated_at: '2026-09-12T01:00:00Z', units: { cloud_area_fraction: '%', wind_speed: 'm/s', wind_from_direction: 'degrees' } },
    timeseries: [2, 3, 4].map(hour => ({ time: `2026-09-12T0${hour}:00:00Z`, data: {
      instant: { details: { cloud_area_fraction: hour === 3 ? cover : 30, wind_speed: 2, wind_from_direction: 90 } },
      next_1_hours: { summary: { symbol_code: 'cloudy' } },
    } })),
  } };
}
function storage(value = null) {
  return { value, getItem() { return this.value; }, setItem(key, next) { assert.equal(key, WEATHER_CACHE_KEY); this.value = next; } };
}

test('서울 현재 시간대의 운량과 바람을 선택하고 누락·잘못된 단위·오래된 자료는 거부한다', () => {
  const data = forecast();
  const weather = parseSeoulForecast(data, time);
  assert.equal(weather.cloudCover, 0.95);
  assert.equal(weather.label, '흐림');
  assert.equal(weather.validAt, Date.parse('2026-09-12T03:00:00Z'));
  assert.equal(weather.windFromDegrees, 90);
  assert.equal(parseSeoulForecast(data, time + 13 * WEATHER_REFRESH_MS), null);
  data.properties.timeseries[1].data.instant.details.cloud_area_fraction = null;
  assert.equal(parseSeoulForecast(data, time), null);
  data.properties.timeseries[1].data.instant.details.cloud_area_fraction = 50;
  data.properties.meta.units.wind_speed = 'km/h';
  assert.equal(parseSeoulForecast(data, time), null);
});

test('최근 저장 예보는 재사용하고 새 자료를 받은 뒤 선택 상태와 저장 내용을 갱신한다', async () => {
  const saved = storage(JSON.stringify({ fetchedAt: time - 10000, payload: forecast(90) }));
  let calls = 0;
  const client = createSeoulWeather({ storage: saved, now: () => time, fetcher: async () => { calls++; return { ok: true, json: async () => forecast(5) }; } });
  await client.refresh();
  assert.equal(calls, 0);
  assert.equal(client.state.source, 'stored');
  await client.refresh(true);
  assert.equal(calls, 1);
  assert.equal(client.state.label, '맑음');
  assert.equal(client.state.source, 'live');
  assert.equal(JSON.parse(saved.value).fetchedAt, time);
});

test('연결 실패는 저장 예보로 대체하고 저장이 손상되거나 너무 오래되면 중립 하늘을 유지한다', async () => {
  const saved = storage(JSON.stringify({ fetchedAt: time - 2 * WEATHER_REFRESH_MS, payload: forecast(70) }));
  const offline = async () => { throw new Error('연결 끊김'); };
  const client = createSeoulWeather({ storage: saved, now: () => time, fetcher: offline });
  await client.refresh();
  assert.equal(client.state.cloudCover, 0.7);
  assert.equal(client.state.source, 'stored');
  const empty = createSeoulWeather({ storage: storage('손상된 자료'), now: () => time, fetcher: offline });
  await empty.refresh();
  assert.equal(empty.state.cloudCover, DEFAULT_WEATHER.cloudCover);
  assert.equal(empty.state.source, 'fallback');
  const expired = createSeoulWeather({ storage: saved, now: () => time + 13 * WEATHER_REFRESH_MS, fetcher: offline });
  await expired.refresh();
  assert.equal(expired.state.source, 'fallback');
});

test('중복 요청을 합치고 접근 제한 응답을 즉시 반복하지 않는다', async () => {
  let release, calls = 0;
  const client = createSeoulWeather({ now: () => time, fetcher: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = client.refresh(), second = client.refresh(true);
  release({ ok: true, json: async () => forecast() });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  let now = time, blocked = 0;
  const limited = createSeoulWeather({ now: () => now, fetcher: async () => { blocked++; return { ok: false, status: 429 }; } });
  await limited.refresh(true); await limited.refresh(true);
  assert.equal(blocked, 1);
  now += WEATHER_REFRESH_MS;
  await limited.refresh(true);
  assert.equal(blocked, 2);
});

test('태양은 서울 오전에 왼쪽, 오후에 오른쪽, 밤에는 지평선 아래에 위치한다', () => {
  const morning = seoulSunDirection(new Date('2026-09-12T08:00:00+09:00'));
  const afternoon = seoulSunDirection(new Date('2026-09-12T16:00:00+09:00'));
  const night = seoulSunDirection(new Date('2026-09-12T00:00:00+09:00'));
  assert.ok(morning.x < -0.4 && morning.y > 0);
  assert.ok(afternoon.x > 0.4 && afternoon.y > 0);
  assert.ok(night.y < 0);
  assert.ok(Math.abs(morning.length() - 1) < 0.000001);
});

test('서울의 달은 월출 후 동쪽에서 서쪽으로 이동하며 낮·밤만으로 강제 표시하지 않는다', () => {
  const east = seoulMoonState(new Date('2026-09-26T19:00:00+09:00'));
  const west = seoulMoonState(new Date('2026-09-27T04:00:00+09:00'));
  const below = seoulMoonState(new Date('2026-09-26T12:00:00+09:00'));
  assert.ok(east.direction.x < -0.4 && east.direction.y > 0);
  assert.ok(west.direction.x > 0.4 && west.direction.y > 0);
  assert.ok(below.direction.y < 0);
  assert.ok(Math.abs(east.direction.length() - 1) < 0.000001);
});

test('달의 날짜별 위상은 신월·초승·상현·보름·하현·그믐으로 변한다', () => {
  const phases = ['2026-09-11', '2026-09-15', '2026-09-18', '2026-09-26', '2026-10-03', '2026-10-07']
    .map(day => seoulMoonState(new Date(day + 'T21:00:00+09:00')));
  assert.ok(phases[0].fraction < 0.01);
  assert.ok(phases[1].fraction > 0.1 && phases[1].fraction < 0.3);
  assert.ok(phases[2].fraction > 0.4 && phases[2].fraction < 0.6);
  assert.ok(phases[3].fraction > 0.99);
  assert.ok(phases[4].fraction > 0.4 && phases[4].fraction < 0.6);
  assert.ok(phases[5].fraction > 0.05 && phases[5].fraction < 0.2);
  for (let i = 1; i < phases.length; i++) assert.ok(phases[i].phase > phases[i - 1].phase);
  assert.equal(phases[1].waxing, true); assert.equal(phases[5].waxing, false);
  const sky = createWeatherSky(new Color(), new Color());
  for (const date of ['2026-09-15T19:00:00+09:00', '2026-09-26T21:00:00+09:00', '2026-10-07T05:00:00+09:00']) {
    sky.setTime(new Date(date), { day: 0 });
    const uniforms = sky.mesh.material.uniforms;
    assert.ok(Math.abs(uniforms.uMoonLight.value.length() - 1) < 0.000001);
    assert.ok(Math.abs(uniforms.uMoonLight.value.z - (2 * sky.state.moonIlluminatedFraction - 1)) < 0.000001);
    assert.ok(Math.abs(uniforms.uMoonRight.value.dot(uniforms.uMoon.value)) < 0.000001);
  }
  sky.setTime(new Date('2026-09-15T15:00:00+09:00'), { day: 1 });
  assert.equal(sky.mesh.material.uniforms.uStars.value, 0, '밝은 낮에는 별을 표시하지 않는다');
  assert.ok(sky.state.moonDirection[1] > 0, '실제 위치가 지평선 위라면 낮의 달도 계산한다');
  sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
});

test('구름 양은 부드럽게 바뀌고 바람은 불어오는 방향의 반대로 이동한다', () => {
  const sky = createWeatherSky(new Color(), new Color());
  sky.setWeather({ ...DEFAULT_WEATHER, cloudCover: 1, windFromDegrees: 90, windSpeed: 2 });
  sky.update(2);
  assert.ok(sky.state.cloudCover > 0.25 && sky.state.cloudCover < 1);
  assert.ok(sky.state.wind[0] > 0 && Math.abs(sky.state.wind[1]) < 0.000001);
  sky.setWeather({ ...DEFAULT_WEATHER, cloudCover: 0, windSpeed: 0 });
  sky.update(30);
  assert.ok(sky.state.cloudCover < 0.001);
  assert.deepEqual(sky.state.wind, [-0, 0]);
  sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
  assert.equal(weatherEndpoint('127.0.0.1'), '/api/seoul-weather');
  assert.ok(weatherEndpoint('lifebalancestudio.github.io').startsWith('https://api.met.no/'));
});
