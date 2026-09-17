import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { START, PLAYER_HEIGHT, movementInput, normalizeMouseSensitivity, normalizeFpsLimit, bindRoom, moveCircle, blindPose, visibleInteraction, touchInteraction, easeInOut } from './world.mjs';
import { createTVMenu } from './portfolio.mjs';
import { createUnityDemo } from './unity-demo.mjs';
import { createInteractionOutline } from './outline.mjs';
import { createMoodLightController, createMoodLight } from './mood-light.mjs';
import { createCeilingLight } from './ceiling-light.mjs';
import { createExterior, EXTERIOR } from './exterior.mjs';
import { createTexelSplatRenderer } from './texel-splat.mjs';
import { createSeoulWeather, WEATHER_REFRESH_MS } from './seoul-weather.mjs';
import { createSeoulTraffic, scheduledTraffic } from './seoul-traffic.mjs';
import { mountReviewMode } from './review-mode.mjs';
import { createPrecipitation } from './precipitation.mjs';
import { batchStaticExterior } from './static-batch.mjs';
import { createStreetLife } from './street-life.mjs';
import { AUDIO_DEFAULTS, normalizeAudioSettings, createRoomAudio } from './audio.mjs';
import { mountGraphicsHelp } from './graphics-help.mjs';
import { readGlbResponse, roomDownloadText } from './room-loading.mjs';
import { createAutoQuality } from './auto-quality.mjs';
import { createTouchControls, normalizeControlMode } from './touch-controls.mjs';

const $ = selector => document.querySelector(selector);
const canvas = $('#view');
const entry = $('#entry-panel');
const pausePanel = $('#pause-panel');
const enterButton = $('#enter-button');
const description = $('#entry-description');
const reticle = $('#reticle');
const actionPrompt = $('#action-prompt');
const help = $('#help');
const tvControls = $('#tv-controls');
const texelToggle = $('#texel-toggle');
const texelSettingKey = 'lifebalance.texel-splat.enabled';
const weatherPanel = $('#weather-panel');
const weatherDescription = $('#weather-description');
const trafficDescription = $('#traffic-description');
const lowPowerInput = $('#low-power');
const controlModeInput = $('#control-mode');
const coarsePointer = matchMedia('(pointer: coarse)');
const autoQualityInput = $('#auto-quality');
const autoQualityStatus = $('#auto-quality-status');
const autoQuality = createAutoQuality();
const reducedMotionInput = $('#reduce-motion');
const fpsLimitInput = $('#fps-limit');
const fpsLimitOutput = $('#fps-limit-value');
const sensitivityInput = $('#mouse-sensitivity');
const sensitivityOutput = $('#mouse-sensitivity-value');
const blindDialog = $('#blind-controls');
const blindInput = $('#blind-opening');
const blindOutput = $('#blind-opening-value');
const preferencesKey = 'lifebalance.room.preferences.v1';
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let lowPower = false, reducedMotion = motionPreference.matches, motionOverride = false, mouseSensitivity = 1;
let fpsLimit = 60;
let autoQualityEnabled = true;
let controlMode = 'auto', touchMode = false;
let audioSettings = normalizeAudioSettings();
try {
  const saved = JSON.parse(localStorage.getItem(preferencesKey) || 'null');
  lowPower = saved?.lowPower === true;
  fpsLimit = normalizeFpsLimit(saved?.fpsLimit);
  autoQualityEnabled = saved?.autoQuality !== false;
  controlMode = normalizeControlMode(saved?.controlMode);
  mouseSensitivity = normalizeMouseSensitivity(saved?.mouseSensitivity);
  audioSettings = normalizeAudioSettings(saved?.audio);
  if (typeof saved?.reducedMotion === 'boolean') { reducedMotion = saved.reducedMotion; motionOverride = true; }
} catch { /* 저장소를 사용할 수 없어도 기본 설정으로 동작한다. */ }
lowPowerInput.checked = lowPower; reducedMotionInput.checked = reducedMotion;
autoQualityInput.checked = autoQualityEnabled;
setMouseSensitivity(mouseSensitivity);
const weatherClock = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101419);
const camera = new THREE.PerspectiveCamera(70, 1, 0.025, EXTERIOR.far);
camera.position.set(START.x, START.y, START.z);
camera.rotation.order = 'YXZ';
camera.rotation.set(START.pitch, START.yaw, 0);
const keys = new Set();
const raycaster = new THREE.Raycaster();
raycaster.far = 2.15;
const center = new THREE.Vector2();
let owners = new WeakMap();
const meshes = [];
const targets = [];
const obstacles = [];
let mode = 'loading';
let yaw = START.yaw;
let pitch = START.pitch;
let root;
let screen;
let fabric;
let bottomBar;
let tvMenu;
let renderer;
let touchControls;
let resizeFramePending = false;
let interactionOutline;
let texelSplat;
const moodLightController = createMoodLightController();
let review = null, reviewMoodLightController = createMoodLightController(), previousReviewTime = null;
let liveWeather, liveTraffic, effectiveWeather, effectiveTraffic;
let moodLamp;
let ceilingLamp;
let moodLampOn = null;
let nextMoodCheck = 0;
let opening = 0.88;
let openingTarget = opening;
let resumeBlindPointerLock = false;
let mouseLocked = false;
let dragging = false;
let lastMouse = null;
let cameraTween = null;
let explorationPose = null;
let previousTime = performance.now();
let nextRenderAt = 0;
let noticeTimer;
setFpsLimit(fpsLimit);
const roomAudio = createRoomAudio({ settings: audioSettings, onStatus: message => { $('#sound-status').textContent = message; } });
const unityDemo = createUnityDemo($('#demo-dialog'), () => {
  if (screen) screen.material.color.setHex(0xffffff);
  if (mode !== 'tv-demo') return;
  setMode('tv');
  resize();
  refreshTVControls();
  $('#tv-demo').focus({ preventScroll: true });
});
syncSoundSettings();
if (audioSettings.enabled) $('#sound-status').textContent = '방에 입장하면 소리가 재생됩니다.';
const graphicsHelp = mountGraphicsHelp({
  onOpen: () => { keys.clear(); dragging = false; touchControls?.cancel(); pauseRoom(); },
  onContinue: enterRoom,
  onLowPower: () => { lowPowerInput.checked = true; applyViewPreferences(false); savePreferences(); enterRoom(); }
});
touchControls = createTouchControls({ canvas, container: $('#touch-controls'), stick: $('#move-stick'), knob: $('#stick-knob'),
  pauseButton: $('#touch-pause'), onLook: (dx, dy) => rotateView(dx, dy, true), onTap: tapCanvas, onPause: pauseRoom });
