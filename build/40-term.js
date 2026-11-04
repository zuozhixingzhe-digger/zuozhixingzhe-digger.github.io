/* ============================================================================
 * HTerMinaL · terminal + windows
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * ==========================================================================*/

/* ---------------------------------------------------------------- xterm 装载 */
const XTERM_CSS = [
  'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css',
  'https://unpkg.com/@xterm/xterm@5.5.0/css/xterm.css'
];
const XTERM_JS = [
  'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js',
  'https://unpkg.com/@xterm/xterm@5.5.0/lib/xterm.js'
];
const FIT_JS = [
  'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js',
  'https://unpkg.com/@xterm/addon-fit@0.10.0/lib/addon-fit.js'
];
/* Unicode 11 宽度表：CJK、emoji、ZWJ 组合按 1/2 格精确计算。
 * 不加载它时 xterm 用旧宽度表，遇到中文/emoji 会把单元格算错，
 * 渲染位置与光标一起累积偏移——正是「输出文字错位」的主因之一。 */
const UNI11_JS = [
  'https://cdn.jsdelivr.net/npm/@xterm/addon-unicode11@0.8.0/lib/addon-unicode11.js',
  'https://unpkg.com/@xterm/addon-unicode11@0.8.0/lib/addon-unicode11.js'
];
/* Canvas 渲染器。xterm 5.5 默认是 DOM 渲染器：它把一行里属性相同的字符塞进
 * 同一个 <span>，浏览器于是会对 span 内的 ZWJ 序列做连字——`👨‍👩‍👧‍👦` 塌成一个
 * 家庭图标、只占 2 格，而 buffer 仍按「每个 emoji 2 格」推进 8 格。
 * 两者一差，光标就停在文字右边好几格的空地上，后面的字也全部左移。
 * canvas 渲染器逐格绘制，不跨格连字，视觉宽度与 cell 严格一致。
 * 非必需：拿不到就留在 DOM 渲染器，功能不受影响（只是 emoji 会再偏回去）。 */
const CANVAS_JS = [
  'https://cdn.jsdelivr.net/npm/@xterm/addon-canvas@0.7.0/lib/addon-canvas.js',
  'https://unpkg.com/@xterm/addon-canvas@0.7.0/lib/addon-canvas.js'
];
/* 加载顺序：DepCache（IndexedDB）→ CDN。
 * 为什么不用 CDN.js：它是 <script src>，每次新标签都要走一次浏览器 HTTP 缓存，
 * 而 HTTP 缓存会被「清除数据」清掉、部分 CDN 还返回 no-store。
 * 自己存一份，第二次打开页面是**零网络请求**，秒开。 */
async function loadOne(list, check, label, onLog, required) {
  if (check()) return true;
  let lastErr = null;
  for (const url of list) {
    try {
      onLog && onLog('加载 ' + label);
      await loadScriptCached(url, onLog);
      if (check()) return true;
      lastErr = new Error(label + ' 已下载但没有注册全局变量');
    } catch (e) { lastErr = e; }
  }
  if (required) throw new Error(label + ' 加载失败：' + (lastErr && lastErr.message || lastErr) + '（检查网络或 CDN）');
  return false;
}

async function loadXterm(onLog) {
  /* 注意这里不能写成「全都齐了就直接 return」：canvas 渲染器是后加的，
   * 老页面（DepCache 里只有 xterm/fit/unicode11）也要补装，所以逐个判断。 */
  if (!window.Terminal) {
    onLog && onLog('准备 xterm.css');
    let cssOk = false;
    for (const u of XTERM_CSS) {
      try { await loadStyleCached(u, onLog); cssOk = true; break; } catch (e) {}
    }
    if (!cssOk) { onLog && onLog('xterm.css 拿不到，用内置最小样式兜底'); injectStyle('@import url("");.xterm{position:relative;user-select:none}.xterm .xterm-viewport{overflow-y:scroll;background:transparent}'); }
  }
  await loadOne(XTERM_JS, () => !!window.Terminal, 'xterm.js', onLog, true);
  await loadOne(FIT_JS, () => !!window.FitAddon, 'addon-fit', onLog, true);
  /* Unicode11 是锦上添花：拿不到就退化成默认宽度表，不阻塞启动 */
  await loadOne(UNI11_JS, () => !!window.Unicode11Addon, 'addon-unicode11', onLog, false);
  /* canvas 渲染器同样是可选项：拿不到就留在 DOM 渲染器 */
  await loadOne(CANVAS_JS, () => !!window.CanvasAddon, 'addon-canvas', onLog, false);
  return true;
}

/* ---------------------------------------------------------------- 等宽字体挑选
 * 错位的另一半原因在字体：只要栈里混进一个「名义等宽、实际不等宽」的字体
 * （ui-monospace 在部分平台 ± 比 M 窄 34%，某些 CJK 回退字体也如此），
 * 每个字符宽度就不同，xterm 按单元格定位后文字会逐列漂移。
 * 这里在启动时实测 M/i/W/0/空格的宽度，只放行真正等宽的候选。
 * 未安装的字体测量会退回 monospace（本身等宽），误选也无害。 */
