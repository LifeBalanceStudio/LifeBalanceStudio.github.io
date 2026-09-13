import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { createExterior } from '../exterior.mjs';
import { createStreetLife } from '../street-life.mjs';
import { completedSeoulHour, scheduledTraffic, trafficState, createSeoulTraffic, TRAFFIC_CACHE_KEY, rushHour } from '../seoul-traffic.mjs';
import { createTrafficProxy, parseTrafficXml } from '../traffic-proxy.mjs';

const start = Date.parse('2026-09-14T08:10:00+09:00');
const period = completedSeoulHour(start);
const data = { station: 'C-19', volume: 4800, periodEnd: period.periodEnd };
function xml(at = period, count = 800) {
  const rows = [1, 2].flatMap(io => [1, 2, 3].map(lane => `<row><spot_num>C-19</spot_num><ymd>${at.ymd}</ymd><hh>${at.hh}</hh><io_type>${io}</io_type><lane_num>${lane}</lane_num><vol>${count}</vol></row>`));
  return `<?xml version="1.0"?><VolInfo><list_total_count>6</list_total_count><RESULT><CODE>INFO-000</CODE></RESULT>${rows.join('')}</VolInfo>`;
}
const response = body => ({ ok: true, status: 200, text: async () => body, json: async () => body });

test('서울 자정·관찰한 러시아워와 집계 종료 기준 만료를 구분한다', () => {
  assert.deepEqual(completedSeoulHour(Date.parse('2026-09-14T00:15:00+09:00')), { ymd: '20260913', hh: '23', periodEnd: Date.parse('2026-09-14T00:00:00+09:00') });
  for (const [date, count] of [['2026-09-14T03:00:00+09:00', 1], ['2026-09-14T08:30:00+09:00', 8], ['2026-09-14T14:00:00+09:00', 3], ['2026-09-13T08:30:00+09:00', 8], ['2026-09-13T14:00:00+09:00', 3]]) {
    assert.equal(scheduledTraffic(Date.parse(date)).bridge, count);
  }
  assert.equal(trafficState(data, start).bridge, scheduledTraffic(start).bridge);
  assert.equal(trafficState(data, period.periodEnd + 7200001).source, 'schedule');
  assert.equal(trafficState({ ...data, periodEnd: start + 3600000 }, start).source, 'schedule');
  const noon = Date.parse('2026-09-14T12:00:00+09:00');
  assert.equal(trafficState({ ...data, volume: 0, periodEnd: noon }, noon).bridge, 1);
  assert.equal(trafficState(data, Date.parse('2026-09-14T09:50:00+09:00')).source, 'stored');
});

test('러시아워 전후 한 시간은 연속적이고 아침·저녁 진행 방향을 구분한다', () => {
  const at = time => rushHour(Date.parse('2026-09-14T' + time + ':00+09:00'));
  assert.equal(at('07:30').morning, 0); assert.equal(at('08:00').morning, 0.5);
  assert.equal(at('08:30').morning, 1); assert.equal(at('10:00').morning, 1);
  assert.equal(at('10:30').morning, 0.5); assert.equal(at('11:00').morning, 0);
  assert.equal(at('15:30').evening, 0); assert.equal(at('16:00').evening, 0.5);
  assert.equal(at('16:30').evening, 1); assert.equal(at('20:30').evening, 1);
  assert.equal(at('21:00').evening, 0.5); assert.equal(at('21:30').evening, 0);
  let previous = 0;
  for (let minute = 420; minute < 690; minute++) {
    const now = Date.parse('2026-09-14T00:00:00+09:00') + minute * 60000;
    const strength = rushHour(now).morning;
    assert.ok(Math.abs(strength - previous) < 0.026);
    previous = strength;
  }
});