applyControlMode();

function notice(message) {
  const element = $('#notice');
  clearTimeout(noticeTimer);
  element.textContent = message;
  element.hidden = false;
  noticeTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

function setMode(next) {
  mode = next;
  clearTimeout(noticeTimer);
  $('#notice').hidden = true;
  if (next === 'ready' || next === 'paused') autoQuality.calibrate();
  else autoQuality.reset();
  previousTime = performance.now();
  nextRenderAt = 0;
  graphicsHelp.setMode(next);
  roomAudio.setActive(!['loading', 'error', 'tv-demo'].includes(mode));
  $('#sound-toggle').hidden = mode === 'error' || mode === 'tv-demo';
  if (mode !== 'blind' && blindDialog.open) blindDialog.close();
  interactionOutline?.setMode(next);
  syncTexelOption();
  weatherPanel.hidden = mode.startsWith('tv') || mode === 'error';
  $('#view-settings').hidden = mode.startsWith('tv') || mode === 'error';
  if (review) review.element.hidden = mode.startsWith('tv') || mode === 'error';
  keys.clear();
  dragging = false;
  lastMouse = null;
  syncTouchState();
  entry.hidden = !['loading', 'ready', 'error'].includes(mode);
  pausePanel.hidden = mode !== 'paused';
  reticle.hidden = mode !== 'explore' || touchMode;
  tvControls.hidden = mode !== 'tv';
  actionPrompt.hidden = true;
}

function roomInstructions() {
  return touchMode
    ? '왼쪽 스틱으로 이동하고 화면을 드래그해 둘러보세요. 가까운 게임기, 블라인드 줄, 조명과 스위치는 직접 터치해 사용할 수 있습니다.'
    : 'WASD로 이동하고 마우스로 둘러보세요. 게임기, 블라인드 줄, 무드등, 천장등과 문 옆 스위치는 F 또는 Space로 사용할 수 있습니다.';
}
function syncControlHelp() {
  $('#move-help').innerHTML = touchMode ? '왼쪽 스틱 · 이동' : '<kbd>WASD</kbd> 이동';
  $('#look-help').textContent = touchMode ? '화면 드래그 · 시야' : mouseLocked ? '마우스로 둘러보기' : '마우스 드래그로 둘러보기';
  $('#interact-help').innerHTML = touchMode ? '물체 탭 · 사용' : '<kbd>F</kbd> / <kbd>Space</kbd> 사용';
  $('#pause-help').hidden = touchMode;
  canvas.setAttribute('aria-label', touchMode ? '3D 방. 왼쪽 스틱으로 이동하고 화면을 드래그하거나 물체를 터치합니다.' : '3D 방. WASD로 이동하고 마우스로 둘러봅니다.');
}
function syncTouchState() {
  const controlState = $('#view-settings').open ? 'settings' : mode;
  touchControls?.setMode(controlState);
  help.hidden = mode.startsWith('tv') || (touchMode && controlState !== 'explore');
}
function applyControlMode(save = false) {
  touchMode = controlMode === 'touch' || (controlMode === 'auto' && coarsePointer.matches);
  controlModeInput.value = controlMode;
  $('#room').dataset.inputMode = touchMode ? 'touch' : 'keyboard';
  $('#control-mode-status').textContent = '현재 ' + (touchMode ? '터치 조작' : '키보드·마우스 조작') + (controlMode === 'auto' ? ' · 자동 선택' : ' · 직접 선택');
  $('#sensitivity-label').textContent = touchMode ? '터치 시야 감도' : '마우스 감도';
  $('#mouse-sensitivity-help').textContent = touchMode ? '화면을 드래그해 둘러보는 속도입니다.' : '마우스와 드래그로 둘러보는 속도입니다.';
  keys.clear(); dragging = false; lastMouse = null;
  touchControls.setEnabled(touchMode); syncTouchState(); syncControlHelp();
  reticle.hidden = mode !== 'explore' || touchMode;
  actionPrompt.hidden = true;
  if (touchMode && document.pointerLockElement === canvas) document.exitPointerLock();
  if (mode === 'ready') description.textContent = roomInstructions();
  if (save) savePreferences();
}
controlModeInput.addEventListener('change', () => { controlMode = normalizeControlMode(controlModeInput.value); applyControlMode(true); });
coarsePointer.addEventListener('change', () => { if (controlMode === 'auto') applyControlMode(); });
$('#view-settings').addEventListener('toggle', () => {
  keys.clear(); syncTouchState();
  if (!$('#view-settings').open && mode === 'explore') canvas.focus({ preventScroll: true });
});

function fatal(message, error) {
  setMode('error');
  $('#entry-title').textContent = '방을 열지 못했어요.';
  description.textContent = message;
  enterButton.textContent = '새로고침';
  enterButton.disabled = false;
  if (error) console.error(error);
}

try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  graphicsHelp.setRenderer(renderer.getContext());
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  interactionOutline = createInteractionOutline(renderer, scene, camera);
  texelSplat = createTexelSplatRenderer(renderer, scene, camera);
  const forcedRender = new URLSearchParams(location.search).get('render');
  let savedTexel = false;
  try { savedTexel = localStorage.getItem(texelSettingKey) === '1'; } catch { /* 저장이 제한되면 기본 3D로 시작한다. */ }
  texelSplat.setEnabled(forcedRender === 'texel' || (forcedRender !== 'original' && savedTexel));
  syncTexelOption();
} catch (error) {
  graphicsHelp.unavailable();
  fatal('이 브라우저에서 3D 화면을 시작할 수 없습니다. 그래픽 가속을 사용할 수 있는 브라우저에서 다시 열어 주세요.', error);
}