let _monoCache = null;
function isStrictMono(family) {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.font = '16px ' + family + ', monospace';
    const w = s => c.measureText(s).width;
    const m = w('M');
    if (!(m > 0)) return false;
    return Math.abs(w('i') - m) < 0.51 && Math.abs(w('W') - m) < 0.51 &&
           Math.abs(w('0') - m) < 0.51 && Math.abs(w(' ') - m) < 0.51;
  } catch (e) { return false; }
}
function xtermFont() {
  if (_monoCache) return _monoCache;
  const raw = cssVar('--mono') || 'monospace';
  const cands = raw.split(',').map(s => s.trim()).filter(Boolean);
  const CJK = ['Noto Sans Mono CJK SC', 'Sarasa Mono SC'];
  const picked = [];
  for (const f of cands) {
    const name = f.replace(/^["']|["']$/g, '');
    if (name === 'monospace') break;
    if (CJK.includes(name)) continue;   // CJK 统一追加到末尾，避免重复
    if (isStrictMono('"' + name + '"')) picked.push(f);
  }
  // CJK 必须有等宽回退，否则中文会落到比例字体上
  _monoCache = (picked.length ? picked.join(', ') + ', ' : '') +
               '"Noto Sans Mono CJK SC", "Sarasa Mono SC", monospace';
  return _monoCache;
}

/* ---------------------------------------------------------------- 主题取值 */
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}
function termTheme(forceLight) {
  const light = forceLight === undefined ? document.body.classList.contains('light') : !!forceLight;
  return {
    background: 'rgba(0,0,0,0)',
    foreground: cssVar('--fg') || (light ? '#182624' : '#d6e7e3'),
    /* xterm 自己画的方块/竖线光标一律透明：全部交给叠加层 .ht-cursor，
     * 这样才有「呼吸、虚线、椭圆描边、阻尼缓动」这些 xterm 给不了的形态。 */
    cursor: 'rgba(0,0,0,0)',
    cursorAccent: 'rgba(0,0,0,0)',
    selectionBackground: light ? 'rgba(13,148,136,.22)' : 'rgba(94,234,212,.24)',
    selectionForeground: undefined,
    black: light ? '#1c2b29' : '#0b1112',
    red: cssVar('--red') || '#f87171',
    green: cssVar('--green') || '#4ade80',
    yellow: cssVar('--amber') || '#fbbf24',
    blue: cssVar('--blue') || '#7dd3fc',
    magenta: cssVar('--violet') || '#c4b5fd',
    cyan: cssVar('--accent') || '#5eead4',
    white: light ? '#e9f1ef' : '#d6e7e3',
    // 亮色版必须跟着主题走：xterm 默认 drawBoldTextInBrightColors 为真，
    // 于是 ANSI 的「粗体+颜色」实际取的是 bright*。浅色主题下若沿用深色主题那套
    // 淡彩色（#99f6e4 之类），粗体标题会糊在白底上几乎看不见。
    brightBlack: light ? '#64748b' : '#5b7570',
    brightRed: light ? '#b91c1c' : '#fca5a5',
    brightGreen: light ? '#15803d' : '#86efac',
    brightYellow: light ? '#a16207' : '#fde68a',
    brightBlue: light ? '#1d4ed8' : '#bae6fd',
    brightMagenta: light ? '#6d28d9' : '#ddd6fe',
    brightCyan: light ? '#0f766e' : '#99f6e4',
    brightWhite: light ? '#1f2937' : '#ffffff'
  };
}

/* ---------------------------------------------------------------- Worker 源 */
let WORKER_URL = null;
function getWorkerURL() {
  if (WORKER_URL) return WORKER_URL;
  const el = document.getElementById('worker-src');
  if (!el) throw new Error('找不到 worker 源');
  const blob = new Blob([el.textContent], { type:'text/javascript' });
  WORKER_URL = URL.createObjectURL(blob);
  return WORKER_URL;
}

/* ---------------------------------------------------------------- 顶栏控制键
 * 顶栏只剩 Ctrl 一个修饰键（Alt / Shift 按钮已按需求砍掉）。
 * 规则抄自参考项目 draw-http-terminal，手感一致：
 *   · 按住期间修饰键立刻生效（可与随后输入组合）；
 *   · 松手时：按住期间有输入 → 解锁；按住 ≥0.8s → 解锁；否则（短按无输入）→ 切换锁定；
 *   · 视觉：锁定＝实心强调色（.k--active）；被按住＝浅强调色（.k--pressing）。
 */
const MOD_HOLD_MS = 800;
const Keys = {
  sticky: { ctrl:false },
  held:   { ctrl:false },
  typed:  { ctrl:false },

  active(m) { return this.sticky[m] || this.held[m]; },
  anyActive() { return this.active('ctrl'); },

  refresh() {
    $$('#ctrlRow [data-mod]').forEach(b => {
      const m = b.dataset.mod;
      b.classList.toggle('k--active', !!this.sticky[m]);
      b.classList.toggle('k--pressing', !!this.held[m]);
    });
  },
  markInput() { if (this.held.ctrl) this.typed.ctrl = true; },
  reset() {
    this.sticky = { ctrl:false };
    this.held = { ctrl:false };
    this.refresh();
  },

  /** 顶栏只剩 Ctrl：把字母改写成标准控制字符。
   * Alt / Shift 按钮已砍掉，不再改写、不再往终端发 `ESC` 前缀
   * （Alt 组合改由全局快捷键捕获后直接吞掉，见 installKeys）。 */
  shape(str) {
    this.markInput();
    if (!this.active('ctrl')) return str;
    let out = '';
    for (const ch of String(str)) {
      const code = ch.codePointAt(0);
      let ctl = null;
      // 只对拉丁字母做 Ctrl 改写；控制字符（Enter=13、Backspace=127、Esc=27）原样送出。
      if ((code >= 64 && code <= 90) || (code >= 97 && code <= 122)) ctl = code <= 90 ? code - 64 : code - 96;
      out += ctl != null ? String.fromCharCode(ctl) : ch;
    }
    return out;
  },

  /** 顶栏的 Esc / Tab / 方向键 → 终端序列 */
  seq(key) {
    const map = {
      Escape: '\x1b', Tab: '\t', Enter: '\r', Backspace: '\x7f',
      ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
      Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~'
    };
    return map[key] || '';
  }
};

/** 当前该接收按键的会话：有聚焦的终端窗口就用它，否则用桌面终端。 */
function activeSession() {
  const w = (typeof WindowManager !== 'undefined') ? WindowManager.focused() : null;
  if (w && w.content && w.content.term && !w.content.disposed) return w.content;
  return TerminalManager.desktop;
}
function keepTermFocus() {
  const s = activeSession();
  if (s && s.term) { try { s.term.focus(); } catch (e) {} }
}
function sendKeyToTerm(text) {
  const s = activeSession();
  if (!s) return;
  if (text) s._post({ t:'in', data:text });
  if (s.term) { try { s.term.focus(); } catch (e) {} }
}

function initTopbarKeys() {
  $$('#ctrlRow [data-mod]').forEach(btn => {
    const mod = btn.dataset.mod;
    let pressStart = 0;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      pressStart = Date.now();
      Keys.typed[mod] = false;
      Keys.held[mod] = true;
      Keys.refresh();
    });
    const finish = () => {
      if (!pressStart) return;
      const dur = Date.now() - pressStart;
      Keys.held[mod] = false;
      if (Keys.typed[mod] || dur >= MOD_HOLD_MS) Keys.sticky[mod] = false;
      else Keys.sticky[mod] = !Keys.sticky[mod];
      Keys.typed[mod] = false;
      pressStart = 0;
      Keys.refresh();
      keepTermFocus();
    };
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', () => {
      Keys.held[mod] = false; Keys.typed[mod] = false; pressStart = 0;
      Keys.refresh(); keepTermFocus();
    });
  });

  $$('#ctrlRow [data-key]').forEach(btn => {
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.addEventListener('click', e => { e.preventDefault(); sendKeyToTerm(Keys.shape(Keys.seq(btn.dataset.key))); });
  });

  // —— 方向摇杆 ——
  // 与参考项目同一套手感：拖动中心圆点，取主导方向发方向键；保持方向 180ms 连发。
  const joyEl = document.getElementById('joystick');
  const joyBase = document.getElementById('joyBase');
  const joyKnob = document.getElementById('joyKnob');
  if (joyBase && joyKnob) {
    const arrows = $$('.joy-arrow', joyEl);
    let active = false, joyPid = null, joyDir = null, joyTimer = null, joyRadius = 0;
    const setArrow = d => arrows.forEach(el => el.classList.toggle('joy-arrow--on', !!d && el.dataset.dir === d));
    const arrowKey = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' };
    const sendDir = d => { sendKeyToTerm(Keys.seq(arrowKey[d])); haptic(7); };
    const center = () => {
      const r = joyBase.getBoundingClientRect();
      joyRadius = Math.max(6, r.width / 2 - 4);
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };
    const update = (cx, cy) => {
      const c = center();
      let dx = cx - c.cx, dy = cy - c.cy;
      const dist = Math.hypot(dx, dy);
      if (dist > joyRadius) { const k = joyRadius / dist; dx *= k; dy *= k; }
      joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
      let d = null;
      if (dist > 8) d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (d !== joyDir) {
        joyDir = d;
        if (joyTimer) { clearInterval(joyTimer); joyTimer = null; }
        setArrow(d);
        if (d) {
          sendDir(d);
          joyTimer = setInterval(() => sendDir(d), 180);
        }
      }
    };
    const end = () => {
      if (!active) return;
      active = false;
      if (joyTimer) { clearInterval(joyTimer); joyTimer = null; }
      joyDir = null;
      joyKnob.style.transform = 'translate(0,0)';
      joyBase.classList.remove('joystick__base--active');
      setArrow(null);
      try { joyBase.releasePointerCapture(joyPid); } catch (_) {}
      joyPid = null;
      keepTermFocus();
    };
    joyBase.addEventListener('pointerdown', e => {
      e.preventDefault();
      active = true; joyPid = e.pointerId;
      try { joyBase.setPointerCapture(joyPid); } catch (_) {}
      joyBase.classList.add('joystick__base--active');
      update(e.clientX, e.clientY);
    });
    joyBase.addEventListener('pointermove', e => {
      if (active && e.pointerId === joyPid) update(e.clientX, e.clientY);
    });
    joyBase.addEventListener('pointerup', end);
    joyBase.addEventListener('pointercancel', end);
    joyEl.addEventListener('contextmenu', e => e.preventDefault());
  }

  // 实体键盘按住 Ctrl：只做浅色提示（组合键本身由浏览器/终端原生处理）
  const physOf = (k) => k === 'Control' ? 'ctrl' : null;
  window.addEventListener('keydown', e => { const m = physOf(e.key); if (m) { Keys.held[m] = true; Keys.refresh(); } }, true);
  window.addEventListener('keyup',   e => { const m = physOf(e.key); if (m) { Keys.held[m] = false; Keys.refresh(); } }, true);
  window.addEventListener('blur', () => { Keys.held = { ctrl:false }; Keys.refresh(); });
}

