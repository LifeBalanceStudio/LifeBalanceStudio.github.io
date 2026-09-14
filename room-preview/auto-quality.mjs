const SCALES = [1, 0.85, 0.7, 0.6];

export function createAutoQuality() {
  let level = 0, displayMs = 1000 / 60;
  let lastTick = null, refreshSamples = [];
  let warmupMs = 0, elapsedMs = 0, frames = 0, slowFrames = 0, stableMs = 0;
  let sinceRaiseMs = Infinity, recoveryMs = 20000;

  function reset() {
    warmupMs = elapsedMs = frames = slowFrames = stableMs = 0;
  }

  return {
    get scale() { return SCALES[level]; },
    get displayMs() { return displayMs; },
    reset,
    restore() {
      level = 0; sinceRaiseMs = Infinity; recoveryMs = 20000;
      reset();
    },
    calibrate() {
      lastTick = null; refreshSamples = [];
      reset();
    },
    tick(time) {
      if (refreshSamples.length === 8) return false;
      const interval = lastTick === null ? 0 : time - lastTick;
      lastTick = time;
      if (Number.isFinite(interval) && interval >= 2 && interval <= 100) refreshSamples.push(interval);
      if (refreshSamples.length < 8) return true;
      // 이 짧은 측정 동안 앱은 그리기를 쉬어 GPU 부하와 화면 주사율을 구분한다.
      // 로딩 중 긴 작업의 영향을 줄이되 한 번의 지나치게 짧은 간격도 제외한다.
      refreshSamples.sort((a, b) => a - b);
      displayMs = (refreshSamples[1] + refreshSamples[2] + refreshSamples[3]) / 3;
      reset();
      return false;
    },
    sample(frameMs, fpsLimit) {
      if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 5000) { reset(); return false; }
      sinceRaiseMs += frameMs;
      warmupMs += frameMs;
      if (warmupMs < 3000) return false;
      const budget = Math.max(displayMs, 1000 / fpsLimit);
      elapsedMs += frameMs;
      frames++;
      if (frameMs > budget * 1.2) slowFrames++;
      if (elapsedMs < 4000) return false;

      const average = elapsedMs / frames;
      // 한 번의 로딩·스케줄링 지연 때문에 화면 전체의 화질이 바뀌지 않게 한다.
      const slow = average > budget * 1.16 && slowFrames / frames > 0.25;
      stableMs = average <= budget * 1.06 ? stableMs + elapsedMs : 0;
      elapsedMs = frames = slowFrames = 0;
      if (slow && level < SCALES.length - 1) {
        if (sinceRaiseMs < 12000) recoveryMs = 60000;
        level++;
        reset();
        return true;
      }
      if (level > 0 && stableMs >= recoveryMs) {
        level--;
        sinceRaiseMs = 0;
        reset();
        return true;
      }
      return false;
    }
  };
}