const ambient = new THREE.HemisphereLight(0xacc4dc, 0x4c3020, 0.65);
scene.add(ambient);
const windowLight = new THREE.DirectionalLight(0xffd7a0, 2.2);
windowLight.position.set(1, 5, -4);
windowLight.target.position.set(-0.7, 0.15, 0.2);
windowLight.castShadow = true;
windowLight.shadow.mapSize.set(1024, 1024);
Object.assign(windowLight.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 12 });
windowLight.shadow.camera.updateProjectionMatrix();
windowLight.shadow.bias = -0.0004;
windowLight.shadow.normalBias = 0.015;
windowLight.shadow.autoUpdate = false;
windowLight.shadow.needsUpdate = true;
scene.add(windowLight, windowLight.target);
const exterior = createExterior();
scene.add(exterior.root);
scene.fog = exterior.fog;
let exteriorState = exterior.setTime();
const streetLifeDay = { value: exteriorState.day };
const streetLife = createStreetLife(exterior, streetLifeDay);
scene.add(streetLife.root);
const exteriorBatch = batchStaticExterior(exterior.root);
const precipitation = createPrecipitation(streetLifeDay);
precipitation.setReducedMotion(reducedMotion);
scene.add(precipitation.root);
applyNaturalLight();
let weatherStorage = null;
try { weatherStorage = localStorage; } catch { /* 저장이 제한되어도 예보 표시는 계속한다. */ }
function applyEnvironmentWeather() {
  const weather = review?.resolveWeather(liveWeather) || liveWeather;
  if (!weather) return;
  effectiveWeather = weather;
  exterior.setWeather(weather);
  precipitation.setWeather(weather);
  const prefix = review?.state.active ? weather.source === 'review' ? '검수 · ' : '검수 · 현재 예보: ' : '서울 · ';
  const label = prefix + weather.label + (weather.source === 'stored' ? ' · 최근 예보' : '');
  if (weatherDescription.textContent !== label) weatherDescription.textContent = label;
  weatherPanel.title = review?.state.active
    ? '검수 시각 ' + weatherClock.format(environmentDate()) + '. ' + (weather.source === 'review' ? '선택한 검수 날씨입니다.' : '날씨는 현재 서울 예보이며 선택 날짜의 예보가 아닙니다.')
    : weather.validAt ? weatherClock.format(new Date(weather.validAt)) + ' 예보를 하늘 표현으로 단순화했습니다.' : '날씨 자료를 받으면 해와 구름이 바뀝니다.';
}
function applyEnvironmentTraffic(immediate = false) {
  const previewTime = review?.state.fixedTime != null;
  const traffic = previewTime ? scheduledTraffic(review.state.fixedTime) : liveTraffic;
  if (!traffic) return;
  effectiveTraffic = traffic;
  streetLife.setTraffic(traffic, immediate);
  const source = { schedule: '시간대 연출', live: '교통 자료', stored: '최근 자료' }[traffic.source];
  const level = traffic.rush > 0.95 ? '러시아워' : traffic.rush > 0.02 ? '혼잡 변화 중' : traffic.bridge <= 2 ? '통행 적음' : '통행 보통';
  const label = (previewTime ? '검수 교통 · ' : '서울 교통 · ') + source + ' · ' + level;
  if (trafficDescription.textContent !== label) trafficDescription.textContent = label;
  trafficDescription.title = traffic.periodEnd
    ? weatherClock.format(new Date(traffic.periodEnd - 3600000)) + '부터 1시간 동안의 통행량을 등장량으로 단순화했습니다. 앞쪽 차도는 서울 시간대에 맞춰 연출합니다. 출처: 서울 열린데이터광장.'
    : '08:30–10:00, 16:30–20:30의 전후로 혼잡이 서서히 변합니다. 아침 서향·저녁 동향 차도 정체와 교량 북단 대기행렬을 단순화한 연출입니다.';
}
function environmentDate() { return review?.date() || new Date(); }
function environmentMoodController() { return review?.state.fixedTime != null ? reviewMoodLightController : moodLightController; }
function applyEnvironmentTime() {
  exteriorState = exterior.setTime(environmentDate());
  streetLifeDay.value = exteriorState.day;
  applyNaturalLight();
  applyMoodLamp();
}
const seoulWeather = createSeoulWeather({ storage: weatherStorage, onChange: weather => { liveWeather = weather; applyEnvironmentWeather(); } });
const seoulTraffic = createSeoulTraffic({ storage: weatherStorage, onChange: traffic => { liveTraffic = traffic; applyEnvironmentTraffic(); } });
if (renderer) {
  review = mountReviewMode({ onFocus: () => { keys.clear(); dragging = false; touchControls.cancel(); }, onChange: state => {
    if (state.fixedTime !== previousReviewTime) { reviewMoodLightController = createMoodLightController(); previousReviewTime = state.fixedTime; }
    if (!state.active) { seoulWeather.refresh(); seoulTraffic.refresh(); }
    applyEnvironmentTime(); applyEnvironmentWeather(); applyEnvironmentTraffic(true);
    texelSplat?.invalidate();
  } });
  review?.setReducedMotion(reducedMotion);
  seoulWeather.refresh();
  seoulTraffic.refresh();
  // 분 단위로 시간대와 저장 자료의 유효성을 갱신한다. 네트워크 간격은 서비스에서 제한한다.
  setInterval(() => { if (!document.hidden) seoulTraffic.refresh(); }, 60000);
  addEventListener('online', () => seoulTraffic.refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) seoulTraffic.refresh(); });
  setInterval(() => { if (!document.hidden) seoulWeather.refresh(); }, WEATHER_REFRESH_MS);
  addEventListener('online', () => seoulWeather.refresh(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) seoulWeather.refresh(); });
}
const tvLight = new THREE.PointLight(0x5797ff, 2.5, 4, 2);
scene.add(tvLight);

