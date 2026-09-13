import { Box3, PointLight, Vector3 } from 'three';
import { getTimes } from './vendor/suncalc/index.js';

const seoulDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY = 86400000;

export function seoulDaylight(date, calculateTimes = getTimes) {
  const day = seoulDate.format(date);
  const midnight = Date.parse(day + 'T00:00:00+09:00');
  try {
    // 방문자의 시간대와 무관하게 서울의 해당 날짜 정오를 계산 기준으로 삼는다.
    const times = calculateTimes(new Date(day + 'T12:00:00+09:00'), 37.5665, 126.9780);
    const sunrise = times.sunrise?.getTime();
    const sunset = times.sunset?.getTime();
    if (Number.isFinite(sunrise) && Number.isFinite(sunset) && midnight < sunrise && sunrise < sunset && sunset < midnight + DAY) {
      return { sunrise, sunset, source: 'solar' };
    }
  } catch {
    // 일출·일몰 값을 사용할 수 없으면 사용자가 정한 서울 시간 18시~06시를 적용한다.
  }
  return { sunrise: midnight + 6 * 3600000, sunset: midnight + 18 * 3600000, source: 'fixed' };
}

export function createMoodLightController(calculateTimes = getTimes) {
  let day;
  let today;
  let tomorrow;
  let manual = null;
  function read(date = new Date()) {
    const nextDay = seoulDate.format(date);
    if (day !== nextDay) {
      day = nextDay;
      today = seoulDaylight(date, calculateTimes);
      tomorrow = seoulDaylight(new Date(Date.parse(day + 'T12:00:00+09:00') + DAY), calculateTimes);
    }
    const now = date.getTime();
    if (manual && now >= manual.until) manual = null;
    const night = now < today.sunrise || now >= today.sunset;
    const nextChange = now < today.sunrise ? today.sunrise : now < today.sunset ? today.sunset : tomorrow.sunrise;
    return { on: manual ? manual.on : night, automatic: manual === null, nextChange, source: today.source };
  }
  return {
    read,
    toggle(date = new Date()) {
      const current = read(date);
      manual = { on: !current.on, until: current.nextChange };
      return read(date);
    }
  };
}

export function createMoodLight(shade) {
  shade.material = shade.material.clone();
  shade.material.emissive.set('#ffbd75');
  shade.material.emissiveIntensity = 0;
  // 갓을 통과해 퍼지는 빛을 표현하되 주변 가구의 그림자는 유지한다.
  shade.castShadow = false;
  const light = new PointLight(0xffb66b, 0, 2.8, 2);
  light.position.copy(new Box3().setFromObject(shade).getCenter(new Vector3()));
  light.castShadow = true;
  light.shadow.mapSize.set(256, 256);
  light.shadow.camera.near = 0.03;
  light.shadow.camera.far = 2.8;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -0.0003;
  // 가까운 벽이 자기 그림자로 잘못 가려져 사각 경계가 생기지 않도록 5mm 보정한다.
  light.shadow.normalBias = 0.005;
  // 무드등 주변 가구는 고정되어 있어 최초 생성과 점등 때만 그림자를 갱신한다.
  light.shadow.autoUpdate = false;
  // 소등 상태로 시작해도 셰이더가 참조할 깊이 텍스처를 첫 렌더에서 생성한다.
  light.shadow.needsUpdate = true;
  return {
    light,
    setOn(on) {
      light.intensity = on ? 1.8 : 0;
      shade.material.emissiveIntensity = on ? 0.9 : 0;
      if (on) light.shadow.needsUpdate = true;
    }
  };
}
