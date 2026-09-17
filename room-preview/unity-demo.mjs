export function createUnityDemo(dialog, onClose) {
  const screen = dialog.querySelector('.demo-screen');
  const message = dialog.querySelector('#demo-status');
  const retry = dialog.querySelector('#demo-retry');
  const exit = dialog.querySelector('#demo-exit');
  let session = null;

  function load() {
    session.frame?.remove();
    session.ready = false;
    retry.hidden = true;
    message.hidden = false;
    message.textContent = '데모를 불러오는 중… 0%';
    const frame = document.createElement('iframe');
    frame.title = 'FastPop 데모 게임';
    frame.src = session.url;
    frame.allow = 'autoplay';
    frame.addEventListener('load', () => {
      if (session?.frame !== frame || session.closing) return;
      if (!frame.contentDocument?.querySelector('#unity-canvas')) {
        message.textContent = '게임 페이지를 불러오지 못했습니다. 다시 시도해 주세요.';
        retry.hidden = false;
      }
      frame.focus();
    });
    session.frame = frame;
    screen.prepend(frame);
  }

  async function close() {
    const current = session;
    if (!current || current.closing) return;
    current.closing = true;
    exit.disabled = true;
    retry.hidden = true;
    message.hidden = false;
    message.textContent = '게임을 종료하는 중…';
    if (current.ready) {
      // 정상 종료를 기다리되 응답이 멎어도 프레임 제거로 방에 복귀할 수 있다.
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 2000);
        current.onQuit = () => { clearTimeout(timeout); resolve(); };
        current.frame.contentWindow.postMessage({ type: 'demo-quit' }, location.origin);
      });
    }
    current.frame?.remove();
    session = null;
    dialog.close();
    exit.disabled = false;
    onClose();
  }

  addEventListener('message', event => {
    if (!session || event.origin !== location.origin || event.source !== session.frame?.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'demo-closed') { session.onQuit?.(); return; }
    if (session.closing) return;
    if (data.type === 'demo-exit') { void close(); return; }
    if (data.type === 'demo-ready') {
      session.ready = true;
      message.hidden = true;
      session.frame.focus();
    } else if (data.type === 'demo-progress' && Number.isFinite(data.progress)) {
      message.textContent = '데모를 불러오는 중… ' + Math.round(Math.max(0, Math.min(0.99, data.progress)) * 100) + '%';
    } else if (data.type === 'demo-error') {
      message.hidden = false;
      message.textContent = '데모를 불러오지 못했습니다. 다시 시도하거나 메뉴로 돌아가 주세요.';
      retry.hidden = false;
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); });
  exit.addEventListener('click', () => { void close(); });
  retry.addEventListener('click', () => { if (session && !session.closing) load(); });

  return {
    open(url) {
      if (session) return false;
      const target = new URL(url, location.href);
      if (target.origin !== location.origin || !['http:', 'https:'].includes(target.protocol)) return false;
      session = { url: target.href, ready: false, closing: false };
      dialog.showModal();
      load();
      exit.focus();
      return true;
    },
    resize({ left, top, width, height }) {
      Object.assign(screen.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
      // 캔버스 자체의 크기도 세로 비율과 일치시켜 터치 좌표가 어긋나지 않게 한다.
      screen.style.setProperty('--game-height', Math.min(height, width * 960 / 600) + 'px');
    },
    close
  };
}