function resize() {
  if (!renderer) return;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(devicePixelRatio, lowPower ? 1 : 1.75) * (autoQualityEnabled ? autoQuality.scale : 1);
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  resizeFramePending = true;
  texelSplat?.resize();
  interactionOutline?.resize(width, height);
  camera.aspect = width / height;
  if (screen && ['tv', 'tv-demo'].includes(mode)) camera.position.copy(tvViewPosition());
  else if (screen && mode === 'tv-enter' && cameraTween) cameraTween.position.copy(tvViewPosition());
  camera.updateProjectionMatrix();
  if (mode === 'tv-demo') positionDemo();
}
addEventListener('resize', () => { autoQuality.calibrate(); touchControls.cancel(); resize(); });
resize();

function syncAutoQuality() {
  autoQualityStatus.textContent = autoQualityEnabled
    ? '자동 조절 중 · 기본 해상도의 ' + Math.round(autoQuality.scale * 100) + '%'
    : '자동 조절 꺼짐 · 기본 해상도 유지';
}
syncAutoQuality();
autoQualityInput.addEventListener('change', () => {
  autoQualityEnabled = autoQualityInput.checked;
  autoQuality.restore();
  if (autoQualityEnabled) autoQuality.calibrate();
  resize();
  syncAutoQuality();
  savePreferences();
});

function applyViewPreferences(save = true) {
  lowPower = lowPowerInput.checked; reducedMotion = reducedMotionInput.checked;
  setFpsLimit(fpsLimit);
  precipitation.setReducedMotion(reducedMotion);
  review?.setReducedMotion(reducedMotion);
  resize();
  if (save) {
    motionOverride = true;
    savePreferences();
  }
}
function savePreferences() {
  try { localStorage.setItem(preferencesKey, JSON.stringify({ lowPower, ...(motionOverride ? { reducedMotion } : {}), mouseSensitivity, fpsLimit, autoQuality: autoQualityEnabled, controlMode, audio: roomAudio.settings })); } catch { /* 설정 저장 실패가 화면 사용을 막지 않는다. */ }
}
function setFpsLimit(value) {
  fpsLimit = normalizeFpsLimit(value);
  autoQuality.reset();
  fpsLimitInput.value = fpsLimit;
  fpsLimitInput.setAttribute('aria-valuetext', fpsLimit + ' FPS');
  fpsLimitOutput.value = fpsLimit + ' FPS';
  $('#fps-limit-help').textContent = lowPower
    ? '절전 표현 중에는 최대 30FPS입니다. 절전을 끄면 선택한 값이 적용됩니다.'
    : '둘러보기의 프레임 상한입니다. 대기·일시정지·TV 화면은 최대 30FPS로 표시합니다.';
  nextRenderAt = 0;
}
fpsLimitInput.addEventListener('input', () => setFpsLimit(fpsLimitInput.valueAsNumber));
fpsLimitInput.addEventListener('change', savePreferences);
$('#fps-limit-reset').addEventListener('click', () => { setFpsLimit(60); savePreferences(); });
function syncSoundSettings() {
  const settings = roomAudio.settings;
  $('#sound-enabled').checked = settings.enabled;
  $('#sound-toggle').textContent = settings.enabled ? '소리 끄기' : '소리 켜기';
  $('#sound-toggle').setAttribute('aria-pressed', String(settings.enabled));
  for (const name of ['master', 'effects', 'ambience']) {
    const value = Math.round(settings[name] * 100);
    $('#sound-' + name).value = value;
    $('#sound-' + name + '-value').value = value + '%';
  }
}
function setSoundEnabled(enabled) {
  roomAudio.setSettings({ ...roomAudio.settings, enabled });
  syncSoundSettings(); savePreferences();
  if (enabled) void roomAudio.unlock();
  else $('#sound-status').textContent = '소리가 꺼져 있습니다.';
}
$('#sound-toggle').addEventListener('click', () => setSoundEnabled(!roomAudio.settings.enabled));
$('#sound-enabled').addEventListener('change', event => setSoundEnabled(event.target.checked));
for (const name of ['master', 'effects', 'ambience']) {
  $('#sound-' + name).addEventListener('input', event => {
    roomAudio.setSettings({ ...roomAudio.settings, [name]: event.target.valueAsNumber / 100 });
    syncSoundSettings();
  });
  $('#sound-' + name).addEventListener('change', savePreferences);
}
$('#sound-reset').addEventListener('click', () => {
  roomAudio.setSettings(AUDIO_DEFAULTS); syncSoundSettings(); savePreferences();
  $('#sound-status').textContent = '소리 설정을 초기화했습니다. 현재 음소거 상태입니다.';
});
function setMouseSensitivity(value) {
  mouseSensitivity = normalizeMouseSensitivity(value);
  const percent = Math.round(mouseSensitivity * 100);
  sensitivityInput.value = percent;
  sensitivityInput.setAttribute('aria-valuetext', percent + '%');
  sensitivityOutput.value = percent + '%';
}
sensitivityInput.addEventListener('input', () => setMouseSensitivity(sensitivityInput.valueAsNumber / 100));
sensitivityInput.addEventListener('change', savePreferences);
$('#mouse-sensitivity-reset').addEventListener('click', () => { setMouseSensitivity(1); savePreferences(); });
$('#view-settings').addEventListener('focusin', () => { keys.clear(); dragging = false; lastMouse = null; });
lowPowerInput.addEventListener('change', () => applyViewPreferences());
reducedMotionInput.addEventListener('change', () => applyViewPreferences());
motionPreference.addEventListener('change', event => {
  if (!motionOverride) { reducedMotionInput.checked = event.matches; applyViewPreferences(false); }
});

