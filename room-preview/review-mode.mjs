import { seoulDaylight } from './mood-light.mjs';

const HOUR = 3600000;
const weatherPresets = {
  clear: { condition: 'clear', label: '맑음', cloudCover: 0 },
  fair: { condition: 'fair', label: '구름 조금', cloudCover: 0.35 },
  overcast: { condition: 'overcast', label: '흐림', cloudCover: 1 },
  rain: { condition: 'rain', label: '비', cloudCover: 1 },
  snow: { condition: 'snow', label: '눈', cloudCover: 1 },
  sleet: { condition: 'sleet', label: '진눈깨비', cloudCover: 1 }
};

export function reviewEnabled(location = globalThis.location) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location?.hostname)
    && new URLSearchParams(location.search || '').get('review') === '1';
}

export function seoulReviewParts(time) {
  const iso = new Date(time + 9 * HOUR).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function parseReviewTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const timestamp = Date.parse(date + 'T' + time + ':00+09:00');
  if (!Number.isFinite(timestamp) || seoulReviewParts(timestamp).date !== date) return null;
  return timestamp;
}

export function createReviewController({ now = Date.now, onChange } = {}) {
  let fixedTime = null, weather = 'live', rate = 2;
  const changed = () => { onChange?.(); return true; };
  return {
    get state() { return { active: fixedTime !== null || weather !== 'live', fixedTime, weather, rate }; },
    date() { return new Date(fixedTime ?? now()); },
    setTime(date, time) {
      const parsed = parseReviewTime(date, time);
      if (parsed === null) return false;
      fixedTime = parsed; return changed();
    },
    preset(name, date = seoulReviewParts(fixedTime ?? now()).date) {
      const midday = parseReviewTime(date, '12:00');
      if (midday === null) return false;
      const times = { noon: '12:00', night: '22:00', morning: '09:00', evening: '18:30' };
      if (name === 'sunset') fixedTime = Math.floor((seoulDaylight(new Date(midday)).sunset - 15 * 60000) / 60000) * 60000;
      else if (Object.hasOwn(times, name)) fixedTime = parseReviewTime(date, times[name]);
      else return false;
      return changed();
    },
    setWeather(value) {
      if (value !== 'live' && !Object.hasOwn(weatherPresets, value)) return false;
      weather = value; return changed();
    },
    setRate(value) {
      if (!Number.isFinite(value) || value < 0 || value > 6) return false;
      rate = value; return changed();
    },
    resolveWeather(live) {
      if (weather === 'live') return live;
      return { ...weatherPresets[weather], windSpeed: 2, windFromDegrees: 270,
        precipitationRate: ['rain', 'snow', 'sleet'].includes(weather) ? rate : 0,
        precipitationHours: 1, validAt: fixedTime ?? now(), updatedAt: null, source: 'review' };
    },
    reset() { fixedTime = null; weather = 'live'; rate = 2; return changed(); }
  };
}

export function mountReviewMode({ location = globalThis.location, document = globalThis.document, now = Date.now, onChange, onFocus } = {}) {
  if (!reviewEnabled(location)) return null;
  const element = document.createElement('details');
  element.id = 'environment-review'; element.className = 'environment-review'; element.open = true;
  element.innerHTML = `
    <summary>시간·날씨 검수 <span class="review-badge">로컬</span></summary>
    <div class="review-content">
      <output id="review-status" role="status" aria-live="polite"></output>
      <button id="review-reset" type="button">실제 서울 시간·날씨로 복귀</button>
      <p class="review-description">검수값은 저장하지 않습니다. 방에서는 마우스 드래그로 둘러보세요.</p>
      <div class="review-date-row">
        <label>서울 날짜<input id="review-date" type="date"></label>
        <label>서울 시각<input id="review-time" type="time" step="60"></label>
      </div>
      <label class="review-slider">시각 조절<input id="review-time-slider" type="range" min="0" max="1439" step="1"></label>
      <div class="review-presets" aria-label="시간대 선택">
        <button type="button" data-preset="noon">낮 12:00</button>
        <button type="button" data-preset="sunset">일몰 15분 전</button>
        <button type="button" data-preset="night">밤 22:00</button>
        <button type="button" data-preset="morning">아침 정체 09:00</button>
        <button type="button" data-preset="evening">저녁 정체 18:30</button>
      </div>
      <label>날씨<select id="review-weather">
        <option value="live">현재 서울 예보</option><option value="clear">맑음</option><option value="fair">구름 조금</option>
        <option value="overcast">흐림</option><option value="rain">비</option><option value="snow">눈</option><option value="sleet">진눈깨비</option>
      </select></label>
      <label id="review-rate-control">강수 세기 <output id="review-rate-label"></output><input id="review-rate" type="range" min="0" max="6" step="0.25" value="2"></label>
      <p id="review-motion-note" class="review-description"></p>
    </div>`;
  document.querySelector('#room').append(element);
  const field = id => element.querySelector('#' + id);
  let reducedMotion = false;
  const control = createReviewController({ now, onChange: () => { refresh(); onChange?.(control.state); } });
  function refresh() {
    const state = control.state, parts = seoulReviewParts(control.date().getTime());
    if (document.activeElement !== field('review-date')) field('review-date').value = parts.date;
    if (document.activeElement !== field('review-time')) field('review-time').value = parts.time;
    if (document.activeElement !== field('review-time-slider')) field('review-time-slider').value = Number(parts.time.slice(0, 2)) * 60 + Number(parts.time.slice(3));
    if (document.activeElement !== field('review-weather')) field('review-weather').value = state.weather;
    if (document.activeElement !== field('review-rate')) field('review-rate').value = state.rate;
    field('review-rate').disabled = !['rain', 'snow', 'sleet'].includes(state.weather);
    field('review-rate-control').hidden = field('review-rate').disabled;
    field('review-rate-label').textContent = state.rate.toFixed(2).replace(/\.00$/, '') + ' mm/h';
    const label = (state.active ? '검수 중 · ' : '실시간 · ') + parts.date + ' ' + parts.time;
    if (field('review-status').textContent !== label) field('review-status').textContent = label;
    element.querySelector('.review-badge').textContent = state.active ? '검수 중' : '로컬';
    element.classList.toggle('review-active', state.active);
    field('review-motion-note').textContent = reducedMotion
      ? '동작 줄이기가 켜져 있어 강수·차량이 숨겨집니다.' : '창밖은 블라인드를 열어 확인하세요. 시간 전환 시 차량 배치도 갱신됩니다.';
  }
  function changeTime() {
    if (!control.setTime(field('review-date').value, field('review-time').value)) field('review-status').textContent = '올바른 날짜와 시각을 선택해 주세요.';
  }
  field('review-date').addEventListener('change', changeTime);
  field('review-time').addEventListener('change', changeTime);
  field('review-time-slider').addEventListener('input', () => {
    const minutes = Number(field('review-time-slider').value);
    field('review-time').value = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    changeTime();
  });
  for (const button of element.querySelectorAll('[data-preset]')) button.addEventListener('click', () => control.preset(button.dataset.preset, field('review-date').value));
  field('review-weather').addEventListener('change', () => control.setWeather(field('review-weather').value));
  field('review-rate').addEventListener('input', () => control.setRate(Number(field('review-rate').value)));
  field('review-reset').addEventListener('click', () => control.reset());
  element.addEventListener('focusin', () => onFocus?.());
  refresh();
  return Object.assign(control, { element, refresh, setReducedMotion(value) { reducedMotion = Boolean(value); refresh(); } });
}
