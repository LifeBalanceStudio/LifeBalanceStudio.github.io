export const CAR_GAP = 3.25;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// 진행 거리만 계산하는 작은 차량 풀이다. 양방향을 연결한 기존 왕복 경로를 그대로 쓴다.
export function createTrafficFlow({ length, capacity, gates, near = 0, far = 0, cruise = 4.2 }) {
  const positions = new Float64Array(capacity), speeds = new Float64Array(capacity);
  const active = new Uint8Array(capacity), nextSpeeds = new Float64Array(capacity), reactions = new Float64Array(capacity);
  const weights = new Float64Array(256);
  let targetCount = 3, targetRush = 0, rush = 0, targetReverse = 0, reverseRush = 0, clock = 0, started = false;
  const wrap = distance => ((distance % length) + length) % length;
  function relief(distance) {
    return far > near ? smooth((Math.min(distance, length - distance) - near) / (far - near)) : 0;
  }
  function spacing(index, distance, behind = false) {
    let nearest = length;
    for (let other = 0; other < capacity; other++) {
      if (other === index || !active[other]) continue;
      const gap = wrap(behind ? distance - positions[other] : positions[other] - distance);
      nearest = Math.min(nearest, gap);
    }
    return nearest;
  }
  function seed() {
    // 처음부터 정체 구간 주변에 조금 더 모여 있게 배치한다. 이후에는 앞차를 따라 이동한다.
    const bins = weights.length, step = length / bins;
    let total = 0;
    for (let bin = 0; bin < bins; bin++) {
      const distance = (bin + 0.5) * step;
      let weight = 1;
      for (let gateIndex = 0; gateIndex < gates.length; gateIndex++) {
        const gate = gates[gateIndex];
        const upstream = wrap(gate - distance);
        if (upstream < 44) weight += (gateIndex ? reverseRush : rush) * 10 * (1 - upstream / 70);
      }
      total += weight; weights[bin] = total;
    }
    active.fill(0); reactions.fill(0);
    for (let i = 0; i < capacity; i++) {
      speeds[i] = cruise;
      if (i >= targetCount) { positions[i] = (i + 0.31) / capacity * length; continue; }
      const quantile = (i + 0.5) / targetCount * total;
      let bin = 0; while (bin < bins - 1 && weights[bin] < quantile) bin++;
      const previous = bin ? weights[bin - 1] : 0;
      positions[i] = (bin + (quantile - previous) / (weights[bin] - previous)) * step;
      active[i] = 1;
    }
  }
  function setTarget(count, strength = 0, reverseStrength = strength) {
    if (!Number.isFinite(count) || !Number.isFinite(strength) || !Number.isFinite(reverseStrength)) return;
    targetCount = Math.max(1, Math.min(capacity, Math.round(count)));
    targetRush = clamp(strength);
    targetReverse = clamp(reverseStrength);
    if (!started) { rush = targetRush; reverseRush = targetReverse; seed(); }
  }
  function update(seconds, canToggle = null) {
    const dt = Math.max(0, Math.min(0.05, seconds));
    if (dt > 0) started = true;
    clock += dt;
    rush += (targetRush - rush) * (1 - Math.exp(-dt / 3));
    reverseRush += (targetReverse - reverseRush) * (1 - Math.exp(-dt / 3));
    let count = 0;
    for (let i = 0; i < capacity; i++) count += active[i];
    for (let i = capacity - 1; i >= 0; i--) {
      if (active[i] && count > targetCount && (!canToggle || canToggle(positions[i]))) { active[i] = 0; count--; }
    }
    for (let i = 0; i < capacity; i++) {
      if (active[i]) continue;
      positions[i] = wrap(positions[i] + cruise * dt);
      if (count >= targetCount || (canToggle && !canToggle(positions[i]))) continue;
      if (spacing(i, positions[i]) > CAR_GAP * 2 && spacing(i, positions[i], true) > CAR_GAP * 2) {
        active[i] = 1; speeds[i] = 0; reactions[i] = 0.4; count++;
      }
    }
    // 모든 속도는 같은 이전 프레임 위치에서 계산해 갱신 순서에 따른 추월을 막는다.
    for (let i = 0; i < capacity; i++) {
      if (!active[i]) continue;
      const distance = positions[i], gap = spacing(i, distance);
      const directionRush = distance < length / 2 ? rush : reverseRush;
      const freeSpeed = cruise * (1 - directionRush * 0.58 * (1 - relief(distance)));
      let desired = freeSpeed;
      for (let gateIndex = 0; gateIndex < gates.length; gateIndex++) {
        const untilGate = wrap(gates[gateIndex] - distance);
        const gateRush = gateIndex ? reverseRush : rush;
        const phase = (clock + gateIndex * 3.7) % 14;
        if (phase < 5 || phase > 8.6) {
          const stopping = Math.min(freeSpeed, Math.max(0, untilGate - 0.2) / 1.2);
          desired = Math.min(desired, freeSpeed * (1 - gateRush) + stopping * gateRush);
        }
      }
      desired = Math.min(desired, Math.max(0, gap - CAR_GAP) / 1.15);
      // 앞차가 공간을 만든 뒤 잠시 반응하고 출발해 뒤쪽으로 출발이 전달되게 한다.
      if (desired < 0.08) reactions[i] = 0.45 + (i % 3) * 0.08;
      else if (speeds[i] < 0.08 && reactions[i] > 0) { reactions[i] = Math.max(0, reactions[i] - dt); desired = 0; }
      const acceleration = desired > speeds[i] ? 1.05 : 3.4;
      const change = Math.max(-acceleration * dt, Math.min(acceleration * dt, desired - speeds[i]));
      nextSpeeds[i] = Math.max(0, Math.min(speeds[i] + change, dt > 0 ? Math.max(0, gap - CAR_GAP) / dt : speeds[i]));
    }
    for (let i = 0; i < capacity; i++) if (active[i]) {
      speeds[i] = nextSpeeds[i]; positions[i] = wrap(positions[i] + speeds[i] * dt);
    }
  }
  seed();
  return { positions, speeds, active, setTarget, update, relief,
    reset(count, strength = 0, reverseStrength = strength) { started = false; clock = 0; setTarget(count, strength, reverseStrength); },
    get state() { return { target: targetCount, active: active.reduce((sum, value) => sum + value, 0), rush, reverseRush, capacity }; } };
}