function screenDirection() {
  const normals = screen.geometry.getAttribute('normal');
  const result = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let i = 0; i < normals.count; i++) result.add(normal.fromBufferAttribute(normals, i));
  return result.normalize().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(screen.matrixWorld)).normalize();
}

function refreshTVControls() {
  if (!tvMenu) return;
  const pages = tvMenu.stage === 'pages';
  const pagedDetail = tvMenu.detail && tvMenu.detailPageCount > 1;
  const features = tvMenu.detailPage === 1;
  const pagerFocused = document.activeElement === $('#tv-previous') || document.activeElement === $('#tv-next');
  $('#tv-selection').textContent = pages ? '페이지 선택 · PAGE.' + (tvMenu.selectedPage + 1) + ' / ' + tvMenu.pageCount : tvMenu.detail ? (tvMenu.current?.title || '게임') + ' · ' + tvMenu.detailTitle + (pagedDetail ? ' · ' + (tvMenu.detailPage + 1) + '/2' : '') : 'PAGE.' + (tvMenu.selectedPage + 1) + ' · 게임 선택';
  $('#tv-choose').textContent = pages ? '게임 목록 보기' : '게임 설명 보기';
  $('#tv-choose').hidden = tvMenu.detail;
  $('#tv-choose').disabled = tvMenu.selectableCount === 0;
  $('#tv-previous').hidden = tvMenu.detail && (!pagedDetail || !features);
  $('#tv-next').hidden = tvMenu.detail && (!pagedDetail || features);
  $('#tv-previous').disabled = tvMenu.detail ? !pagedDetail : tvMenu.selectableCount < 2;
  $('#tv-next').disabled = tvMenu.detail ? !pagedDetail : tvMenu.selectableCount < 2;
  $('#tv-previous').textContent = pagedDetail ? '이전 페이지' : '이전';
  $('#tv-next').textContent = pagedDetail ? '다음 페이지' : '다음';
  $('#tv-previous').setAttribute('aria-label', pagedDetail || pages ? '이전 페이지' : '이전 게임');
  $('#tv-next').setAttribute('aria-label', pagedDetail || pages ? '다음 페이지' : '다음 게임');
  $('#tv-demo').hidden = !tvMenu.detail || !tvMenu.current?.demo;
  if (pagedDetail && pagerFocused) $(features ? '#tv-previous' : '#tv-next').focus();
  $('#tv-back').textContent = tvMenu.detail ? '게임 목록으로' : pages ? '방으로 돌아가기' : '페이지 목록으로';
  const gameLink = $('#tv-game-link');
  const url = tvMenu.detail ? tvMenu.current?.url : '';
  gameLink.hidden = !url;
  if (url && url.startsWith('https://play.google.com/')) gameLink.href = url;
  else { gameLink.hidden = true; gameLink.removeAttribute('href'); }
  $('#tv-description').textContent = tvMenu.detail ? tvMenu.detailText : '';
}

function applyNaturalLight() {
  windowLight.intensity = 2.2 * opening * exteriorState.day;
  ambient.intensity = 0.1 + opening * (0.06 + exteriorState.day * 0.47);
}

function applyBlind() {
  if (!fabric) return;
  const pose = blindPose(opening);
  fabric.scale.y = pose.height;
  fabric.position.y = pose.centerY;
  bottomBar.position.y = pose.barY;
  applyNaturalLight();
  root.updateMatrixWorld(true);
  windowLight.shadow.needsUpdate = true;
}

function setBlindOpening(value) {
  openingTarget = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : openingTarget;
  const percent = Math.round(openingTarget * 100);
  blindInput.value = percent;
  blindInput.setAttribute('aria-valuetext', percent + '% 열림');
  blindOutput.value = percent + '%';
}

function openBlindControls() {
  if (mode !== 'explore') return;
  resumeBlindPointerLock = document.pointerLockElement === canvas;
  setBlindOpening(openingTarget);
  setMode('blind');
  if (document.pointerLockElement) document.exitPointerLock();
  blindDialog.show();
}

function closeBlindControls() {
  if (mode !== 'blind') return;
  setMode('explore');
  canvas.focus({ preventScroll: true });
  if (resumeBlindPointerLock) lockMouse();
}
blindInput.addEventListener('input', () => setBlindOpening(blindInput.valueAsNumber / 100));
for (const button of blindDialog.querySelectorAll('[data-blind-opening]')) {
  button.addEventListener('click', () => setBlindOpening(Number(button.dataset.blindOpening) / 100));
}
$('#blind-close').addEventListener('click', closeBlindControls);
blindDialog.addEventListener('cancel', event => { event.preventDefault(); closeBlindControls(); });

function applyMoodLamp(state = environmentMoodController().read(environmentDate())) {
  if (!moodLamp || moodLampOn === state.on) return;
  moodLampOn = state.on;
  moodLamp.setOn(state.on);
  texelSplat?.invalidate();
}

async function lockMouse() {
  if (touchMode) { syncControlHelp(); return; }
  if (review) { $('#look-help').textContent = '마우스 드래그로 둘러보기'; return; }
  if (document.pointerLockElement === canvas) return;
  if (!canvas.requestPointerLock) { $('#look-help').textContent = '마우스 드래그로 둘러보기'; return; }
  try {
    const result = canvas.requestPointerLock();
    if (result?.then) await result;
  } catch {
    $('#look-help').textContent = '마우스 드래그로 둘러보기';
    notice('마우스 고정을 사용할 수 없어 드래그로 둘러봅니다. WASD와 F/Space는 그대로 사용할 수 있습니다.');
  }
}

function enterRoom() {
  if (mode === 'error') { location.reload(); return; }
  if (!['ready', 'paused'].includes(mode)) return;
  setMode('explore');
  void roomAudio.unlock();
  canvas.focus();
  lockMouse();
}
enterButton.addEventListener('click', enterRoom);
$('#resume-button').addEventListener('click', enterRoom);

