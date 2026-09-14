function glbLength(bytes) {
  if (bytes.byteLength < 12) return null;
  const header = new DataView(bytes.buffer, bytes.byteOffset, 12);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) throw new Error('올바른 GLB 2 파일이 아닙니다.');
  const length = header.getUint32(8, true);
  if (length < 20 || length % 4 !== 0) throw new Error('GLB 파일 길이가 올바르지 않습니다.');
  return length;
}

export function roomDownloadText({ loaded, total }) {
  if (Number.isFinite(loaded) && loaded >= 0 && Number.isFinite(total) && total > 0 && loaded <= total) {
    return '방 파일 다운로드 ' + Math.floor(loaded / total * 100) + '%';
  }
  return '방 파일을 내려받는 중…';
}

export async function readGlbResponse(response, onProgress = () => {}) {
  if (!response.ok) throw new Error('방 파일 요청에 실패했습니다. HTTP ' + response.status);
  onProgress({ loaded: 0, total: null });
  // HTTP 전송 크기는 압축될 수 있으므로 GLB 내부의 압축 해제된 전체 길이를 사용한다.
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    const total = glbLength(new Uint8Array(buffer));
    if (total == null || buffer.byteLength !== total) throw new Error('방 파일의 전체 길이가 일치하지 않습니다.');
    onProgress({ loaded: total, total });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [], header = new Uint8Array(12);
  let headerBytes = 0, loaded = 0, total = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (headerBytes < 12) {
        const count = Math.min(12 - headerBytes, value.byteLength);
        header.set(value.subarray(0, count), headerBytes);
        headerBytes += count;
        if (headerBytes === 12) total = glbLength(header);
      }
      if (total != null && loaded > total) throw new Error('방 파일의 전체 길이가 일치하지 않습니다.');
      chunks.push(value);
      onProgress({ loaded, total });
    }
    if (total == null || loaded !== total) throw new Error('방 파일의 전체 길이가 일치하지 않습니다.');
    const data = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return data.buffer;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