test('전체 여섯 차로의 정상 값만 합산하고 오류·부분·중복·다른 시각은 거부한다', () => {
  assert.deepEqual(parseTrafficXml(xml(), period), data);
  assert.equal(parseTrafficXml(xml(period, 0), period).volume, 0);
  const invalid = [xml().replace(/<row>[\s\S]*?<\/row>/, ''), xml().replace('<list_total_count>6', '<list_total_count>5'),
    xml().replace('<lane_num>3', '<lane_num>2'), xml().replace('<hh>07', '<hh>06'),
    xml().replace('<vol>800', '<vol>-1'), xml().replace('C-19', 'A-01'),
    xml().replace('<vol>800</vol>', '<vol>800</vol><vol>800</vol>'), '<!DOCTYPE x>' + xml(),
    '<RESULT><CODE>INFO-200</CODE></RESULT>', xml().slice(0, -10)];
  for (const body of invalid) assert.throws(() => parseTrafficXml(body, period));
});

test('중계 요청은 합쳐지고 30분 동안 공유되며 실패하면 최근 자료에서 시간대로 전환한다', async () => {
  let now = start, calls = 0, fail = false;
  const proxy = createTrafficProxy({ key: '검사용키', now: () => now, fetcher: async () => {
    calls++; if (fail) throw new Error('연결 끊김'); return response(xml(completedSeoulHour(now)));
  } });
  const initial = await Promise.all([proxy.getTraffic(), proxy.getTraffic(), proxy.getTraffic()]);
  assert.equal(calls, 1); assert.ok(initial.every(value => value.source === 'live'));
  now += 29 * 60000; await proxy.getTraffic(); assert.equal(calls, 1);
  fail = true; now += 60000;
  assert.equal((await proxy.getTraffic()).source, 'stored'); assert.equal(calls, 2);
  await proxy.getTraffic(); assert.equal(calls, 2);
  now += 5 * 60000; await proxy.getTraffic(); assert.equal(calls, 3);
  now += 14 * 60000; await proxy.getTraffic(); assert.equal(calls, 3);
  now += 60000; await proxy.getTraffic(); assert.equal(calls, 4);
  now = period.periodEnd + 7200001;
  assert.equal((await proxy.getTraffic()).source, 'schedule');
  fail = false; now += 31 * 60000;
  assert.equal((await proxy.getTraffic()).source, 'live');
});

test('미설정·샘플키·인증 오류는 호출을 중지하고 호출 제한과 시간 초과를 처리한다', async () => {
  for (const key of ['', 'sample']) {
    const proxy = createTrafficProxy({ key, fetcher: () => assert.fail('외부 요청 금지') });
    assert.equal((await proxy.getTraffic()).reason, 'unconfigured');
  }
  let calls = 0, now = start;
  const auth = createTrafficProxy({ key: '검사용키', now: () => now, fetcher: async () => {
    calls++; return response('<RESULT><CODE>INFO-100</CODE></RESULT>');
  } });
  assert.equal((await auth.getTraffic()).reason, 'auth');
  now += 3600000; await auth.getTraffic(); assert.equal(calls, 1);
  const limited = createTrafficProxy({ key: '검사용키', now: () => now, fetcher: async () => ({ ok: false, status: 429, headers: { get: () => '7200' } }) });
  assert.equal((await limited.getTraffic()).retryAt, now + 7200000);
  const timeout = createTrafficProxy({ key: '검사용키', timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('시간 초과')))) });
  assert.equal((await timeout.getTraffic()).source, 'schedule');
});