function pauseRoom() {
  if (mode !== 'explore' && mode !== 'blind') return;
  setMode('paused');
  if (document.pointerLockElement) document.exitPointerLock();
  $('#resume-button').focus();
}

document.addEventListener('pointerlockchange', () => {
  const wasLocked = mouseLocked;
  mouseLocked = document.pointerLockElement === canvas;
  syncControlHelp();
  if (wasLocked && !mouseLocked && mode === 'explore' && !touchMode) pauseRoom();
});
document.addEventListener('pointerlockerror', () => {
  syncControlHelp();
});

function findInteraction() {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(center, camera);
  return visibleInteraction(raycaster, targets, meshes, owners);
}

function setCameraTween(position, quaternion, fov, duration, done) {
  cameraTween = { start: performance.now(), duration: reducedMotion ? 1 : duration, fromPosition: camera.position.clone(), fromQuaternion: camera.quaternion.clone(), fromFov: camera.fov, position, quaternion, fov, done };
}

function tvViewPosition() {
  const box = new THREE.Box3().setFromObject(screen), size = box.getSize(new THREE.Vector3());
  // 낮은 가로 화면에서도 종료 버튼이 게임의 하단을 가리지 않도록 여유를 둔다.
  const verticalSpace = mode === 'tv-demo' ? Math.max(0.3, (canvas.clientHeight - 140) / canvas.clientHeight) : 1;
  const distance = Math.max(0.66, Math.max(size.y / verticalSpace, Math.hypot(size.x, size.z) / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(25))) * 1.12);
  return box.getCenter(new THREE.Vector3()).addScaledVector(screenDirection(), distance);
}

function enterTV() {
  if (mode !== 'explore') return;
  roomAudio.play('confirm');
  explorationPose = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
  const screenCenter = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3());
  const position = tvViewPosition();
  const look = new THREE.PerspectiveCamera();
  look.position.copy(position);
  look.lookAt(screenCenter);
  setMode('tv-enter');
  tvMenu.setActive(true);
  if (document.pointerLockElement) document.exitPointerLock();
  setCameraTween(position, look.quaternion.clone(), 50, 650, () => {
    setMode('tv');
    refreshTVControls();
    $('#tv-choose').focus({ preventScroll: true });
  });
}

function exitTV() {
  if (!explorationPose || mode === 'tv-exit') return;
  roomAudio.play('back');
  setMode('tv-exit');
  setCameraTween(explorationPose.position, explorationPose.quaternion, explorationPose.fov, 500, () => {
    setMode('explore');
    tvMenu.setActive(false);
    canvas.focus({ preventScroll: true });
    syncControlHelp();
  });
  lockMouse();
}

function positionDemo() {
  if (!screen || mode !== 'tv-demo') return;
  camera.updateMatrixWorld();
  const positions = screen.geometry.attributes.position, point = new THREE.Vector3();
  let left = Infinity, top = -Infinity, right = -Infinity, bottom = Infinity;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(screen.matrixWorld).project(camera);
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.max(top, point.y); bottom = Math.min(bottom, point.y);
  }
  const rect = canvas.getBoundingClientRect();
  unityDemo.resize({ left: rect.left + (left + 1) * rect.width / 2, top: rect.top + (1 - top) * rect.height / 2,
    width: (right - left) * rect.width / 2, height: (top - bottom) * rect.height / 2 });
}

function playDemo() {
  if (mode !== 'tv' || !tvMenu?.detail || !tvMenu.current?.demo) return;
  if (!unityDemo.open(tvMenu.current.demo)) return;
  screen.material.color.setHex(0x000000);
  setMode('tv-demo');
  resize();
}

function interact(target = findInteraction()) {
  if (!target) return;
  if (target.id === 'tv') enterTV();
  else if (target.id === 'blind') openBlindControls();
  else if (target.id === 'lamp') {
    const state = environmentMoodController().toggle(environmentDate());
    applyMoodLamp(state);
    roomAudio.play('switch');
    notice((state.on ? '무드등을 켰습니다.' : '무드등을 껐습니다.') + (review?.state.fixedTime != null
      ? ' 검수 시각을 바꾸면 자동 상태로 돌아갑니다.' : ' 다음 일출·일몰 전환까지 유지됩니다.'));
  } else if ((target.id === 'ceiling-light' || target.id === 'ceiling-switch') && ceilingLamp) {
    const on = ceilingLamp.toggle();
    windowLight.shadow.needsUpdate = true;
    roomAudio.play('switch');
    texelSplat?.invalidate();
    notice(on ? '천장등을 켰습니다.' : '천장등을 껐습니다.');
  }
}

function hitTV(clientX, clientY) {
  const bounds = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2);
  camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(screen, false)[0];
  if (hit?.uv) tvMenu.hit(hit.uv.x, hit.uv.y);
}
function tapCanvas(clientX, clientY) {
  if (mode === 'tv') { hitTV(clientX, clientY); return; }
  if (mode !== 'explore') return;
  const bounds = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2);
  camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera);
  const result = touchInteraction(raycaster, targets, meshes, owners, Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 44 / bounds.height);
  if (result?.inRange) interact(result.target);
  else if (result) notice('왼쪽 스틱으로 조금 더 가까이 이동한 뒤 터치해 주세요.');
}

