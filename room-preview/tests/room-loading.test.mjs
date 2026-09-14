import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { readGlbResponse, roomDownloadText } from '../room-loading.mjs';

const room = await fs.readFile(new URL('../assets/room.glb', import.meta.url));

test('실제 gzip 응답도 GLB 내부 길이로 계산해 100%에서 끝난다', async t => {
  const compressed = gzipSync(room);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': compressed.length });
    response.end(compressed);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const response = await fetch('http://127.0.0.1:' + server.address().port);
  assert.ok(Number(response.headers.get('content-length')) < room.length);
  const progress = [];
  const buffer = await readGlbResponse(response, value => progress.push(value));
  assert.deepEqual(Buffer.from(buffer), room);
  assert.deepEqual(progress.at(-1), { loaded: room.length, total: room.length });
  for (const value of progress) if (value.total != null) assert.ok(value.loaded <= value.total);
  assert.equal(roomDownloadText(progress.at(-1)), '방 파일 다운로드 100%');
});

test('헤더가 여러 조각으로 나뉘고 전송 길이 헤더가 없어도 정확히 읽는다', async () => {
  const progress = [];
  const stream = new ReadableStream({ start(controller) {
    let start = 0;
    for (const end of [3, 8, 12, 97, room.length]) { controller.enqueue(room.subarray(start, end)); start = end; }
    controller.close();
  } });
  const buffer = await readGlbResponse(new Response(stream), value => progress.push(value));
  assert.deepEqual(Buffer.from(buffer), room);
  assert.ok(progress.some(value => value.loaded === 8 && value.total == null));
  assert.ok(progress.some(value => value.loaded === 12 && value.total === room.length));
  assert.equal(progress.at(-1).loaded, room.length);
});

test('스트림 API가 없는 경우에도 파일 전체 길이를 검증한다', async () => {
  const buffer = room.buffer.slice(room.byteOffset, room.byteOffset + room.byteLength);
  const progress = [];
  assert.equal(await readGlbResponse({ ok: true, body: null, arrayBuffer: async () => buffer }, value => progress.push(value)), buffer);
  assert.deepEqual(progress.at(-1), { loaded: room.length, total: room.length });
});

test('잘린 파일·초과 데이터·잘못된 헤더·HTTP 실패는 완료로 처리하지 않는다', async () => {
  const corrupt = Buffer.from(room); corrupt[0] = 0;
  for (const body of [room.subarray(0, 8), room.subarray(0, room.length - 4), Buffer.concat([room, Buffer.alloc(4)]), corrupt]) {
    await assert.rejects(readGlbResponse(new Response(body)));
  }
  await assert.rejects(readGlbResponse(new Response('', { status: 404 })), /HTTP 404/);
});

test('읽기 실패 시 잠금을 정리하고 오류를 전달한다', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('통신 중단')); } }));
  await assert.rejects(readGlbResponse(response), /통신 중단/);
  assert.equal(response.body.locked, false);
});

test('전체 길이를 알 수 없거나 값이 맞지 않으면 잘못된 퍼센트를 표시하지 않는다', () => {
  for (const progress of [{ loaded: 8, total: null }, { loaded: 188, total: 100 }, { loaded: NaN, total: 100 }]) {
    assert.equal(roomDownloadText(progress), '방 파일을 내려받는 중…');
  }
  assert.equal(roomDownloadText({ loaded: 50, total: 100 }), '방 파일 다운로드 50%');
});