test('클라이언트는 즉시 시작하고 저장소 오류·실패·만료·중복 요청을 처리한다', async () => {
  let now = start, calls = 0, fail = false;
  const published = [];
  const client = createSeoulTraffic({ url: '/api/seoul-traffic', now: () => now,
    storage: { getItem() { throw new Error('저장 금지'); }, setItem() { throw new Error('저장 금지'); } },
    onChange: value => published.push(value), fetcher: async () => {
      calls++; if (fail) throw new Error('연결 끊김'); return response({ source: 'live', data });
    } });
  assert.equal(client.state.source, 'schedule');
  await Promise.all([client.refresh(), client.refresh()]); assert.equal(calls, 1);
  assert.equal(client.state.source, 'live');
  fail = true; now += 30 * 60000; await client.refresh(); assert.equal(client.state.source, 'stored');
  now = period.periodEnd + 7200001; await client.refresh(); assert.equal(client.state.source, 'schedule');
  assert.ok(published.length >= 4);
  const stored = createSeoulTraffic({ url: null, now: () => start, storage: { getItem: key => key === TRAFFIC_CACHE_KEY ? JSON.stringify(data) : null } });
  assert.equal(stored.state.source, 'stored');
  const disabled = createSeoulTraffic({ url: '/api/seoul-traffic', fetcher: async () => { calls++; return response({ source: 'schedule', reason: 'unconfigured' }); } });
  await disabled.refresh(); const previous = calls; await disabled.refresh(); assert.equal(calls, previous);
});

test('중계의 재시도 시각과 클라이언트 호출 제한을 함께 지킨다', async () => {
  let now = start, calls = 0;
  const client = createSeoulTraffic({ url: '/api/seoul-traffic', now: () => now, fetcher: async () => {
    calls++; return response({ source: 'stored', data, retryAt: now + 5 * 60000 });
  } });
  await client.refresh(); now += 4 * 60000; await client.refresh(); assert.equal(calls, 1);
  now += 60000; await client.refresh(); assert.equal(calls, 2);
  calls = 0;
  const limited = createSeoulTraffic({ url: '/api/seoul-traffic', now: () => now, fetcher: async () => {
    calls++; return { ok: false, status: 429, headers: { get: () => '7200' } };
  } });
  await limited.refresh(); now += 7199000; await limited.refresh(); assert.equal(calls, 1);
  now += 1000; await limited.refresh(); assert.equal(calls, 2);
});

test('차량 풀은 버퍼·차종·색을 재사용하며 화면 안 전환과 성능 중지를 보존한다', () => {
  const life = createStreetLife(createExterior());
  const cars = life.root.children.slice(0, 3);
  const buffers = cars.map(mesh => [mesh.geometry, mesh.material, mesh.instanceMatrix.array, mesh.instanceColor.array]);
  life.setTraffic({ bridge: 1, road: 3 }); life.update(0);
  assert.equal(life.trafficState.active, 4); assert.deepEqual(cars.map(mesh => mesh.count), [2, 1, 1]);
  const matrix = new Matrix4(); cars[2].getMatrixAt(0, matrix);
  assert.ok(Math.abs(new Vector3().setFromMatrixPosition(matrix).z + 16) < 2, '앞쪽 차도 차량이 빈 슬롯으로 잘못 사라지면 안 된다');
  for (let i = 0; i < 60; i++) { life.setTraffic({ bridge: i % 3 + 1, road: 3 - i % 3 }); life.update(1 / 60); }
  cars.forEach((mesh, i) => {
    assert.equal(mesh.geometry, buffers[i][0]); assert.equal(mesh.material, buffers[i][1]);
    assert.equal(mesh.instanceMatrix.array, buffers[i][2]); assert.equal(mesh.instanceColor.array, buffers[i][3]);
    assert.equal(mesh.instanceMatrix.array.length, 128);
  });
  life.setTraffic({ bridge: 3, road: 3 }); life.update(1 / 60);
  const camera = new PerspectiveCamera(130, 2, 0.1, 2000);
  camera.position.set(0, 300, 100); camera.lookAt(0, -10, -70); camera.updateMatrixWorld();
  life.setTraffic({ bridge: 1, road: 1 }); life.update(1 / 60, camera);
  assert.equal(life.trafficState.active, 6, '보이는 차량은 즉시 사라지지 않는다');
  camera.lookAt(0, 1000, 100); life.update(1 / 60, camera);
  assert.equal(life.trafficState.active, 2);
  for (let i = 0; i < 250; i++) life.setFrameState(50, true);
  life.setTraffic({ bridge: 3, road: 3 }); life.update(1 / 60);
  assert.equal(life.root.visible, false, '자료 갱신이 성능 보호 중지를 해제하면 안 된다');
});