function chooseGame() { if (mode === 'tv') tvMenu.choose(); }
function backFromTV() { if (mode === 'tv' && tvMenu.back()) return; exitTV(); }
function syncTexelOption() {
  $('#render-options').hidden = mode === 'tv-demo';
  texelToggle.checked = Boolean(texelSplat?.state.enabled);
  texelToggle.disabled = !texelSplat?.supported || ['loading', 'error'].includes(mode);
  if (texelSplat && !texelSplat.supported) $('#render-options').title = '이 기기에서는 기본 3D 화면으로 표시합니다.';
}
function setTexelOption(enabled) {
  if (texelToggle.disabled) return;
  texelSplat.setEnabled(enabled);
  try { localStorage.setItem(texelSettingKey, enabled ? '1' : '0'); } catch { /* 저장이 제한되어도 현재 선택은 적용한다. */ }
  const currentURL = new URL(location.href);
  if (['texel', 'original'].includes(currentURL.searchParams.get('render'))) {
    currentURL.searchParams.delete('render');
    history.replaceState(history.state, '', currentURL);
  }
  syncTexelOption();
}
texelToggle.addEventListener('change', () => setTexelOption(texelToggle.checked));
$('#tv-previous').addEventListener('click', () => tvMenu?.detail ? tvMenu.turnDetail(-1) : tvMenu?.select(-1));
$('#tv-next').addEventListener('click', () => tvMenu?.detail ? tvMenu.turnDetail(1) : tvMenu?.select(1));
$('#tv-choose').addEventListener('click', chooseGame);
$('#tv-demo').addEventListener('click', playDemo);
$('#tv-back').addEventListener('click', backFromTV);

document.addEventListener('keydown', event => {
  if (mode === 'tv-demo') return;
  if (graphicsHelp.open) return;
  if (blindDialog.open) {
    if (event.code === 'Escape') { event.preventDefault(); closeBlindControls(); }
    return;
  }
  if (event.target.closest?.('#environment-review, #view-settings')) return;
  if (event.target !== texelToggle && event.target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  if (['Enter', 'Space'].includes(event.code) && event.target.closest?.('a, button, summary')) return;
  if (event.code === 'KeyT' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!event.repeat) setTexelOption(!texelToggle.checked);
    return;
  }
  if (event.target === texelToggle) return;
  if (event.code === 'Escape') {
    if (mode.startsWith('tv')) { event.preventDefault(); backFromTV(); }
    else if (mode === 'explore') pauseRoom();
    return;
  }
  if (mode === 'explore') {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) { keys.add(event.code); event.preventDefault(); }
    if (['KeyF', 'Space'].includes(event.code)) { event.preventDefault(); if (!event.repeat) interact(); }
  } else if (mode === 'tv') {
    const previous = ['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA'].includes(event.code);
    const next = ['ArrowDown', 'ArrowRight', 'KeyS', 'KeyD'].includes(event.code);
    const choose = ['Enter', 'KeyF', 'Space'].includes(event.code);
    if (previous || next || choose) event.preventDefault();
    if (event.repeat) return;
    if (tvMenu.detail && ['PageUp', 'PageDown'].includes(event.code)) { event.preventDefault(); tvMenu.scrollDetail(event.code === 'PageUp' ? -4 : 4); }
    else if (tvMenu.detail && tvMenu.detailPageCount > 1 && ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) tvMenu.turnDetail(previous ? -1 : 1);
    else if (previous) tvMenu.select(-1);
    else if (next) tvMenu.select(1);
    else if (choose) chooseGame();
    if (previous || next) canvas.focus({ preventScroll: true });
  } else if (mode.startsWith('tv') && event.code === 'Space') event.preventDefault();
});
document.addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => { keys.clear(); touchControls.cancel(); pauseRoom(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); touchControls.cancel(); pauseRoom(); } });

canvas.addEventListener('pointerdown', event => {
  if (touchMode) return;
  if (event.button !== 0) return;
  if ((mode === 'explore' || mode === 'blind') && !mouseLocked) {
    dragging = true;
    lastMouse = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
    if (mode === 'explore') lockMouse();
  } else if (mode === 'tv') {
    hitTV(event.clientX, event.clientY);
  }
});
addEventListener('pointerup', () => { dragging = false; lastMouse = null; });
addEventListener('pointercancel', () => { dragging = false; lastMouse = null; });
document.addEventListener('mousemove', event => {
  if (touchMode) return;
  if ((mode !== 'explore' && mode !== 'blind') || (!mouseLocked && !dragging)) return;
  const dx = mouseLocked ? event.movementX : event.clientX - (lastMouse?.x ?? event.clientX);
  const dy = mouseLocked ? event.movementY : event.clientY - (lastMouse?.y ?? event.clientY);
  lastMouse = { x: event.clientX, y: event.clientY };
  rotateView(dx, dy);
});

function rotateView(dx, dy, touch = false) {
  const speed = touch ? 2.1 / Math.max(240, Math.min(canvas.clientWidth, canvas.clientHeight)) : 0.0023;
  yaw -= dx * speed * mouseSensitivity;
  pitch = THREE.MathUtils.clamp(pitch - dy * speed * mouseSensitivity, -1.30, 1.30);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  graphicsHelp.unavailable();
  renderer?.setAnimationLoop(null);
  fatal('그래픽 연결이 중단되었습니다. 새로고침해서 방을 다시 열어 주세요.');
});

