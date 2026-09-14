export const games = [
  {
    title: 'Uncap',
    description: '위쪽·오른쪽 슬라이드로 병뚜껑을 여는 게임입니다.\n제한 시간 안에 더 많은 병을 열어 기록에 도전하세요.',
    details: ['개발 기간 2025.08.05~2025.09.01', 'Unity 6 · C# · Android'],
    features: [
      { title: '드래그 입력 대상 고정', description: '손을 뗄 때까지 같은 병을 조작해\n새 병으로 입력이 이어지지 않게 합니다.' },
      { title: '조작에서 물리 연출로', description: '조작 중에는 뚜껑을 직접 움직이고\n개봉 순간 물리 힘으로 튕겨냅니다.' },
      { title: '병 오브젝트 재사용', description: '사용한 병의 상태를 초기화해\n다음 등장에 다시 사용합니다.' }
    ],
    image: './assets/uncap.png', url: 'https://play.google.com/store/apps/details?id=com.LifeBalance.Uncap'
  },
  {
    title: 'Fast Pop!!',
    description: '빠르게 나타나는 물방울을 터뜨리는 게임입니다.\n일반·엔드리스 모드에서 높은 기록에 도전하세요.',
    details: ['개발 기간 2025.09.01~2025.10.22', 'Unity 6 · C# · Android'],
    features: [
      { title: '데이터 기반 난이도와 패턴', description: '난이도와 생성 간격을 데이터로 조절하고\n여러 물방울 패턴을 만들어 냅니다.' },
      { title: '피버·황금 러시', description: '적중으로 피버 게이지를 채우고\n황금 별을 누르면 황금 러시가 시작됩니다.' },
      { title: '물방울 표현과 풀링', description: '셰이더로 물방울의 움직임을 표현하고\n풀링으로 사용한 오브젝트를 재사용합니다.' }
    ],
    image: './assets/fastpop.png', url: 'https://play.google.com/store/apps/details?id=com.LifeBalance.FastPop'
  },
  { title: 'PachiPachi', description: '공을 조작하며 여러 보상을 얻는 캐주얼 게임입니다.', image: './assets/pachipachi.png', url: '', status: '준비 중' },
  { title: '개발 중인 게임', description: '메시지를 담은 다음 게임을 준비하고 있습니다.', image: './assets/questionmark.png', url: '', status: '준비 중' }
];

export const MENU_PAGE_SIZE = 10;
export const MENU_WIDTH = 256;
export const MENU_HEIGHT = 240;