/** 桌面（#desk）的可用尺寸：窗口定位一律相对它，而不是整个视口 */
function deskBox() {
  const d = document.getElementById('desk');
  if (!d) return { w: window.innerWidth, h: window.innerHeight };
  const r = d.getBoundingClientRect();
  return { w: Math.max(120, Math.round(r.width)), h: Math.max(120, Math.round(r.height)) };
}

/* ---------------------------------------------------------------- 终端实例 */

/* xterm 的宽度表：把「哪个码点占 1/2/0 格」导成区间，随 init 一起发给 Worker。
 *
 * 为什么必须导：Worker 里折行、算光标列用的是自己的 `charWidth`，而渲染是 xterm
 * 的 Unicode 11 表。两份「差不多」的宽度算法一定会漂移——实测 `🧑‍🦲` 多算 1 列、
 * `👨‍👩‍👧‍👦` 多算 3 列、`1️⃣` 多算 1 列，打字时光标一路往右跑，折行点也提前。
 * 和 §5.0 的求值器同理：同一件事只留一份实现，Worker 直接用渲染层的表。
 *
 * 遍历 0..0x10FFFF 约 16ms，只做一次（表 6 KB），不值得缓存到磁盘。 */
let _wcTable = null;
function termWidthTable(term) {
  if (_wcTable) return _wcTable;
  try {
    const us = term && term._core && term._core.unicodeService;
    if (!us || typeof us.wcwidth !== 'function') return null;
    const w2 = [], w0 = [];
    let s2 = -1, s0 = -1;
    for (let cp = 0; cp <= 0x10FFFF; cp++) {
      const w = us.wcwidth(cp);
      if (w === 2) { if (s2 < 0) s2 = cp; } else if (s2 >= 0) { w2.push([s2, cp - 1]); s2 = -1; }
      if (w === 0) { if (s0 < 0) s0 = cp; } else if (s0 >= 0) { w0.push([s0, cp - 1]); s0 = -1; }
    }
    if (s2 >= 0) w2.push([s2, 0x10FFFF]);
    if (s0 >= 0) w0.push([s0, 0x10FFFF]);
    _wcTable = { w2, w0 };
    return _wcTable;
  } catch (e) {
    return null;
  }
}

class TerminalSession {
  constructor(opts) {
    this.opts = opts;
    this.role = opts.role || 'shell';
    this.id = opts.id || uid('t');
    this.pid = opts.pid || (Proc.map.size + 101);
    this.cwd = normPath(opts.cwd || '.home');
    this.title = opts.title || (this.role === 'python' ? 'python' : 'jshel');
    this.container = opts.container;
    this.onExit = opts.onExit || (() => {});
    this.worker = null;
    this.ready = false;
    this.disposed = false;
    this.buf = '';
    this.term = null;
    this.fit = null;

    this._mount();
    this._spawn(this.role);
    /* 让拖拽层能从 DOM 找到这个会话：拖文件到终端时，把路径粘到命令行。 */
    try { if (this.container) this.container.__term = this; } catch (e) {}
    Proc.add({ pid:this.pid, role:this.role, state:'running', cwd:this.cwd, title:this.title, session:this });
  }

