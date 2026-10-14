export function isSoftwareRenderer(name) {
  return typeof name === 'string' && /Microsoft Basic Render Driver|SwiftShader|llvmpipe|softpipe|software rasterizer|GDI Generic|\bWARP\b/i.test(name);
}

export function helpBrowser(userAgent = '') {
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent)) return 'other';
  if (/Firefox\//i.test(userAgent)) return 'firefox';
  if (/Chrome\//i.test(userAgent) && !/Edg\/|OPR\//i.test(userAgent)) return 'chrome';
  return 'other';
}

export function createFrameMonitor() {
  let warmup = 0, elapsed = 0, frames = 0;
  return {
    sample(frameMs, active) {
      if (!active || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 5000) {
        warmup = elapsed = frames = 0;
        return null;
      }
      if (warmup < 3000) { warmup += frameMs; return null; }
      elapsed += frameMs; frames++;
      if (elapsed < 6000) return null;
      const fps = frames * 1000 / elapsed;
      elapsed = frames = 0;
      return { fps, slow: fps < 20 };
    }
  };
}

export function mountGraphicsHelp({ onOpen, onContinue, onLowPower }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#graphics-help');
  const banner = $('#graphics-warning');
  const entryWarning = $('#graphics-entry-warning');
  const browserSelect = $('#graphics-browser');
  const monitor = createFrameMonitor();
  let mode = 'loading', reason = '', dismissed = false, rendererName = '', fps = null;

  function update() {
    const message = reason === 'software' ? '소프트웨어 그래픽 처리가 감지됐습니다. 화면이 느리면 그래픽 가속 설정을 확인해 주세요.'
      : reason === 'slow' ? '낮은 프레임이 계속되고 있습니다. 화면 설정과 브라우저 도움말을 확인해 보세요.'
      : reason === 'unavailable' ? '3D 화면을 시작하거나 유지하지 못했습니다. 브라우저의 그래픽 설정을 확인해 주세요.' : '';
    for (const element of [$('#graphics-warning-message'), entryWarning]) {
      if (element.textContent !== message) element.textContent = message;
    }
    entryWarning.hidden = !message;
    banner.hidden = !reason || dismissed || mode !== 'explore' || dialog.open;
    $('#graphics-help-summary').textContent = message || '화면이 끊기거나 움직임이 느릴 때 아래 순서로 확인해 보세요.';
    $('#graphics-renderer').textContent = rendererName || '브라우저에서 그래픽 장치 정보를 제공하지 않았습니다.';
    $('#graphics-fps').textContent = fps == null ? '둘러보는 동안 측정합니다.' : Math.round(fps) + ' FPS · 최근 6초 평균';
    const unavailable = mode === 'error' || mode === 'loading';
    $('#graphics-continue').disabled = unavailable;
    $('#graphics-low-power').disabled = unavailable;
  }
  function showBrowser() {
    for (const section of dialog.querySelectorAll('[data-browser-guide]')) section.hidden = section.dataset.browserGuide !== browserSelect.value;
  }
  function open() {
    if (dialog.open) return;
    dismissed = true;
    onOpen();
    update();
    dialog.showModal();
    $('#graphics-help-close').focus();
  }
  function close() { dialog.close(); }
  browserSelect.value = helpBrowser(navigator.userAgent);
  for (const section of dialog.querySelectorAll('[data-windows-guide]')) section.hidden = !/Windows/i.test(navigator.userAgent);
  showBrowser();
  browserSelect.addEventListener('change', showBrowser);
  for (const button of document.querySelectorAll('[data-graphics-help]')) button.addEventListener('click', open);
  $('#graphics-dismiss').addEventListener('click', () => { dismissed = true; update(); });
  $('#graphics-help-close').addEventListener('click', close);
  dialog.addEventListener('close', update);
  $('#graphics-continue').addEventListener('click', () => { close(); onContinue(); });
  $('#graphics-low-power').addEventListener('click', () => { close(); onLowPower(); });
  for (const button of dialog.querySelectorAll('[data-copy-address]')) {
    button.addEventListener('click', async () => {
      const input = document.getElementById(button.dataset.copyAddress);
      try {
        if (!navigator.clipboard?.writeText) throw new Error('주소 직접 복사');
        await navigator.clipboard.writeText(input.value);
        $('#graphics-copy-status').textContent = '주소를 복사했습니다. 브라우저 주소창에 붙여 넣어 주세요.';
      } catch {
        input.focus(); input.select();
        $('#graphics-copy-status').textContent = '주소를 선택했습니다. 직접 복사한 뒤 주소창에 붙여 넣어 주세요.';
      }
    });
  }
  update();
  return {
    get open() { return dialog.open; },
    setMode(value) { mode = value; monitor.sample(0, false); update(); },
    setRenderer(gl) {
      try {
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        rendererName = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '').slice(0,300) : '';
      } catch { rendererName = ''; }
      if (isSoftwareRenderer(rendererName)) reason = 'software';
      else if (reason === 'software') reason = '';
      update();
    },
    unavailable() { reason = 'unavailable'; update(); },
    sampleFrame(frameMs, active) {
      const result = monitor.sample(frameMs, active && !document.hidden && !dialog.open);
      if (!result) return;
      fps = result.fps;
      if (result.slow && !reason) reason = 'slow';
      else if (!result.slow && reason === 'slow') reason = '';
      update();
    }
  };
}
