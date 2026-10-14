export const AUDIO_DEFAULTS = Object.freeze({ enabled: false, master: 0.5, effects: 0.7, ambience: 0.25 });
const clamp = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

export function normalizeAudioSettings(value) {
  return { enabled: value?.enabled === true, master: clamp(value?.master, 0.5),
    effects: clamp(value?.effects, 0.7), ambience: clamp(value?.ambience, 0.25) };
}

export function environmentAudioLevels(weather, traffic, windowDistance = 3, opening = 0.88) {
  const distance = Number.isFinite(windowDistance) ? Math.max(0, windowDistance) : 3;
  const near = 1 / (1 + distance * 0.3);
  const blind = clamp(opening, 0.88);
  const transmission = (0.55 + near * 0.45) * (0.72 + blind * 0.28);
  const rain = ['rain', 'sleet', 'storm'].includes(weather?.condition)
    ? clamp(Math.sqrt(Math.max(0, weather?.precipitationRate ?? 0.4) / 8), 0) : 0;
  return { rain: rain * transmission, wind: clamp((weather?.windSpeed || 0) / 12) * 0.5 * transmission,
    traffic: (0.12 + clamp((traffic?.road || 0) / 12) * 0.48) * transmission,
    cutoff: 1100 + blind * 2200 + near * 700 };
}

export function createRoomAudio({ settings, onStatus = () => {} } = {}) {
  let preferences = normalizeAudioSettings(settings);
  let context, master, effects, ambience, exteriorFilter;
  let active = false, disposed = false, suspendTimer, nextUpdate = 0;
  const buffers = new Map(), loads = new Map(), loops = new Map(), voices = new Set();
  const controllers = new Set();
  let levels = environmentAudioLevels();
  let blindMoving = false;

  function audible() { return preferences.enabled && active && !document.hidden && !disposed; }
  function ramp(param, value, seconds = 0.15) {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, context.currentTime, seconds);
  }
  function stopVoices() {
    for (const voice of voices) { try { voice.stop(); } catch { /* 이미 끝난 소리도 안전하게 정리한다. */ } }
  }
  function syncPlayback() {
    if (!context) return;
    clearTimeout(suspendTimer);
    ramp(master.gain, audible() ? preferences.master : 0, 0.015);
    ramp(effects.gain, preferences.effects);
    ramp(ambience.gain, preferences.ambience);
    if (!audible()) {
      stopVoices();
      suspendTimer = setTimeout(() => { if (!audible() && context.state === 'running') context.suspend().catch(() => {}); }, 100);
    }
  }
  function startLoop(name) {
    if (loops.has(name) || !buffers.has(name) || !audible()) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0;
    source.buffer = buffers.get(name);
    source.loop = true;
    source.connect(gain).connect(name === 'blind' ? effects : exteriorFilter);
    source.start();
    loops.set(name, { source, gain });
  }
  async function load(name) {
    if (buffers.has(name)) return;
    if (loads.has(name)) return loads.get(name);
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    const task = (async () => {
      const response = await fetch(new URL('./assets/audio/' + name + '.mp3', import.meta.url), { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (!disposed) { buffers.set(name, buffer); if (name !== 'switch') startLoop(name); }
    })().finally(() => { clearTimeout(timer); controllers.delete(controller); loads.delete(name); });
    loads.set(name, task);
    return task;
  }
  async function unlock() {
    if (!preferences.enabled || disposed || document.hidden) return false;
    try {
      if (!context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) { onStatus('이 브라우저에서는 소리를 사용할 수 없습니다.'); return false; }
        context = new AudioContextClass();
        master = context.createGain(); master.gain.value = 0;
        effects = context.createGain(); ambience = context.createGain();
        exteriorFilter = context.createBiquadFilter(); exteriorFilter.type = 'lowpass'; exteriorFilter.Q.value = 0.5;
        effects.connect(master); exteriorFilter.connect(ambience).connect(master); master.connect(context.destination);
      }
      // 사용자 클릭 안에서 즉시 재개를 요청해야 자동 재생 제한을 피할 수 있다.
      await context.resume();
      syncPlayback();
      if (!audible()) return false;
      for (const name of ['rain', 'wind', 'traffic', 'blind']) startLoop(name);
      onStatus('소리를 준비하고 있습니다.');
      const results = await Promise.allSettled(['rain', 'wind', 'traffic', 'blind', 'switch'].map(load));
      if (!disposed && preferences.enabled) onStatus(results.some(result => result.status === 'rejected')
        ? '일부 소리를 불러오지 못했습니다. 소리를 다시 켜면 재시도합니다.' : '소리 설정은 이 브라우저에 저장됩니다.');
      return audible();
    } catch {
      onStatus('소리를 시작하지 못했습니다. 소리를 껐다 켜 주세요.');
      return false;
    }
  }
  function play(kind) {
    if (!audible() || context?.state !== 'running' || preferences.master === 0 || preferences.effects === 0) return;
    const time = context.currentTime;
    if (voices.size >= 4) return;
    const gain = context.createGain();
    let source, duration;
    if (kind === 'switch') {
      if (!buffers.has('switch')) return;
      source = context.createBufferSource(); source.buffer = buffers.get('switch'); duration = source.buffer.duration;
      gain.gain.setValueAtTime(0.6, time);
    } else {
      source = context.createOscillator(); source.type = 'square';
      const notes = kind === 'confirm' ? [523.25, 783.99] : kind === 'back' ? [392, 261.63] : [660, 660];
      duration = kind === 'move' ? 0.065 : 0.14;
      source.frequency.setValueAtTime(notes[0], time);
      source.frequency.setValueAtTime(notes[1], time + duration / 2);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.075, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    }
    source.connect(gain).connect(effects);
    voices.add(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); voices.delete(source); };
    source.start(time); source.stop(time + duration);
  }
  function update(weather, traffic, windowDistance, opening, moving, now = performance.now()) {
    blindMoving = moving;
    if (!context || !audible()) return;
    const blind = loops.get('blind');
    if (blind && blind.moving !== moving) {
      blind.moving = moving;
      ramp(blind.gain.gain, moving ? 0.5 : 0, 0.025);
    }
    if (now < nextUpdate) return;
    nextUpdate = now + 100;
    levels = environmentAudioLevels(weather, traffic, windowDistance, opening);
    for (const name of ['rain', 'wind', 'traffic']) {
      const loop = loops.get(name);
      if (loop) ramp(loop.gain.gain, levels[name], 0.6);
    }
    ramp(exteriorFilter.frequency, levels.cutoff, 0.3);
  }
  function visibilityChanged() {
    if (document.hidden) syncPlayback();
    else if (context && audible()) void unlock();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  return {
    get settings() { return { ...preferences }; },
    get state() { return { context: context?.state || 'uninitialized', loaded: buffers.size, loops: loops.size, voices: voices.size,
      levels: { ...levels }, blindMoving, enabled: preferences.enabled }; },
    setSettings(value) { preferences = normalizeAudioSettings(value); syncPlayback(); },
    setActive(value) { active = Boolean(value); syncPlayback(); },
    unlock, play, update,
    dispose() {
      disposed = true;
      clearTimeout(suspendTimer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      for (const controller of controllers) controller.abort();
      stopVoices();
      for (const { source, gain } of loops.values()) { source.stop(); source.disconnect(); gain.disconnect(); }
      loops.clear(); buffers.clear();
      context?.close().catch(() => {});
    }
  };
}