  _mount() {
    if (!this.container) throw new Error('终端缺少容器');
    this.term = new window.Terminal({
      /* 光标：xterm 原生光标设为透明且不闪，真正的光标是叠加层 .ht-cursor。
       * 形态（竖线 / 失焦椭圆 / 备用屏虚线 / 空闲呼吸）与缓动全在 _initCursor 里，
       * 不给设置项——照参考项目固定成一套。 */
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      cursorWidth: 1,
      fontFamily: xtermFont(),
      fontSize: Number(Settings.get('font')) || 14,
      lineHeight: (Number(Settings.get('lineHeight')) || 12) / 10,
      /* 必须为 0：非零字距只加在字符右侧、不计入单元格宽度，列会逐字累积偏移。 */
      letterSpacing: 0,
      allowTransparency: true,
      scrollback: 8000,
      /* 关键：我们的 shell/解释器只发 \n。convertEol=false 时 LF 只下移一行、
       * 列位置不变，下一行会从上一行末尾继续写——表现就是「每行开头逐行右移、
       * 编号跑到右边」。convertEol 把 LF 视作 CRLF，从根上修掉。 */
      convertEol: true,
      /* Unicode11 的 activeVersion 属于 proposed API，必须显式开启（参考项目同样如此）。 */
      allowProposedApi: true,
      theme: termTheme(),
      windowsMode: false,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      smoothScrollDuration: 0
    });
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      /* F5 / F12：原样交给浏览器。返回 false 让 xterm 不吞键、不发 ESC 序列，
       * 浏览器因此能收到真正的 F5（刷新页面）与 F12（开发者工具）。 */
      if (e.key === 'F5' || e.key === 'F12') return false;
      /* F11：软件级接管，和顶栏 ⛶ 完全同一套行为（同一个 toggleFullscreen）。 */
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return false; }
      // Ctrl+Shift+C/V 走浏览器复制粘贴（终端文本），不捕获。
      if (e.ctrlKey && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' || k === 'v') return false;
      }
      // Ctrl-Alt 一律不捕获：xterm / 浏览器按默认处理。
      if (e.ctrlKey && e.altKey) return true;
      // Alt 组合：应用全局快捷键接管 / 直接吞掉，不交给终端（不发 ESC 前缀）。
      if (e.altKey && !e.metaKey) { e.preventDefault(); return false; }
      // 其余 Ctrl 组合一律保留给终端，xterm 正常处理。
      return true;
    });
    this.term.open(this.container);
    /* 换 canvas 渲染器。必须在 open 之后加载：addon 要拿 term.element 的尺寸。
     * DOM 渲染器把整行同属性字符合成一个 <span>，浏览器对 span 里的 ZWJ 序列
     * 做连字（`👨‍👩‍👧‍👦` 塌成一个家庭图标），而 buffer 仍按 8 格推进——
     * 光标于是停在文字右边 6 格的空地上。canvas 逐格画，视觉与 cell 严格对齐。
     * 失败不致命：留在 DOM 渲染器，只是 emoji 那一行会再错位。 */
    if (window.CanvasAddon) {
      try {
        this.term.loadAddon(new window.CanvasAddon.CanvasAddon());
      } catch (e) { console.warn('canvas 渲染器不可用，继续用 DOM 渲染', e); }
    }
    this._initCursor();
    // Unicode 11 宽度表：CJK/emoji 占 1 格还是 2 格，必须与渲染一致，否则会错位。
    if (window.Unicode11Addon) {
      try {
        this.term.loadAddon(new window.Unicode11Addon.Unicode11Addon());
        this.term.unicode.activeVersion = '11';
      } catch (e) { console.warn('unicode11 加载失败', e); }
    }
    try {
      this.fit = new window.FitAddon.FitAddon();
      this.term.loadAddon(this.fit);
      this.fit.fit();
    } catch (e) { console.warn('fit 失败', e); }
    this.term.onData(d => {
      this._post({ t:'in', data:Keys.shape(d) });
      this._cursorIdle();
    });
    this.term.onResize(({ cols, rows }) => this._post({ t:'resize', cols, rows }));
    this._ro = new ResizeObserver(() => this.fitNow());
    this._ro.observe(this.container);
    setTimeout(() => this.fitNow(), 30);
    this.term.focus();
  }

  /* ---------------------------------------------------------------- 自定义光标
   * xterm 自带光标被设成透明，这里用一个绝对定位的 div 画。为什么不用原生光标：
   * 原生只支持 bar/block/underline 三态 + 闪烁，做不出「失焦椭圆描边、备用屏虚线、
   * 空闲呼吸、阻尼缓动」这些参考项目里的形态。
   */
  _initCursor() {
    const host = this.term && this.term.element;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const el = document.createElement('div');
    el.className = 'ht-cursor';
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
    this.cur = { el, x:0, y:0, tx:0, ty:0, init:false, raf:0, idle:0, hollow:false, alt:false };
    this.term.onCursorMove(() => this._cursorPlace());
    /* 光标不是画在屏幕上的贴纸，它属于某一行某一列。
     * onCursorMove 只在「光标自己动了」时触发；用户滚动回看历史时 viewportY 变了、
     * 光标一行没动——过去这里就漏了，光标停在旧像素上，内容从它身上滚过去。
     * 所以滚动与尺寸变化都要重算，并且**直接跳到位**：
     * 滚动是内容整体位移，再给 22% 阻尼缓动就成了「飘过去」，反而更假。 */
    this.term.onScroll(() => this._cursorSnap());
    this.term.onResize(() => this._cursorSnap());
    /* onScroll 只在「缓冲区滚动」时触发（新输出把内容顶上去），**用户拖滚动条 /
     * 滚轮回看历史不算**——viewportY 变了，onScroll 一声不响。实测：wheel 之后
     * viewportY 183→120、光标行已经跑到 84（共 22 行），.ht-cursor 还亮在最后一行。
     * 直接监听 .xterm-viewport 的 scroll 事件，这条路径不挑渲染器，canvas / DOM 都有。 */
    const vp = this.term.element.querySelector('.xterm-viewport');
    if (vp) vp.addEventListener('scroll', () => this._cursorSnap(), { passive:true });

    const ta = this.term.textarea;
    if (ta) {
      ta.addEventListener('focus', () => { this.cur.hollow = false; this._cursorStyle(); this._cursorIdle(); });
      ta.addEventListener('blur', () => {
        this.cur.hollow = true;
        clearTimeout(this.cur.idle);
        this._cursorStyle();
      });
      if (document.activeElement !== ta) { this.cur.hollow = true; this._cursorStyle(); }
    }
    // 选中文本时不呼吸（正在拖选时呼吸会干扰）
    this.term.onSelectionChange(() => {
      const sel = this.term.hasSelection && this.term.hasSelection();
      this.cur.el.classList.toggle('ht-cursor--paused', !!sel);
      if (sel) this.cur.el.classList.remove('ht-cursor--breathing');
    });
    requestAnimationFrame(() => this._cursorPlace());
  }

  _cursorStyle() {
    const c = this.cur;
    if (!c) return;
    c.el.classList.toggle('ht-cursor--hollow', !!c.hollow);
    c.el.classList.toggle('ht-cursor--dashed', !!c.alt);
    if (c.hollow || c.alt) c.el.classList.remove('ht-cursor--breathing');
  }

  _cursorRaf() {
    const c = this.cur;
    if (c && !c.raf) c.raf = requestAnimationFrame(() => this._cursorTick());
  }

  /* 滚动会一行一行地触发；直接在这里量 DOM 等于每行强制一次 layout，
   * `seq 1 5000` 能把主线程拖住。合并到下一帧，最多一次。 */
  _cursorSnap() {
    const c = this.cur;
    if (!c || c.snapRaf) return;
    c.snapRaf = requestAnimationFrame(() => { c.snapRaf = 0; this._cursorPlace(true); });
  }

  /* 阻尼缓动：每帧向目标逼近 22%。快速移动（按方向键连翻）时追不上，
   * 停手后再平滑收敛——这就是「平滑移动」的手感来源。 */
  _cursorTick() {
    const c = this.cur;
    if (!c) return;
    c.x += (c.tx - c.x) * 0.22;
    c.y += (c.ty - c.y) * 0.22;
    if (Math.abs(c.tx - c.x) < 0.35) c.x = c.tx;
    if (Math.abs(c.ty - c.y) < 0.35) c.y = c.ty;
    c.el.style.left = c.x + 'px';
    c.el.style.top = c.y + 'px';
    if (c.x !== c.tx || c.y !== c.ty) c.raf = requestAnimationFrame(() => this._cursorTick());
    else c.raf = 0;
  }

  _cursorPlace(snap) {
    const c = this.cur, t = this.term;
    if (!c || !t || !t.element) return;
    const buf = t.buffer.active;
    /* cursorY 是「当前显示基准」上的相对行，baseY 是基准的绝对偏移，
     * viewportY 是视口顶端的绝对行——三者推出光标在视口内的行号。
     * 滚动之后这个算法依然准，不依赖任何尺寸测量。
     * 越界就藏起来：用户回看历史时光标确实不在屏幕上，硬画在边上是在撒谎。 */
    const vRow = buf.cursorY + buf.baseY - buf.viewportY;
    if (vRow < 0 || vRow >= t.rows) {
      c.el.style.display = 'none';
      /* 下次重新出现时直接落位：隐藏期间的内容位移不需要「补一段动画」。 */
      c.init = false;
      return;
    }
    c.el.style.display = '';

    const screen = t.element.querySelector('.xterm-screen');
    if (!screen) { this._cursorRaf(); return; }
    const hostR = t.element.getBoundingClientRect();
    const sr = screen.getBoundingClientRect();
    const offX = sr.left - hostR.left;
    const offY = sr.top - hostR.top;
    const cellW = sr.width / Math.max(1, t.cols);
    const cellH = sr.height / Math.max(1, t.rows);
    if (!cellW || !cellH) { this._cursorRaf(); return; }

    const alt = buf.type === 'alternate';
    if (alt !== c.alt) { c.alt = alt; this._cursorStyle(); }

    const w = c.hollow ? 7 : 2;
    c.el.style.width = w + 'px';
    c.el.style.height = cellH + 'px';
    const px = offX + buf.cursorX * cellW + 1 - w / 2;
    const py = offY + vRow * cellH;
    /* 滚动/resize：取消还在跑的缓动，一步到位 */
    if (snap && c.raf) { cancelAnimationFrame(c.raf); c.raf = 0; }
    if (!c.init || snap) {
      c.x = c.tx = px;
      c.y = c.ty = py;
      c.init = true;
      c.el.style.left = px + 'px';
      c.el.style.top = py + 'px';
    } else {
      const moved = px !== c.tx || py !== c.ty;
      c.tx = px; c.ty = py;
      if (moved) this._cursorIdle();
    }
    this._cursorRaf();
  }

  /* 只有「聚焦 + 空闲 ≥1s + 不在备用屏」才呼吸 */
  _cursorIdle() {
    const c = this.cur;
    if (!c) return;
    c.el.classList.remove('ht-cursor--breathing');
    clearTimeout(c.idle);
    c.idle = setTimeout(() => {
      if (c.hollow || c.alt) return;
      if (this.term && this.term.hasSelection && this.term.hasSelection()) return;
      c.el.classList.add('ht-cursor--breathing');
    }, 1000);
  }

  fitNow() {
    if (!this.fit || this.disposed) return;
    try {
      const dims = this.fit.proposeDimensions();
      if (!dims || !isFinite(dims.cols) || !isFinite(dims.rows) || dims.cols < 2 || dims.rows < 1) return;
      this.fit.fit();

      /* 固定显示行数（参考项目的 fixedRows）：0 = 自动铺满。
       * 做法是先把容器能容纳的最大行数算出来，取 min(设定值, 最大行数)，
       * 再把 .xterm 的高度钉死成 rows × 行高 —— 多出来的空间留白，不拉伸行高。 */
      const fixed = Number(Settings.get('rows')) || 0;
      const host = this.term.element;
      if (host) {
        if (fixed > 0) {
          const screen = host.querySelector('.xterm-screen');
          const cellH = screen ? screen.getBoundingClientRect().height / Math.max(1, this.term.rows) : 0;
          if (cellH > 0) {
            const maxRows = Math.floor((this.container.clientHeight || 0) / cellH);
            const rows = Math.max(1, Math.min(fixed, maxRows || fixed));
            host.style.height = (rows * cellH) + 'px';
            if (rows !== this.term.rows) this.term.resize(this.term.cols, rows);
          }
        } else {
          host.style.height = '';
        }
      }
      this._cursorPlace();
    } catch (e) {}
  }

  _spawn(role) {
    this.worker = new Worker(getWorkerURL());
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'out') { this.term.write(m.data); this.buf = (this.buf + m.data).slice(-8192); return; }
      if (m.t === 'cwd') { this.cwd = m.path; this.opts.onCwd && this.opts.onCwd(m.path); return; }
      if (m.t === 'ready') { this.ready = true; this.opts.onReady && this.opts.onReady(); return; }
      if (m.t === 'exit') { this._onWorkerExit(m.code || 0); return; }
      if (m.t === 'agent-error') return;
      if (m.t === 'eval-result') return;
      if (m.t === 'rpc') {
        RPC.dispatch(m, this).then(
          v => this._post({ t:'rpc-result', id:m.id, ok:true, value:v }),
          e => this._post({ t:'rpc-result', id:m.id, ok:false, error:{ message:String(e && e.message || e), stack:e && e.stack } })
        );
        return;
      }
    };
    this.worker.onerror = (e) => {
      const msg = (e && e.message) || 'worker error';
      this.term.write('\r\n\x1b[31m[worker] ' + msg + '\x1b[0m\r\n');
    };
    /* DOM 事件回放通道：主线程捕获到 click/input 之类，按 listener id 广播给
     * 每个 Worker，Worker 只认自己注册过的 id。 */
    this._domSink = (msg) => this._post(msg);
    try { if (typeof DomRpc !== 'undefined') DomRpc.attach(this._domSink); } catch (e) {}
    const dims = this.term && this.term.cols ? { cols:this.term.cols, rows:this.term.rows } : { cols:80, rows:24 };
    this._post({
      t:'init', role, cwd:this.cwd, version:HT_VERSION, prompt:this.role === 'shell' ? (Settings.get('prompt') || '> ') : '>>> ',
      cols:dims.cols, rows:dims.rows, history:this.opts.history || [], code:this.opts.code || '',
      banner:this.opts.banner !== false,
      /* 宽度表跟着 init 一起走：Worker 的折行/光标列必须和渲染层用同一张表 */
      wc: termWidthTable(this.term)
    });
  }

  _post(m) { if (this.worker && !this.disposed) this.worker.postMessage(m); }

  _onWorkerExit(code) {
    if (this.disposed) return;
    this.ready = false;
    Proc.remove(this.pid);
    const cb = this.opts.onExit;
    if (this.role === 'python' && this.opts.returnToShell) {
      this.role = 'shell';
      this.title = 'jshel';
      this._spawn('shell');
      return;
    }
    if (cb) cb(code);
  }

  /** 在当前终端里 exec 另一个程序（目前是 python），退出后回到 shell。 */
  execApp(role) {
    if (!this.worker) return;
    const old = this.worker;
    this.worker = null;
    try { old.terminate(); } catch (e) {}
    this.role = role;
    this.opts.returnToShell = true;
    this._spawn(role);
  }

  restart() {
    if (!this.worker) return;
    try { this.worker.terminate(); } catch (e) {}
    this.worker = null;
    this.role = 'shell';
    this._spawn('shell');
  }

  applySettings() {
    if (!this.term) return;
    this.term.options.fontSize = Number(Settings.get('font')) || 14;
    this.term.options.lineHeight = (Number(Settings.get('lineHeight')) || 12) / 10;
    this.term.options.theme = termTheme();
    setTimeout(() => { this.fitNow(); this._cursorPlace(); }, 20);
  }

  write(s) { this.term && this.term.write(s); }
  clear() { this.term && this.term.clear(); }

  /* 往命令行里插一段文本（不执行）。拖拽落点、右键粘贴都走这里。
   * 用括号粘贴标记包起来：LineEditor 认 \x1b[200~…\x1b[201~，
   * 多行文本会被当成「一次粘贴」，而不是敲了一串回车把每行都执行一遍。 */
  insert(text) {
    const s = String(text == null ? '' : text);
    if (!s || this.disposed || !this.worker) return false;
    this._post({ t:'in', data:'\x1b[200~' + s.replace(/\r\n?/g, '\n') + '\x1b[201~' });
    try { this.term && this.term.focus(); } catch (e) {}
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    Proc.remove(this.pid);
    try { if (this._domSink && typeof DomRpc !== 'undefined') DomRpc.detach(this._domSink); } catch (e) {}
    this._domSink = null;
    try { this.worker && this.worker.postMessage({ t:'terminate' }); } catch (e) {}
    try { this.worker && this.worker.terminate(); } catch (e) {}
    this.worker = null;
    try { this._ro && this._ro.disconnect(); } catch (e) {}
    try { clearTimeout(this.cur && this.cur.idle); } catch (e) {}
    try { if (this.cur && this.cur.raf) cancelAnimationFrame(this.cur.raf); } catch (e) {}
    try { if (this.cur && this.cur.snapRaf) cancelAnimationFrame(this.cur.snapRaf); } catch (e) {}
    try { this.term && this.term.dispose(); } catch (e) {}
    this.term = null;
    this.cur = null;
  }
}

