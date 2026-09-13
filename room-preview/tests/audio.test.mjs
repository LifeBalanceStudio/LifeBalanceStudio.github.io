import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_DEFAULTS, normalizeAudioSettings, environmentAudioLevels } from '../audio.mjs';

test('새 방문과 잘못된 저장 값은 음소거 기본값으로 복구한다', () => {
  assert.deepEqual(normalizeAudioSettings(), AUDIO_DEFAULTS);
  assert.deepEqual(normalizeAudioSettings({ enabled: 'true', master: NaN, effects: Infinity, ambience: null }), AUDIO_DEFAULTS);
  assert.deepEqual(normalizeAudioSettings({ enabled: true, master: 2, effects: -1, ambience: 0 }),
    { enabled: true, master: 1, effects: 0, ambience: 0 });
});

test('비·진눈깨비·뇌우의 강수량만 빗소리에 반영하고 눈에는 빗소리를 넣지 않는다', () => {
  for (const condition of ['rain', 'sleet', 'storm']) {
    const light = environmentAudioLevels({ condition, precipitationRate: 0.5 });
    const heavy = environmentAudioLevels({ condition, precipitationRate: 8 });
    assert.ok(light.rain > 0 && heavy.rain > light.rain);
  }
  for (const condition of ['clear', 'snow', 'unknown']) {
    assert.equal(environmentAudioLevels({ condition, precipitationRate: 10 }).rain, 0);
  }
});

test('창문 거리와 블라인드는 완만하게 음량·고음을 줄인다', () => {
  const weather = { condition: 'rain', precipitationRate: 4, windSpeed: 6 };
  const close = environmentAudioLevels(weather, { road: 8 }, 0.3, 1);
  const far = environmentAudioLevels(weather, { road: 8 }, 3, 1);
  const covered = environmentAudioLevels(weather, { road: 8 }, 0.3, 0);
  for (const key of ['rain', 'wind', 'traffic', 'cutoff']) {
    assert.ok(close[key] > far[key]);
    assert.ok(close[key] > covered[key] && covered[key] > 0);
  }
});

test('현재 교통량과 바람이 커지면 각 환경음이 커지고 출력은 유한하다', () => {
  const quiet = environmentAudioLevels({ windSpeed: 0 }, { road: 2 });
  const rush = environmentAudioLevels({ windSpeed: 12 }, { road: 12 });
  assert.ok(rush.wind > quiet.wind && rush.traffic > quiet.traffic);
  const invalid = environmentAudioLevels({ windSpeed: NaN, condition: 'rain', precipitationRate: Infinity }, { road: -3 }, NaN, NaN);
  for (const value of Object.values(invalid)) assert.ok(Number.isFinite(value) && value >= 0);
});