if (renderer) {
  const modelUrl = new URL('./assets/room.glb', import.meta.url);
  description.textContent = roomDownloadText({ loaded: 0, total: null });
  fetch(modelUrl)
    .then(response => readGlbResponse(response, progress => {
      if (mode !== 'loading') return;
      const text = roomDownloadText(progress);
      if (description.textContent !== text) description.textContent = text;
    }))
    .then(buffer => {
      if (mode === 'error') return null;
      description.textContent = '모델과 텍스처를 준비하는 중…';
      return new GLTFLoader().parseAsync(buffer, new URL('.', modelUrl).href);
    })
    .then(gltf => {
    if (!gltf || mode === 'error') return;
    try {
      root = gltf.scene;
      scene.add(root);
      root.updateMatrixWorld(true);
      root.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = !object.name.includes('통유리');
        object.receiveShadow = true;
      });
      const bindings = bindRoom(root);
      ({ screen, fabric, bottomBar, owners } = bindings);
      meshes.push(...bindings.meshes);
      targets.push(...bindings.targets);
      interactionOutline.setTargets(targets, root);
      obstacles.push(...bindings.obstacles);
      moodLamp = createMoodLight(bindings.lampShade);
      scene.add(moodLamp.light);
      ceilingLamp = createCeilingLight(bindings.ceilingDiffuser, bindings.switchButton);
      scene.add(ceilingLamp.light);
      applyMoodLamp();
      const screenCenter = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3());
      tvLight.position.copy(screenCenter).addScaledVector(screenDirection(), 0.15);
      const menuCanvas = document.createElement('canvas');
      menuCanvas.width = 768;
      menuCanvas.height = 720;
      const texture = new THREE.CanvasTexture(menuCanvas);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      screen.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      tvMenu = createTVMenu(menuCanvas, () => { texture.needsUpdate = true; refreshTVControls(); }, undefined, kind => roomAudio.play(kind), playDemo);
      tvMenu.setActive(false);
      texelSplat.bindScene([screen]);
      applyBlind();
      description.textContent = roomInstructions();
      enterButton.textContent = '방 둘러보기';
      enterButton.disabled = false;
      setMode('ready');
      if (!texelSplat.supported) notice('이 기기에서는 기본 3D 화면으로 표시합니다. 이동과 상호작용은 그대로 사용할 수 있습니다.');
    } catch (error) { fatal('방의 구성을 준비하지 못했습니다. 새로고침해 주세요.', error); }
  }, error => fatal('방 모델을 불러오지 못했습니다. 새로고침해 주세요.', error));

  renderer.setAnimationLoop(time => {
    if (document.hidden) return;
    if (mode === 'tv-demo') {
      previousTime = time;
      if (resizeFramePending) { texelSplat.render(time / 1000); resizeFramePending = false; }
      return;
    }
    // 도움말을 읽는 동안에는 무거운 3D 그리기를 멈춰 안내 조작이 밀리지 않게 한다.
    if (graphicsHelp.open) { previousTime = time; nextRenderAt = time; return; }
    const calibratingQuality = autoQualityEnabled && autoQuality.tick(time);
    const frameLimit = lowPower || mode === 'ready' || mode === 'paused' || mode === 'tv' ? 30 : fpsLimit;
    if (time + 0.25 < nextRenderAt) return;
    // 예정 시각을 누적해 서로 다른 주사율에서도 선택한 평균 프레임을 유지한다.
    // 긴 중단 뒤에는 밀린 프레임을 몰아 그리지 않고 새 간격으로 시작한다.
    nextRenderAt += 1000 / frameLimit;
    if (nextRenderAt <= time + 0.25) nextRenderAt = time + 1000 / frameLimit;
    const frameMs = Math.max(0, time - previousTime);
    graphicsHelp.sampleFrame(frameMs, mode === 'explore');
    const seconds = Math.min(0.05, frameMs / 1000);
    previousTime = time;
    if (time >= nextMoodCheck) {
      applyEnvironmentTime();
      review?.refresh();
      nextMoodCheck = time + 1000;
    }
    if (mode === 'explore') {
      const delta = movementInput(Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touchControls.movement.forward,
        Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touchControls.movement.right, yaw, frameMs / 1000);
      const moved = moveCircle(camera.position, delta, obstacles);
      camera.position.set(moved.x, PLAYER_HEIGHT, moved.z);
      const next = touchMode ? null : findInteraction();
      let action = next?.label || '';
      if (next?.id === 'blind') action = '블라인드 높이 조절';
      if (next?.id === 'lamp') action = moodLampOn ? '무드등 끄기' : '무드등 켜기';
      if (next?.id === 'ceiling-light' || next?.id === 'ceiling-switch') action = ceilingLamp?.on ? '천장등 끄기' : '천장등 켜기';
      const label = action ? 'F / Space · ' + action : '';
      if (actionPrompt.textContent !== label) actionPrompt.textContent = label;
      actionPrompt.hidden = !next;
    }
    if (cameraTween) {
      const tween = cameraTween;
      const t = (time - tween.start) / tween.duration;
      const value = easeInOut(t);
      camera.position.lerpVectors(tween.fromPosition, tween.position, value);
      camera.quaternion.slerpQuaternions(tween.fromQuaternion, tween.quaternion, value);
      camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.fov, value);
      camera.updateProjectionMatrix();
      if (t >= 1) { cameraTween = null; tween.done(); }
    }
    const blindMoving = Math.abs(openingTarget - opening) > 0.0001;
    if (blindMoving) {
      const step = reducedMotion ? 1 : seconds * 0.9;
      opening += Math.sign(openingTarget - opening) * Math.min(step, Math.abs(openingTarget - opening));
      applyBlind();
    }
    const listener = explorationPose && mode.startsWith('tv') ? explorationPose.position : camera.position;
    roomAudio.update(effectiveWeather, effectiveTraffic, Math.hypot(listener.x, listener.z + 1.82), opening, blindMoving, time);
    exterior.update(reducedMotion ? 0 : seconds);
    const ambientMotion = !reducedMotion && opening > 0.02 && mode !== 'loading' && mode !== 'error' && !mode.startsWith('tv');
    if (streetLife.setFrameState(frameMs, ambientMotion)) {
      notice('성능 여유가 부족해 차량과 보행자를 숨겼습니다.');
      precipitation.setEnabled(false);
    }
    streetLife.update(seconds, camera);
    precipitation.update(seconds, ambientMotion);
    // 주사율 측정 중에도 입력을 처리하고 크기가 바뀐 캔버스에는 한 번 그린다.
    if (calibratingQuality && !resizeFramePending) return;
    if (autoQualityEnabled && mode === 'explore' && !calibratingQuality) {
      if (autoQuality.sample(frameMs, frameLimit)) { resize(); syncAutoQuality(); }
    } else autoQuality.reset();
    texelSplat.render(time / 1000);
    interactionOutline.render(reducedMotion ? 0 : seconds);
    resizeFramePending = false;
  });
}
