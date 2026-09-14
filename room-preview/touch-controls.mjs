export function normalizeControlMode(value) {
  return ['auto', 'touch', 'keyboard'].includes(value) ? value : 'auto';
}

export function joystickInput(dx, dy, radius) {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return { forward: 0, right: 0, x: 0, y: 0 };
  const length = Math.hypot(dx, dy);
  const magnitude = Math.min(1, length / radius);
  const movement = Math.max(0, (magnitude - 0.12) / 0.88);
  const x = length ? dx / length : 0, y = length ? dy / length : 0;
  return { forward: -y * movement || 0, right: x * movement || 0, x: x * magnitude * radius, y: y * magnitude * radius };
}

export function createTouchControls({ canvas, container, stick, knob, pauseButton, onLook, onTap, onPause }) {
  const movement = { forward: 0, right: 0 };
  let enabled = false, mode = 'loading', stickPointer = null, look = null;

  function capture(element, id) {
    try { element.setPointerCapture(id); } catch { /* 취소된 포인터나 검사 입력도 안전하게 처리한다. */ }
  }
  function release(element, id) {
    try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* 이미 해제된 입력은 무시한다. */ }
  }
  function stopStick() {
    const id = stickPointer;
    stickPointer = null;
    movement.forward = movement.right = 0;
    knob.style.transform = 'translate(0px, 0px)';
    stick.classList.remove('active');
    if (id !== null) release(stick, id);
  }
  function stopLook() {
    const old = look;
    look = null;
    if (old) release(canvas, old.id);
    return old;
  }
  function cancel() { stopStick(); stopLook(); }
  function sync() { container.hidden = !enabled || mode !== 'explore'; }
  function moveStick(event) {
    const rect = stick.getBoundingClientRect();
    const input = joystickInput(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2,
      Math.max(1, Math.min(rect.width, rect.height) / 2 - 24));
    movement.forward = input.forward; movement.right = input.right;
    knob.style.transform = `translate(${input.x.toFixed(2)}px, ${input.y.toFixed(2)}px)`;
  }
  stick.addEventListener('pointerdown', event => {
    if (!enabled || mode !== 'explore' || stickPointer !== null || event.button !== 0) return;
    event.preventDefault();
    stickPointer = event.pointerId;
    capture(stick, event.pointerId);
    stick.classList.add('active');
    moveStick(event);
  });
  stick.addEventListener('pointermove', event => {
    if (event.pointerId !== stickPointer) return;
    event.preventDefault(); moveStick(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(name, event => {
    if (event.pointerId === stickPointer) stopStick();
  });
  canvas.addEventListener('pointerdown', event => {
    if (!enabled || !['explore', 'blind', 'tv'].includes(mode) || look || event.button !== 0) return;
    event.preventDefault();
    look = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      startTime: event.timeStamp, startMode: mode, moved: false };
    capture(canvas, event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!look || event.pointerId !== look.id) return;
    event.preventDefault();
    const dx = event.clientX - look.x, dy = event.clientY - look.y;
    if (Math.hypot(event.clientX - look.startX, event.clientY - look.startY) > 8) look.moved = true;
    look.x = event.clientX; look.y = event.clientY;
    if (look.moved && (mode === 'explore' || mode === 'blind')) onLook(dx, dy);
  });
  canvas.addEventListener('pointerup', event => {
    if (!look || event.pointerId !== look.id) return;
    event.preventDefault();
    const gesture = stopLook();
    const nearStart = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <= 8;
    if (!gesture.moved && nearStart && event.timeStamp - gesture.startTime <= 500 && gesture.startMode === mode
      && (mode === 'explore' || mode === 'tv') && document.elementFromPoint(event.clientX, event.clientY) === canvas) {
      onTap(event.clientX, event.clientY);
    }
  });
  for (const name of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => {
    if (look?.id === event.pointerId) stopLook();
  });
  canvas.addEventListener('contextmenu', event => { if (enabled) event.preventDefault(); });
  pauseButton.addEventListener('click', onPause);

  return {
    movement, cancel,
    setEnabled(value) { cancel(); enabled = Boolean(value); sync(); },
    setMode(value) { cancel(); mode = value; sync(); },
    get state() { return { enabled, mode, stickPointer, lookPointer: look?.id ?? null, ...movement }; }
  };
}