/* ---------------------------------------------------------------- 终端管理 */
const TerminalManager = {
  sessions: new Set(),
  desktop: null,

  bootDesktop() {
    const host = document.getElementById('term');
    if (this.desktop) this.desktop.dispose();
    // 清空旧节点（xterm 会往里塞东西）
    host.innerHTML = '';
    this.desktop = new TerminalSession({
      container: host,
      role: 'shell',
      title: 'jshel',
      cwd: '.home',
      id: 'desktop',
      pid: 100,
      history: loadHistory(),
      onCwd: (p) => {
        const a = document.getElementById('tbWhere'); if (a) a.textContent = p;
        const b = document.getElementById('drSub'); if (b) b.textContent = 'jshel · ' + p;
      },
      onExit: () => exitDesktop(),
    });
    this.sessions.add(this.desktop);
    return this.desktop;
  },

  create(opts) {
    const s = new TerminalSession(opts);
    this.sessions.add(s);
    const oldDispose = s.dispose.bind(s);
    s.dispose = () => { this.sessions.delete(s); oldDispose(); };
    return s;
  },

  applyAll() { for (const s of this.sessions) s.applySettings(); },
  applyTheme(t) {
    const light = typeof t === 'string' ? t === 'light' : document.body.classList.contains('light');
    for (const s of this.sessions) {
      if (!s.term) continue;
      s.term.options.theme = termTheme(light);
      try { s.term.refresh(0, Math.max(0, s.term.rows - 1)); } catch (e) {}
    }
  },

  desktopWrite(s) { if (this.desktop) this.desktop.write(s); }
};

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('ht.history') || '[]'); } catch (e) { return []; }
}
function saveHistoryList(list) {
  try { localStorage.setItem('ht.history', JSON.stringify(list.slice(-500))); } catch (e) {}
}