export function createTVMenu(canvas, onChange, items = games, onSound = () => {}) {
  const context = canvas.getContext('2d');
  let active = false;
  let stage = 'pages';
  let page = 0;
  let row = 0;
  let detailPage = 0;
  let detailScroll = 0;
  let detailLines = [];
  const hitAreas = [];
  const pageCount = Math.max(1, Math.ceil(items.length / MENU_PAGE_SIZE));
  const entries = () => items.slice(page * MENU_PAGE_SIZE, (page + 1) * MENU_PAGE_SIZE);
  const current = () => stage === 'pages' ? null : entries()[row] || null;
  const hasFeatures = () => Boolean(current()?.features?.length);
  const introduction = () => [current()?.description || '설명을 준비하고 있습니다.', '', '개인 프로젝트 · 1인 개발', ...(current()?.details || [])].join('\n');
  const font = text => /[^\x00-\x7f]/.test(text) ? '6px "Galmuri11", monospace' : '8px "NESMenu", monospace';

  function text(value, x, y, align = 'left', color = '#ffffff') {
    context.font = font(value);
    context.textAlign = align;
    context.textBaseline = 'top';
    context.fillStyle = color;
    context.fillText(value, x, y);
  }

  function fit(value, width) {
    context.font = font(value);
    if (context.measureText(value).width <= width) return value;
    const chars = Array.from(value);
    while (chars.length && context.measureText(chars.join('') + '..').width > width) chars.pop();
    return chars.join('') + '..';
  }

  function wrap(value, width) {
    context.font = '6px "Galmuri11", monospace';
    const lines = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? line + ' ' + word : word;
        if (context.measureText(candidate).width <= width) { line = candidate; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const character of word) {
          if (line && context.measureText(line + character).width > width) { lines.push(line); line = ''; }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function border() {
    context.fillStyle = '#0000b4';
    context.fillRect(0, 0, MENU_WIDTH, MENU_HEIGHT);
    context.fillStyle = '#000000';
    context.fillRect(0, 0, 8, MENU_HEIGHT);
    context.fillRect(248, 0, 8, MENU_HEIGHT);
    context.fillRect(0, 0, MENU_WIDTH, 8);
    context.fillRect(0, 232, MENU_WIDTH, 8);
    // 원본에서 확인한 벽돌 테두리의 색과 반복 간격을 UI 도형으로 재구성한다.
    for (let y = 8; y < 232; y += 4) {
      for (let x = 8; x < 248; x += 8) {
        if (y >= 24 && y < 224 && x >= 32 && x < 232) continue;
        const offset = ((y / 4) % 2) * 4;
        const start = Math.max(8, x - offset);
        const width = Math.min(7, 247 - start);
        context.fillStyle = '#ff6d47';
        context.fillRect(start, y, width, 3);
        context.fillStyle = '#ffffff';
        context.fillRect(start, y, width, 1);
        context.fillRect(start, y, 1, 3);
      }
    }
    if (stage === 'pages') {
      context.fillStyle = '#f7b400';
      context.fillRect(32, 14, 200, 1);
      for (let x = 34; x < 232; x += 4) context.fillRect(x, 15, 1, 8);
    }
  }

  function cursor(x, y) {
    context.fillStyle = '#ffffff';
    context.fillRect(x, y + 3, 6, 2);
  }

  function draw() {
    context.setTransform(canvas.width / MENU_WIDTH, 0, 0, canvas.height / MENU_HEIGHT, 0, 0);
    context.imageSmoothingEnabled = false;
    hitAreas.length = 0;
    border();
    if (stage === 'pages') {
      text('게임 포트폴리오', 132, 43, 'center');
      const first = Math.floor(page / 8) * 8;
      for (let index = first; index < Math.min(first + 8, pageCount); index++) {
        const y = 72 + (index - first) * 16;
        if (index === page) cursor(64, y);
        text('PAGE.' + (index + 1), 88, y);
        hitAreas.push({ x: 56, y: y - 2, width: 144, height: 16, page: index });
      }
      text('LIFEBALANCE STUDIO', 132, 207, 'center');
    } else if (stage === 'games') {
      text('PAGE.' + (page + 1), 132, 32, 'center');
      const list = entries();
      if (!list.length) text('등록된 게임이 없습니다.', 132, 95, 'center');
      list.forEach((game, index) => {
        const y = 49 + index * 16;
        if (index === row) cursor(44, y);
        text(String(index + 1) + '.', 57, y);
        text(fit(game.title, 143), 81, y);
        hitAreas.push({ x: 40, y: y - 2, width: 188, height: 16, row: index });
      });
      text('Esc 페이지 목록', 132, 211, 'center');
    } else {
      const game = current();
      const paged = hasFeatures();
      text(fit(game?.title || '게임 설명', 180), 132, 34, 'center');
      text((detailPage ? '개발 특징' : '게임 소개') + (paged ? ' · ' + (detailPage + 1) + '/2' : ''), 132, 49, 'center', '#f7b400');
      context.fillStyle = '#ffffff';
      context.fillRect(42, 61, 178, 1);
      detailLines = detailPage ? [] : wrap(introduction(), 176);
      detailScroll = Math.min(detailScroll, Math.max(0, detailLines.length - 8));
      if (detailPage) {
        game.features.slice(0, 3).forEach((feature, index) => {
          const y = 73 + index * 37;
          text(fit((index + 1) + '. ' + feature.title, 176), 43, y, 'left', '#f7b400');
          const lines = wrap(feature.description, 176);
          context.fillStyle = '#ffffff';
          lines.slice(0, 2).forEach((line, lineIndex) => context.fillText(line, 43, y + 12 + lineIndex * 10));
        });
      } else {
        context.font = '6px "Galmuri11", monospace';
        context.textAlign = 'left';
        context.fillStyle = '#ffffff';
        detailLines.slice(detailScroll, detailScroll + 8).forEach((line, index) => context.fillText(line, 43, 74 + index * 14));
      }
      if (paged) {
        context.fillStyle = '#f7b400';
        context.fillRect(53, 188, 158, 15);
        context.fillStyle = '#0000b4';
        context.fillRect(54, 189, 156, 13);
        text(detailPage ? '◀ 게임 소개로' : '개발 특징 보기 ▶', 132, 192, 'center');
        hitAreas.push({ x: 53, y: 188, width: 158, height: 15, detail: true });
      }
      text(detailLines.length > 8 ? '위/아래 설명 · Esc 목록' : paged ? '←→ 전환 · Esc 목록' : 'Esc 게임 목록', 132, 213, 'center');
    }
    onChange();
  }

  function turnDetail(offset) {
    if (!active || stage !== 'detail' || !hasFeatures()) return false;
    const previous = detailPage;
    detailPage = (detailPage + offset % 2 + 2) % 2;
    detailScroll = 0;
    draw();
    if (detailPage !== previous) onSound('move');
    return true;
  }

  function choose() {
    if (!active) return false;
    if (stage === 'pages') { stage = 'games'; row = 0; }
    else if (stage === 'games' && current()) { stage = 'detail'; detailPage = 0; detailScroll = 0; }
    else if (stage === 'detail') return turnDetail(1);
    else return false;
    draw();
    onSound('confirm');
    return true;
  }

  const menu = {
    get stage() { return stage; },
    get detail() { return stage === 'detail'; },
    get detailPage() { return detailPage; },
    get detailPageCount() { return hasFeatures() ? 2 : 1; },
    get detailTitle() { return detailPage ? '개발 특징' : '게임 소개'; },
    get detailText() { return detailPage ? current().features.map(feature => feature.title + '\n' + feature.description).join('\n\n') : introduction(); },
    get current() { return current(); },
    get pageCount() { return pageCount; },
    get selectedPage() { return page; },
    get selected() { return page * MENU_PAGE_SIZE + row; },
    get selectableCount() { return stage === 'pages' ? pageCount : stage === 'games' ? entries().length : 0; },
    setActive(value) { active = value; stage = 'pages'; row = 0; detailPage = 0; detailScroll = 0; draw(); },
    select(offset) {
      if (!active) return;
      const previous = [page, row, detailScroll].join(':');
      if (stage === 'pages') page = (page + offset % pageCount + pageCount) % pageCount;
      else if (stage === 'games') {
        const count = entries().length;
        if (count) row = (row + offset % count + count) % count;
      } else detailScroll = Math.max(0, Math.min(detailScroll + offset, detailLines.length - 8));
      draw();
      if (previous !== [page, row, detailScroll].join(':')) onSound('move');
    },
    choose,
    turnDetail,
    back() {
      if (stage === 'detail') { stage = 'games'; detailPage = 0; detailScroll = 0; }
      else if (stage === 'games') stage = 'pages';
      else return false;
      draw();
      onSound('back');
      return true;
    },
    hit(u, v) {
      if (!active) return false;
      const x = u * MENU_WIDTH;
      const y = v * MENU_HEIGHT;
      const hit = hitAreas.find(area => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height);
      if (!hit) return false;
      if (hit.detail) return turnDetail(1);
      if (hit.page !== undefined) page = hit.page;
      if (hit.row !== undefined) row = hit.row;
      return choose();
    },
    draw
  };
  if (typeof document !== 'undefined' && document.fonts) {
    Promise.all([document.fonts.load('8px "NESMenu"'), document.fonts.load('6px "Galmuri11"')]).then(draw).catch(draw);
  }
  return menu;
}