/* ---------------------------------------------------------------- 底层终端退出 */
let exiting = false;
function exitDesktop() {
  if (exiting) return;
  exiting = true;
  toast('终端已退出，正在返回上一级……');
  setTimeout(() => {
    // 只有「确实从另一个真实页面点进来」时才回退。
    // 直接打开（双击文件 / 新标签粘贴地址）时 referrer 为空、history 里只有一条，
    // 此时 history.back() 会落到 about:blank —— 那不算「上一级」，宁可刷新自毁重来。
    const ref = document.referrer || '';
    const realPrev = history.length > 1 && /^https?:/i.test(ref) && ref !== location.href;
    if (realPrev) {
      history.back();
      // 若 700ms 后本页还活着（回退是同文档或根本没走），兜底刷新
      setTimeout(() => { location.reload(); }, 700);
    } else {
      location.reload();
    }
  }, 260);
}

/* ---------------------------------------------------------------- 窗口管理 */
const WindowManager = {
  windows: new Map(),
  z: 30,
  cascade: 0,

  init() {
    document.getElementById('window-layer').addEventListener('pointerdown', () => {}, { passive:true });
  },

  open(opts) {
    opts = opts || {};
    if (opts.app && !opts.type) {
      const app = APP_DEFS.find(a => a.name === String(opts.app).replace(/^\.app\./, ''));
      if (app) opts = Object.assign({}, opts, { type:app.type, title:opts.title || app.title, icon:app.icon, app:app.name });
      else opts = Object.assign({}, opts, { type:'about' });
    }
    /* 只给了 html 没给类型：当作浏览器窗口（srcdoc 直开）。
     * 智能体的 window_html 工具和老代码都会这么调。 */
    if (!opts.type && opts.html) opts = Object.assign({}, opts, { type:'browser', title:opts.title || 'HTML' });
    if (opts.app === 'agent' || opts.type === 'agent') {
      const ex = [...this.windows.values()].find(w => w.type === 'agent');
      if (ex) { this.focus(ex.id); if (ex.minimized) this.restore(ex.id); return ex; }
    }
    if (opts.type === 'drawer') { Drawer.open(); return null; }

    const id = opts.id || uid('w');
    const TYPE_TITLES = { browser:'浏览器', files:'文件', shell:'终端', python:'Python', agent:'HarTMLes', editor:'编辑器', about:'关于', html:'窗口',
      calc:'计算器', data:'数据转换', color:'调色盘', markdown:'Markdown', shot:'截图', image:'看图修图', urlhash:'链接即状态',
      recorder:'录音机', geo:'定位', view3d:'3D 视图', audio:'音频播放', hsl2:'hsl2 · FreeBSD' };
    const TYPE_SIZE = { browser:[920, 620], files:[820, 540], shell:[780, 480], python:[820, 540], agent:[880, 600], editor:[860, 600], about:[560, 420],
      calc:[360, 560], data:[720, 600], color:[660, 560], markdown:[900, 600], shot:[720, 620], image:[940, 660], urlhash:[700, 620],
      recorder:[470, 560], geo:[470, 580], view3d:[760, 580], audio:[740, 560], hsl2:[820, 600] };
    opts.title = opts.title || TYPE_TITLES[opts.type] || '窗口';
    /* `jshel` 可以一层层开出新窗口，全都叫「终端」就分不清哪个是哪个了。
     * 后缀带上落地目录，cd 之后跟着变。 */
    if (opts.type === 'shell' && opts.title === '终端') opts.title = '终端 · ' + (opts.cwd || '.home');
    const { w:vw, h:vh } = deskBox();
    const base = TYPE_SIZE[opts.type] || [780, 500];
    const defW = Math.min(opts.w || base[0], vw - 24);
    const defH = Math.min(opts.h || base[1], vh - 32);
    const n = this.cascade++ % 6;
    // 层叠步长要比标题栏（36px）大一点，否则两个窗口的标题栏会糊在一起像一条
    const x = opts.x != null ? opts.x : clamp(24 + n * 46, 8, Math.max(8, vw - defW - 8));
    const y = opts.y != null ? opts.y : clamp(12 + n * 42, 8, Math.max(8, vh - defH - 12));

    const el = document.createElement('section');
    el.className = 'win focus';
    el.dataset.id = id;
    el.style.cssText = `left:${x}px;top:${y}px;width:${defW}px;height:${defH}px;z-index:${++this.z}`;
    el.innerHTML = `<header class="win-bar">
        <div class="win-dots"><i class="c" data-a="close" title="关闭"></i><i class="m" data-a="min" title="最小化"></i><i class="x" data-a="max" title="最大化"></i></div>
        <div class="win-title">${esc(opts.title || '窗口')}</div>
        <div class="win-tools"></div>
      </header>
      <div class="win-body"></div>
      <div class="rz n"></div><div class="rz s"></div><div class="rz w"></div><div class="rz e"></div>
      <div class="rz nw"></div><div class="rz ne"></div><div class="rz sw"></div><div class="rz se"></div>`;
    document.getElementById('window-layer').appendChild(el);

    const win = {
      id, el, type:opts.type || 'shell', app:opts.app || '', title:opts.title || '窗口',
      body: $('.win-body', el), minimized:false, maximized:false, restoreRect:null,
      onClose:null, content:null, opts
    };
    this.windows.set(id, win);
    el.addEventListener('pointerdown', () => this.focus(id), true);
    $$('.win-dots i', el).forEach(dot => {
      dot.addEventListener('pointerdown', e => e.stopPropagation());
      dot.addEventListener('click', e => {
        e.stopPropagation();
        const a = dot.dataset.a;
        if (a === 'close') this.close(id);
        else if (a === 'min') this.minimize(id);
        else this.toggleMax(id);
      });
    });
    const bar = $('.win-bar', el);
    bar.addEventListener('pointerdown', e => this._startDrag(e, win));
    bar.addEventListener('dblclick', e => { if (!e.target.closest('.win-dots')) this.toggleMax(id); });
    $$('.rz', el).forEach(h => h.addEventListener('pointerdown', e => this._startResize(e, win, h.classList[1])));

    this._render(win, opts);
    this._syncDock();
    this.focus(id);
    this._animIn(win, opts.from);
    return win;
  },

  /* ---------------------------------------------------------------- 窗口动效
   * "从一个点扩散"的关键不是 scale 本身，而是 transform-origin 指哪儿：
   *   origin 在触发按钮的位置 → 视觉上就是「从这个图标长出来的」。
   * 没有触发点（程序开窗）就用窗口中心，看起来是从中间展开。
   */
  _animIn(win, from) {
    const el = win.el;
    if (!el || !el.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (from && isFinite(from.x) && isFinite(from.y)) {
      const r = el.getBoundingClientRect();
      el.style.transformOrigin = (from.x - r.left) + 'px ' + (from.y - r.top) + 'px';
    } else {
      el.style.transformOrigin = '50% 50%';
    }
    el.classList.add('anim-in');
    const done = () => { el.classList.remove('anim-in'); el.style.transformOrigin = ''; };
    el.addEventListener('animationend', done, { once:true });
    /* 兜底：某些环境下 animationend 不触发（元素被隐藏等），别让类卡住 */
    setTimeout(done, 520);
  },

  /* 关窗 = 溶解。先播动画再从 DOM 移除；期间 pointer-events:none 防误点。 */
  _animOut(win, cb) {
    const el = win.el;
    if (!el || !el.animate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { cb(); return; }
    el.classList.add('anim-out');
    let fired = false;
    const end = () => { if (fired) return; fired = true; cb(); };
    el.addEventListener('animationend', end, { once:true });
    setTimeout(end, 400);
  },

  /* 最小化：把"收进哪儿"算出来，交给 CSS 变量。 */
  _dockPoint(id) {
    const icon = document.querySelector('#dock [data-win="' + id + '"]');
    const dbox = document.getElementById('desk').getBoundingClientRect();
    if (icon) {
      const r = icon.getBoundingClientRect();
      return { x: r.left + r.width / 2 - dbox.left, y: r.top + r.height / 2 - dbox.top };
    }
    return { x: dbox.width / 2, y: dbox.height + 24 };
  },
  _animMin(win, cb) {
    const el = win.el;
    if (!el || !el.animate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { cb(); return; }
    const r = el.getBoundingClientRect();
    const dbox = document.getElementById('desk').getBoundingClientRect();
    const p = this._dockPoint(win.id);
    /* 位移要换算成相对窗口中心的偏移，scale 才会朝图标方向收 */
    const mx = p.x + dbox.left - (r.left + r.width / 2);
    const my = p.y + dbox.top - (r.top + r.height / 2);
    el.style.setProperty('--mx', mx + 'px');
    el.style.setProperty('--my', my + 'px');
    el.style.transformOrigin = '50% 50%';
    el.classList.add('anim-min');
    let fired = false;
    const end = () => { if (fired) return; fired = true; el.classList.remove('anim-min'); cb(); };
    el.addEventListener('animationend', end, { once:true });
    setTimeout(end, 380);
  },

  _render(win, opts) {
    try {
      switch (win.type) {
        case 'shell': {
          win.body.innerHTML = '<div class="win-term"></div>';
          win.content = TerminalManager.create({
            container: $('.win-term', win.body), role:'shell', cwd:opts.cwd || '.home',
            title:win.title, pid:(Proc.map.size + 110), history:loadHistory(), code:opts.code || '',
            onCwd:(p) => { win.cwd = p; if (win.type === 'shell') this.setTitle(win.id, '终端 · ' + p); },
            onExit:() => { this.close(win.id); },
          });
          break;
        }
        case 'python': {
          win.body.innerHTML = '<div class="win-term"></div>';
          win.content = TerminalManager.create({
            container: $('.win-term', win.body), role:'python', cwd:opts.cwd || '.home',
            title:'python', pid:(Proc.map.size + 130), history:loadHistory(),
            onExit:() => { this.close(win.id); },
          });
          break;
        }
        case 'browser': win.content = new BrowserApp(win.body, opts); break;
        case 'files': win.content = new FilesApp(win.body, opts); break;
        case 'editor': win.content = new EditorApp(win.body, opts); break;
        case 'calc': win.content = new CalcApp(win.body, opts); break;
        case 'data': win.content = new DataApp(win.body, opts); break;
        case 'color': win.content = new ColorApp(win.body, opts); break;
        case 'markdown': win.content = new MdApp(win.body, opts); break;
        case 'shot': win.content = new ShotApp(win.body, opts); break;
        case 'image': win.content = new ImageApp(win.body, opts); break;
        case 'urlhash': win.content = new UrlHashApp(win.body, opts); break;
        case 'recorder': win.content = new RecorderApp(win.body); break;
        case 'geo': win.content = new GeoApp(win.body); break;
        case 'view3d': win.content = new View3DApp(win.body); break;
        case 'audio': win.content = new AudioApp(win.body); break;
        case 'agent': win.content = new AgentApp(win.body, opts, win); break;
        case 'hsl2': win.content = new HSL2App(win.body, opts, win); break;
        case 'html': win.body.innerHTML = opts.html || ''; break;
        case 'about': win.body.classList.add('pad'); win.body.innerHTML = aboutHtml(); break;
        default: win.body.innerHTML = '<div style="padding:20px;color:var(--fg-dim)">未知应用：' + esc(win.type) + '</div>';
      }
      if (win.content && win.content.setTitle) {
        win.content.onTitle = (t) => this.setTitle(win.id, t);
      }
      if (win.type === 'browser' && win.content && win.content.current) {
        const t = win.content.current();
        if (t && t.title) this.setTitle(win.id, t.title);
      }
    } catch (e) {
      win.body.innerHTML = '<div style="padding:20px;color:var(--red);font-family:var(--mono);font-size:12px">应用启动失败：' + esc(e.message || e) + '</div>';
    }
  },

  _startDrag(e, win) {
    if (e.button !== 0 || win.maximized) return;
    if (e.isPrimary === false) return;
    if (e.target.closest('.win-dots') || e.target.closest('.win-tools')) return;
    const bar = e.currentTarget;
    const pid = e.pointerId;

    /* 关键技术：在标题栏上 setPointerCapture。
     * 不捕获时，指针一旦移到窗口内容区（尤其是 iframe 上），pointermove 就派发给
     * iframe 文档，父文档的监听收不到——表现为「拖着拖着不动了」。
     * 捕获之后，事件序列始终回到标题栏，指针跑到哪都跟得住。 */
    try { bar.setPointerCapture(pid); } catch (_) {}

    this.focus(win.id);
    const startX = e.clientX, startY = e.clientY;
    const box0 = deskBox();
    const r = win.el.getBoundingClientRect();
    const sl = parseFloat(win.el.style.left), st = parseFloat(win.el.style.top);
    // style.left/top 相对 #desk；getBoundingClientRect 相对视口。优先用已写死的 style 值，
    // 没写过才用 rect 换算（少了这一步会把顶栏高度重复计进位移，拖一次往下跳一截）。
    const ox = Number.isFinite(sl) ? sl : r.left - box0.left;
    const oy = Number.isFinite(st) ? st : r.top - box0.top;
    const w0 = r.width, h0 = r.height;

    let moved = false, snap = null, raf = 0, last = null;
    const snapEl = document.getElementById('winSnap');
    document.body.classList.add('win-drag');

    const draw = () => {
      raf = 0;
      const ev = last; if (!ev) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;  // 3px 阈值：防手抖
      moved = true;
      const box = deskBox();
      // 左右至少留 90px 在桌面内，上下至少留 44px（标题栏）可抓
      const nx = clamp(Math.round(ox + dx), 90 - w0, box.w - 90);
      const ny = clamp(Math.round(oy + dy), 0, box.h - 44);
      win.el.style.left = nx + 'px';
      win.el.style.top = ny + 'px';
      win.el.classList.add('dragging');

      const px = ev.clientX - box0.left, py = ev.clientY - box0.top;
      if (py <= 8) snap = { x:0, y:0, w:box.w, h:box.h };
      else if (px <= 8) snap = { x:0, y:0, w:Math.round(box.w / 2), h:box.h };
      else if (px >= box.w - 8) snap = { x:Math.round(box.w / 2), y:0, w:Math.round(box.w / 2), h:box.h };
      else snap = null;
      if (snap) {
        snapEl.style.display = 'block';
        snapEl.style.left = snap.x + 'px'; snapEl.style.top = snap.y + 'px';
        snapEl.style.width = snap.w + 'px'; snapEl.style.height = snap.h + 'px';
      } else snapEl.style.display = 'none';
    };
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      last = ev;
      if (!raf) raf = requestAnimationFrame(draw);   // 合并到帧，避免高频 move 抖动
    };
    const finish = (ev) => {
      if (ev && ev.pointerId !== pid) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', finish);
      bar.removeEventListener('pointercancel', finish);
      try { bar.releasePointerCapture(pid); } catch (_) {}
      document.body.classList.remove('win-drag');
      win.el.classList.remove('dragging');
      if (snapEl) snapEl.style.display = 'none';
      if (snap) {
        win.restoreRect = { x:Math.round(ox), y:Math.round(oy), w:w0, h:h0 };
        win.el.style.left = snap.x + 'px'; win.el.style.top = snap.y + 'px';
        win.el.style.width = snap.w + 'px'; win.el.style.height = snap.h + 'px';
        const box = deskBox();
        win.maximized = snap.w === box.w && snap.h === box.h;
        win.el.classList.toggle('max', win.maximized);
        win.content && win.content.onResize && win.content.onResize();
      }
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', finish);
    bar.addEventListener('pointercancel', finish);
  },

  _startResize(e, win, dir) {
    if (e.button !== 0 || win.maximized) return;
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget;
    const pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch (_) {}
    this.focus(win.id);

    const box0 = deskBox();
    const r = win.el.getBoundingClientRect();
    const sl = parseFloat(win.el.style.left), st = parseFloat(win.el.style.top);
    // 同样：一律用 #desk 相对坐标，禁止把视口坐标直接写进 style.left/top。
    const start = {
      x: Number.isFinite(sl) ? sl : r.left - box0.left,
      y: Number.isFinite(st) ? st : r.top - box0.top,
      w: r.width, h: r.height
    };
    const sx = e.clientX, sy = e.clientY;
    let raf = 0, last = null;
    const MINW = 280, MINH = 150;
    document.body.classList.add('win-drag');

    const draw = () => {
      raf = 0;
      const ev = last; if (!ev) return;
      let { x, y, w, h } = start;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const box = deskBox();
      if (dir.includes('e')) w = clamp(start.w + dx, MINW, box.w - x);
      if (dir.includes('s')) h = clamp(start.h + dy, MINH, box.h - y);
      if (dir.includes('w')) {
        w = clamp(start.w - dx, MINW, start.x + start.w);
        x = start.x + start.w - w;
      }
      if (dir.includes('n')) {
        h = clamp(start.h - dy, MINH, start.y + start.h);
        y = start.y + start.h - h;
      }
      win.el.style.left = Math.round(x) + 'px'; win.el.style.top = Math.round(y) + 'px';
      win.el.style.width = Math.round(w) + 'px'; win.el.style.height = Math.round(h) + 'px';
      win.el.classList.add('resizing');
    };
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      last = ev;
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const finish = (ev) => {
      if (ev && ev.pointerId !== pid) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      try { handle.releasePointerCapture(pid); } catch (_) {}
      document.body.classList.remove('win-drag');
      win.el.classList.remove('resizing');
      win.content && win.content.onResize && win.content.onResize();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  },

  focus(id) {
    const win = this.windows.get(id);
    if (!win) return;
    for (const w of this.windows.values()) w.el.classList.remove('focus');
    win.el.classList.add('focus');
    win.el.style.zIndex = ++this.z;
    this._syncDock();
  },
  focused() {
    let best = null, z = -1;
    for (const w of this.windows.values()) {
      if (w.minimized) continue;
      const zi = parseInt(w.el.style.zIndex || 0, 10);
      if (zi > z) { z = zi; best = w; }
    }
    return best;
  },

  minimize(id) {
    const w = this.windows.get(id);
    if (!w || w.minimized) return;
    w.minimized = true;
    /* 先算 Dock 位置再藏：_syncDock 之后图标位置才准，
     * 但 .min 会被 display:none 掉，所以顺序是 同步 Dock → 取点 → 动画 → 加 .min */
    this._syncDock();
    if (w.content && w.content.onHide) w.content.onHide();
    this._animMin(w, () => { w.el.classList.add('min'); });
  },
  restore(id) {
    const w = this.windows.get(id);
    if (!w) return;
    w.minimized = false;
    const wasMin = w.el.classList.contains('min');
    w.el.classList.remove('min');
    this.focus(id);
    if (w.content && w.content.onShow) w.content.onShow();
    if (!wasMin) return;
    /* 从 Dock 位置反向长出来，和最小化对称 */
    const el = w.el;
    if (!el || !el.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const dbox = document.getElementById('desk').getBoundingClientRect();
    const p = this._dockPoint(id);
    el.style.setProperty('--mx', (p.x + dbox.left - (r.left + r.width / 2)) + 'px');
    el.style.setProperty('--my', (p.y + dbox.top - (r.top + r.height / 2)) + 'px');
    el.classList.add('anim-restore');
    let fired = false;
    const end = () => { if (fired) return; fired = true; el.classList.remove('anim-restore'); };
    el.addEventListener('animationend', end, { once:true });
    setTimeout(end, 420);
  },
  toggleMin(id) {
    const w = this.windows.get(id);
    if (!w) return;
    if (w.minimized) this.restore(id);
    else if (w.el.classList.contains('focus')) this.minimize(id);
    else this.focus(id);
  },
  toggleMax(id) {
    const w = this.windows.get(id);
    if (!w) return;
    /* 加 .tween 让 left/top/width/height 插值过渡（外扩 / 内缩），
     * 过渡结束立刻摘掉，避免以后拖拽时窗口"追不上"鼠标。 */
    w.el.classList.add('tween');
    clearTimeout(w._tweenT);
    w._tweenT = setTimeout(() => w.el.classList.remove('tween'), 300);
    if (w.maximized) {
      const r = w.restoreRect || { x:40, y:32, w:760, h:480 };
      w.el.style.left = r.x + 'px'; w.el.style.top = r.y + 'px';
      w.el.style.width = r.w + 'px'; w.el.style.height = r.h + 'px';
      w.maximized = false;
      w.el.classList.remove('max');
    } else {
      const rect = w.el.getBoundingClientRect();
      const dbox = document.getElementById('desk').getBoundingClientRect();
      w.restoreRect = { x:rect.left - dbox.left, y:rect.top - dbox.top, w:rect.width, h:rect.height };
      w.el.style.left = '0px'; w.el.style.top = '0px';
      w.el.style.width = '100%'; w.el.style.height = '100%';
      w.maximized = true;
      w.el.classList.add('max');
    }
    this.focus(id);
    setTimeout(() => w.content && w.content.onResize && w.content.onResize(), 40);
  },
  close(id) {
    const w = this.windows.get(id);
    if (!w) return;
    if (w.closing) return;
    w.closing = true;
    if (w.onClose) { try { w.onClose(); } catch (e) {} }
    /* 内容先 dispose，释放 worker / iframe；视觉上再慢慢溶解掉 */
    if (w.content && w.content.dispose) { try { w.content.dispose(); } catch (e) {} }
    this.windows.delete(id);
    this._syncDock();
    this._animOut(w, () => { try { w.el.remove(); } catch (e) {} });
  },
  closeFocused() {
    const w = this.focused();
    if (w) this.close(w.id);
  },
  setTitle(id, t) {
    const w = this.windows.get(id);
    if (!w) return;
    w.title = t;
    $('.win-title', w.el).textContent = t;
    this._syncDock();
  },
  list() { return [...this.windows.values()].map(w => ({ id:w.id, type:w.type, title:w.title, minimized:w.minimized, maximized:w.maximized })); },

  _syncDock() {
    const dock = document.getElementById('dock');
    if (!dock) return;
    const wins = [...this.windows.values()];
    const focused = this.focused();
    if (!wins.length) { dock.hidden = true; dock.innerHTML = ''; return; }
    dock.hidden = false;
    const iconOf = (t) => svgIcon(t === 'browser' ? 'browser' : t === 'agent' ? 'agent' : t === 'files' ? 'files' : t === 'python' ? 'python' : t === 'editor' ? 'editor' : 'term');
    dock.innerHTML = `<button class="dock-item ${!focused ? 'focus' : ''}" data-desk="1" title="桌面终端">${svgIcon('term')}<b>desktop</b><span>jshel</span></button><div class="dock-sep"></div>` +
      wins.map(w => `<button class="dock-item ${w.minimized ? 'min' : ''} ${focused && focused.id === w.id ? 'focus' : ''}" data-win="${esc(w.id)}" title="${esc(w.title)}">
        <b>${iconOf(w.type)}</b><span>${esc(w.title)}</span></button>`).join('');
    $$('[data-win]', dock).forEach(b => b.onclick = () => this.toggleMin(b.dataset.win));
    const d = $('[data-desk]', dock);
    if (d) d.onclick = () => { for (const w of wins) this.minimize(w.id); };
  }
};
