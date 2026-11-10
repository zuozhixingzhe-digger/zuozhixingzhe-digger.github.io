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

/** 当前该接收按键的会话：有聚焦的终端窗口就用它，否则用启动时那扇终端。 */
function activeSession() {
  const w = (typeof WindowManager !== 'undefined') ? WindowManager.focused() : null;
  if (w && w.content && w.content.term && !w.content.disposed) return w.content;
  return TerminalManager.desktop;
}
/** 聚焦窗口若是 hsb2（没有 xterm 会话），顶栏按键要走它自己的键盘通道，
 * 否则会一路发给启动时那扇终端——这正是「顶栏 Ctrl / Esc 在 FreeBSD 里没反应」的原因。 */
function hsb2Focused() {
  const w = (typeof WindowManager !== 'undefined') ? WindowManager.focused() : null;
  const c = w && w.content;
  return (c && typeof c.typeTermSeq === 'function' && !c.disposed) ? c : null;
}
function keepTermFocus() {
  const vm = hsb2Focused();
  if (vm) { vm.focusTerm(); return; }
  const s = activeSession();
  if (s && s.term) { try { s.term.focus(); } catch (e) {} }
}
function sendKeyToTerm(text) {
  const vm = hsb2Focused();
  if (vm) {
    /* 顶栏的 Ctrl 是粘滞修饰键：先按终端语义改写，再交给虚拟机 */
    if (text) vm.typeTermSeq(Keys.active('ctrl') ? Keys.shape(text) : text);
    vm.focusTerm();
    return;
  }
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

/* ---------------------------------------------------------------- 补全目录
 * Tab 补全要知道「有哪些对象、每个对象有哪些成员、每个成员是干什么的」。
 *
 * 为什么在主线程算一次再发给 Worker：Worker 里的 `document` 是 Proxy，
 * `Object.getOwnPropertyNames` 拿不到真成员（跨线程没有同步反射）；而主线程
 * 反射一次只要 2~3ms，结果还能被所有终端复用。算完按对象名分组成表。
 *
 * 说明文字（DESC）只给常用项，剩下的靠反射补名单——宁可不解释，也不要漏。
 */
const HT_MEMBER_DESC = {
  'document.querySelector': '找第一个匹配的元素',
  'document.querySelectorAll': '找全部匹配的元素',
  'document.createElement': '建元素（还没进页面）',
  'document.getElementById': '按 id 找元素',
  'document.body': '页面 <body>',
  'document.head': '页面 <head>',
  'document.title': '标签页标题',
  'document.cookie': 'cookie（读写）',
  'document.write': '真·document.write，会清空整页',
  'document.addEventListener': '绑事件',
  'window.innerWidth': '视口宽',
  'window.innerHeight': '视口高',
  'window.open': '开新标签（本应用里被接管）',
  'window.location': '当前地址',
  'window.localStorage': '本地存储',
  'window.fetch': '发 HTTP 请求',
  'console.log': '打印（终端里显示）',
  'console.table': '打印表格',
  'console.time': '开始计时',
  'console.timeEnd': '结束计时并打印耗时',
  'FS.read': '读文件，返回内容',
  'FS.write': '写文件',
  'FS.list': '列目录',
  'FS.remove': '删除',
  'FS.move': '移动 / 改名',
  'FS.copy': '复制',
  'FS.exists': '是否存在',
  'FS.mkdir': '建目录',
  'FS.stat': '元信息',
  'Settings.get': '读设置',
  'Settings.set': '写设置',
  'Settings.all': '全部设置',
  'WindowManager.open': '开窗口',
  'WindowManager.close': '关窗口',
  'WindowManager.minimize': '最小化',
  'WindowManager.maxMode': '四种最大化',
  'WindowManager.snap': '吸附到预置布局',
  'WindowManager.list': '所有窗口',
  'TerminalManager.open': '开一个终端',
  'TerminalManager.active': '当前终端',
  'Math.random': '随机数 [0,1)',
  'Math.max': '最大值',
  'Math.floor': '向下取整',
  'JSON.stringify': '对象转字符串',
  'JSON.parse': '字符串转对象',
  'Promise.all': '等全部完成',
  'Promise.allSettled': '等全部落定（不抛错）',
  'Array.from': '类数组转数组',
  'Array.isArray': '是不是数组',
  'Object.keys': '取键',
  'Object.entries': '取键值对',
  'Object.assign': '合并属性',
  'String.raw': '模板串原始文本'
};

/* 这些是 Worker 里没有、但用户会想在 JSHeL 里调的主线程对象。
 * 只把名字发过去；成员靠 members 表。 */
const HT_SURFACE_NAMES = ['FS', 'Settings', 'WindowManager', 'TerminalManager', 'Drawer',
  'Guard', 'AppMenu', 'APP_DEFS', 'APP_DESC', 'HT_VERSION', 'toast', 'modal',
  'confirmDlg', 'promptDlg'];

let _htSurface = null;
function htSurface() {
  if (_htSurface) return _htSurface;
  /* 沿原型链收集到 3 层：DOM 的方法大多在 Element / Node 上，不在实例自己身上 */
  const members = (obj, depth) => {
    const out = new Set();
    let o = obj, n = 0;
    while (o && o !== Object.prototype && n < (depth || 3)) {
      try {
        for (const k of Object.getOwnPropertyNames(o)) {
          if (k === 'constructor' || k === '__proto__') continue;
          if (k[0] === '_') continue;          // 内部字段不进补全
          out.add(k);
        }
      } catch (e) {}
      try { o = Object.getPrototypeOf(o); } catch (e) { break; }
      n++;
    }
    return [...out].sort();
  };
  const roots = {
    window, document, console, Math, JSON, navigator, location, history,
    screen, localStorage, sessionStorage, performance, crypto, indexedDB,
    FS: typeof FS !== 'undefined' ? FS : null,
    Settings: typeof Settings !== 'undefined' ? Settings : null,
    WindowManager: typeof WindowManager !== 'undefined' ? WindowManager : null,
    TerminalManager: typeof TerminalManager !== 'undefined' ? TerminalManager : null,
    Drawer: typeof Drawer !== 'undefined' ? Drawer : null,
    Guard: typeof Guard !== 'undefined' ? Guard : null,
    AppMenu: typeof AppMenu !== 'undefined' ? AppMenu : null,
    APP_DEFS: typeof APP_DEFS !== 'undefined' ? APP_DEFS : null
  };
  const out = {};
  for (const [name, obj] of Object.entries(roots)) {
    if (!obj) continue;
    try { out[name] = members(obj); } catch (e) {}
  }
  /* 构造器：静态方法（Array.from / Object.keys）也要能补出来 */
  const ctors = {};
  for (const k of ['Array','String','Object','Number','Boolean','Function','Promise','Map','Set',
                   'Symbol','BigInt','RegExp','Date','Error','JSON','Math','Reflect','Intl',
                   'ArrayBuffer','Uint8Array','Float64Array','DataView','TextEncoder','TextDecoder',
                   'URL','URLSearchParams','Blob','File','FormData','Headers','Request','Response',
                   'AbortController','EventTarget','Event','CustomEvent','Node','Element','HTMLElement',
                   'HTMLCanvasElement','HTMLInputElement','HTMLElement']) {
    try {
      const c = window[k] || globalThis[k];
      if (c) ctors[k] = members(c, 2);
    } catch (e) {}
  }
  _htSurface = { members: out, ctors, desc: HT_MEMBER_DESC, extra: HT_SURFACE_NAMES };
  return _htSurface;
}

/** 桌面（#desk）的可用尺寸：窗口定位一律相对它，而不是整个视口 */
function deskBox() {
  const d = document.getElementById('desk');
  if (!d) return { x:0, y:0, left:0, top:0, w: window.innerWidth, h: window.innerHeight };
  const r = d.getBoundingClientRect();
  /* left / top 也要给：拖动吸附判断的是「指针相对桌面」的坐标，
   * 少了这两个值 px/py 会算成 NaN，四个边缘一个都命中不了。 */
  return {
    x: Math.round(r.left), y: Math.round(r.top),
    left: Math.round(r.left), top: Math.round(r.top),
    w: Math.max(120, Math.round(r.width)),
    h: Math.max(120, Math.round(r.height))
  };
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
    this._bindZoom();
    /* 这里**故意不 focus**。手机上一聚焦就弹输入法，开一扇终端窗口＝整屏被键盘吃掉。
     * 只有「页面加载完那一次」由 70-boot 聚焦那扇终端窗口，以及用户自己点进来才算数。 */
  }

  /* Ctrl / ⌘ + 滚轮：只缩放这一扇终端，别动全局字号。
   * 用 term.options.fontSize 而不是 CSS transform —— 字要重新排版、列数要跟着变，
   * 拉大 canvas 那种做法只会把字糊掉。 */
  _bindZoom() {
    const host = this.container;
    if (!host) return;
    this.fontSize = Number(Settings.get('font')) || 14;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.deltaY > 0 ? -1 : 1;
      const next = Math.max(8, Math.min(32, this.fontSize + step));
      if (next === this.fontSize) return;
      this.fontSize = next;
      try { this.term.options.fontSize = next; } catch (err) {}
      try { this.fit && this.fit.fit(); } catch (err) {}
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    this._zoomOff = () => host.removeEventListener('wheel', onWheel);
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
      wc: termWidthTable(this.term),
      /* 补全要用的「对象 → 成员」目录。主线程反射一次，Worker 直接查表：
       * Worker 里的 document 是代理，ownKeys 拿不到真成员；在这儿算一次最省。 */
      surface: htSurface()
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
    try { this._zoomOff && this._zoomOff(); } catch (e) {}
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

  /* 页面启动时的那一个终端。
   *
   * 0.0.1.34 起底部不再有「底层终端」——它就是**一扇普通终端窗口**，和其他终端
   * 窗口没有任何区别，只是开局就处于「隐藏式最大化」（铺满桌面、标题条收起）。
   * 于是「终端窗口」这个概念只剩一种，Dock、最小化、层叠对谁都一样。
   */
  bootDesktop() {
    if (this.desktop && !this.desktop.disposed) {
      const w = this.desktop.win;
      if (w && WindowManager.windows.has(w.id)) { WindowManager.maxMode(w.id, 'hidden'); return this.desktop; }
    }
    const win = WindowManager.open({ type:'shell', cwd:'.home', title:'终端 · .home', desktop:true });
    if (!win) return null;
    this.desktop = win.content;
    win.content.win = win;
    win.isDesktop = true;
    /* 先按普通窗口建出来（这样 restoreRect 记的是普通尺寸），再进隐藏式最大化：
     * 从胶囊还原时回到的是一个正常大小的窗口，而不是铺满屏幕。 */
    WindowManager.maxMode(win.id, 'hidden');
    return this.desktop;
  },

  create(opts) {
    const s = new TerminalSession(opts);
    this.sessions.add(s);
    const oldDispose = s.dispose.bind(s);
    s.dispose = () => {
      this.sessions.delete(s);
      /* 启动时那扇窗口也是普通窗口：它被关掉之后 desktop 必须跟着失效，
       * 否则顶栏按键、execInDesktop 会往一个已经 dispose 的会话里写东西。 */
      if (this.desktop === s) this.desktop = null;
      oldDispose();
    };
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

/* ---------------------------------------------------------------- 退出页面（关掉最后一个窗口） */
let exiting = false;
function exitDesktop() {
  if (exiting) return;
  exiting = true;
  toast('所有窗口都关了：这个页面准备退出……');
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
/* 标题塞不下时在中间截断（"hsb2 · Fre…第 1 层"），绝不动提手尺寸。
 * 先摘掉 max-width 量真实文本宽，再二分"前 n 字 + … + 后 n 字"。
 * 用 scrollWidth 而不是 canvas 测：和最终渲染用的是同一套字体与字距。 */
function midEllipsis(el, text, maxW){
  el.dataset.full = text || '';
  el.textContent = text || '';
  if (!maxW || maxW <= 0) return;
  el.style.maxWidth = 'none';
  if (el.scrollWidth <= maxW) { el.style.maxWidth = ''; return; }
  const ch = [...text];
  const build = n => ch.slice(0, n).join('') + '…' + ch.slice(ch.length - n).join('');
  let lo = 0, hi = Math.floor(ch.length / 2);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = build(mid);
    if (el.scrollWidth <= maxW) lo = mid; else hi = mid - 1;
  }
  el.textContent = lo > 0 ? build(lo) : '…';
  el.style.maxWidth = '';
}

/* 四个色点的字形（docs/thoughts/*.svg 的路径）。
 * 抽成常量是因为现在有三处要画它们：窗口标题条、四钮悬浮框、Dock 长按。 */
const WIN_DOT_SVG = {
  c: '<svg viewBox="0 0 40 40"><g transform="translate(1.142 -1.395) scale(.16939)" fill="#000" opacity=".58">' +
     '<path d="M 37.726 49.562 H 181.603 V 64.726 H 56.589 V 177.534 H 149.425 V 197.876 H 37.726 Z"/>' +
     '<path d="M 82.479 102.822 c 0,0 111.699,-38.466 102.452,100.233 c 0,0 -19.233,-61.397 -102.452,-99.863 z"/></g></svg>',
  m: '<svg viewBox="0 0 40 40"><g transform="translate(-.102 -7.278) scale(.19206)" fill="#000" opacity=".58">' +
     '<path d="M 39.945204 74.342465 H 169.39726 V 209.71233 c 0,0 7.76712,-87.28767 -129.452056,-135.369865 z"/></g></svg>',
  x: '<svg viewBox="0 0 40 40"><g transform="translate(-1.710 -11.983) scale(.21997)" fill="#000" opacity=".58">' +
     '<path d="M 32.3 86.3 C 76.86 132.90 78.26 151.82 41.1 204.5 C 93.50 175.78 113.34 175.56 165.10 203.1 C 121.96 156.77 121.92 139.09 164.9 92.6 C 108.11 113.12 86.89 112.12 32.3 86.3 Z"/></g></svg>',
  /* 最后一个窗口的红色按钮：三角朝左，意思是「这一下会把整个页面带走」 */
  exit: '<svg viewBox="0 0 40 40" class="ic-exit"><g fill="#000" opacity=".62">' +
     '<path d="M 30 6 L 8 20 L 30 34 Z"/></g></svg>',
  b: '<svg viewBox="0 0 40 40"><g fill="#000" opacity=".58">' +
     '<path d="M 11.94 7 H 22.40 V 15.61 H 16.07 V 24.31 H 11.94 Z"/>' +
     '<path fill-rule="evenodd" d="M 16.87 15.61 V 33 H 28.06 V 15.61 Z M 16.87 16.41 H 22.40 V 24.21 H 16.87 Z"/></g></svg>'
};

/* ---------------------------------------------------------------- 长按
 * 色点、Dock 图标、顶栏胶囊、四钮框里的圆钮——四处都是「按住不动 550ms」。
 * 以前这段每个地方抄一遍，改阈值要改四份；现在只留这一份。
 *
 * 两个细节：
 *   1) 手指一旦移动超过 8px 就取消——那是拖拽，不是长按；
 *   2) 长按弹框之后紧跟着的那次 click 必须吞掉，否则「长按红点」会先弹框再关窗。
 */
function bindLongPress(el, onLong, onMenu, ms) {
  const wait = ms || 550;
  let timer = 0, sx = 0, sy = 0, fired = false;
  const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    fired = false; sx = e.clientX; sy = e.clientY;
    clear();
    timer = setTimeout(() => { timer = 0; fired = true; onLong(); }, wait);
  });
  el.addEventListener('pointermove', e => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clear();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, clear));
  el.addEventListener('click', e => {
    if (!fired) return;
    fired = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
  if (onMenu) {
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      clear(); fired = false;
      onMenu();
    });
  }
}


/* 浮层定位：四钮框、详细菜单、标题气泡都是「贴着锚点下方居中，
 * 下面放不下就翻到上面，左右夹在视口内」。以前三处各抄一遍，改一处忘两处。 */
function placePopover(el, anchor, gap) {
  const g = gap == null ? 8 : gap;
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x = r.left + r.width / 2 - mw / 2;
  let y = r.bottom + g;
  let below = true;
  if (y + mh > innerHeight - 8) { y = r.top - mh - g; below = false; }
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  y = Math.max(8, Math.min(y, innerHeight - mh - 8));
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  /* 小尖角朝哪边：翻到上面时角要长在底边 */
  el.dataset.place = below ? 'below' : 'above';
}

const WindowManager = {
  windows: new Map(),
  z: 30,
  cascade: 0,

  init() {
    document.getElementById('window-layer').addEventListener('pointerdown', () => {}, { passive:true });
    this._initModeChrome();
  },

  /* 顶栏胶囊与全屏悬浮球：两个挂件的共同点是「点了就还原 / 退出」，
   * 区别是胶囊还带窗口操作（右键、长按弹四个动作）。 */
  _initModeChrome() {
    const chip = document.getElementById('hidChip');
    if (chip) {
      /* 单击 = 还原；长按 / 右键 = 四钮框（和窗口色点同一套手势） */
      bindLongPress(chip, () => ChipMenu.open(chip, chip.dataset.win),
                          () => ChipMenu.open(chip, chip.dataset.win));
      chip.addEventListener('click', () => {
        const id = chip.dataset.win;
        if (id) WindowManager.maxMode(id, 'normal');
      });
    }

    const ball = document.getElementById('imBall');
    if (!ball) return;
    let drag = null, moved = false;
    ball.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x:e.clientX, y:e.clientY, l:parseFloat(ball.style.left) || 0, t:parseFloat(ball.style.top) || 0 };
      moved = false;
      try { ball.setPointerCapture(e.pointerId); } catch (_) {}
      ball.classList.add('dragging');
    });
    ball.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const r = ball.getBoundingClientRect(), pad = 8;
      ball.style.left = clamp(drag.l + dx, pad, Math.max(pad, innerWidth - r.width - pad)) + 'px';
      ball.style.top = clamp(drag.t + dy, pad, Math.max(pad, innerHeight - r.height - pad)) + 'px';
    });
    const up = (e) => {
      if (!drag) return;
      drag = null;
      ball.classList.remove('dragging');
      try { ball.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved) WindowManager.exitImmersive();
    };
    ball.addEventListener('pointerup', up);
    ball.addEventListener('pointercancel', () => { drag = null; ball.classList.remove('dragging'); });
    addEventListener('resize', () => {
      if (ball.style.display !== 'none') WindowManager._placeImBall(ball);
    });
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
      calc:'计算器', data:'数据转换', color:'调色盘', markdown:'Markdown', htmlapp:'HTML 编辑器', bezier:'贝塞尔动效', shot:'截图', timer:'计时器', image:'看图修图', urlhash:'链接即状态',
      recorder:'录音机', geo:'定位', view3d:'3D 视图', audio:'音频播放', hsb2:'hsb2 · FreeBSD',
      applist:'所有应用', hanzi:'汉字码 · Hex ↔ Hanzi' };
    const TYPE_SIZE = { browser:[920, 620], files:[820, 540], shell:[780, 480], python:[820, 540], agent:[880, 600], editor:[860, 600], about:[560, 420],
      calc:[360, 560], data:[720, 600], color:[660, 560], markdown:[900, 600], htmlapp:[1040, 660], bezier:[860, 560], shot:[720, 620], timer:[420, 560], image:[940, 660], urlhash:[700, 620],
      recorder:[470, 560], geo:[470, 580], view3d:[760, 580], audio:[740, 560], hsb2:[820, 600],
      applist:[720, 560], hanzi:[880, 640] };
    opts.title = opts.title || TYPE_TITLES[opts.type] || '窗口';
    /* `jshel` 可以一层层开出新窗口，全都叫「终端」就分不清哪个是哪个了。
     * 后缀带上落地目录，cd 之后跟着变。 */
    if (opts.type === 'shell' && opts.title === '终端') opts.title = '终端 · ' + (opts.cwd || '.home');
    const { w:vw, h:vh } = deskBox();
    const base = TYPE_SIZE[opts.type] || [780, 500];
    const defW = Math.min(opts.w || base[0], vw - 24);
    /* 高度含顶部提手：调用方给的 w/h 一直指"画面"尺寸，提手另外加，
     * 否则窗口内容会比以前矮 44~74px。 */
    const hh0 = clamp(Math.round(defW * 0.1), 38, 86);
    /* Dock 是窗口下底的默认下限：新开的窗口不许压住它。
     * 只有用户随后自己拖动 / 缩放才可能越过这条线（那属于用户的决定）。 */
    const dockReserve = Number(Settings.get('dockHidden')) ? 20 : 82;
    const maxH = Math.max(240, vh - dockReserve);
    const defH = Math.min((opts.h || base[1]) + hh0, maxH);
    const n = this.cascade++ % 6;
    // 层叠步长要比标题栏（36px）大一点，否则两个窗口的标题栏会糊在一起像一条
    const x = opts.x != null ? opts.x : clamp(24 + n * 46, 8, Math.max(8, vw - defW - 8));
    const y = opts.y != null ? opts.y : clamp(12 + n * 42, 8, Math.max(8, vh - defH - dockReserve + 12));

    const el = document.createElement('section');
    el.className = 'win focus';
    el.dataset.id = id;
    el.style.cssText = `left:${x}px;top:${y}px;width:${defW}px;height:${defH}px;z-index:${++this.z}`;
    el.innerHTML = `<div class="win-tie"></div>
      <svg class="win-handle" viewBox="0 0 277 64" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="htHandleHi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".055"/>
          <stop offset=".55" stop-color="#fff" stop-opacity=".022"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient></defs>
        <path class="face" d="M 0 64 L 53.5 7 Q 53.5 0 60.5 0 L 216.5 0 Q 223.5 0 223.5 7 L 277 64 Z"/>
        <path d="M 0 64 L 53.5 7 Q 53.5 0 60.5 0 L 216.5 0 Q 223.5 0 223.5 7 L 277 64 Z" fill="url(#htHandleHi)"/>
        <path class="edge" d="M 0 64 L 53.5 7 Q 53.5 0 60.5 0 L 216.5 0 Q 223.5 0 223.5 7 L 277 64"
              fill="none"/>
      </svg>
      <div class="win-band"></div>
      <div class="win-screen"><div class="win-body"></div></div>
      <header class="win-bar">
        <div class="win-title">${esc(opts.title || ({ applist:'所有应用', hanzi:'汉字码 · Hex ↔ Hanzi' }[opts.type]) || '窗口')}</div>
        <div class="win-tools"></div>
        <button class="win-dot c" data-a="close" title="强制关闭" aria-label="强制关闭">${WIN_DOT_SVG.c}</button>
        <button class="win-dot m" data-a="min" title="最小化" aria-label="最小化">${WIN_DOT_SVG.m}</button>
        <button class="win-dot x" data-a="max" title="最大化" aria-label="最大化">${WIN_DOT_SVG.x}</button>
        <button class="win-dot b" data-a="back" title="置于底层" aria-label="置于底层">${WIN_DOT_SVG.b}</button>
      </header>
      <div class="rz n"></div><div class="rz s"></div><div class="rz w"></div><div class="rz e"></div>
      <div class="rz nw"></div><div class="rz ne"></div><div class="rz sw"></div><div class="rz se"></div>`;
    document.getElementById('window-layer').appendChild(el);

    const win = {
      id, el, type:opts.type || 'shell', app:opts.app || '', title:opts.title || ({ applist:'所有应用', hanzi:'汉字码 · Hex ↔ Hanzi' }[opts.type]) || '窗口',
      body: $('.win-body', el), minimized:false, maximized:false,
      /* 还原尺寸从一开始就是已知的（就是刚算出来的布局值）。
       * 不能留 null 等 maxMode 现取：入场动画是 scale(.06)→1，动画期间
       * getBoundingClientRect 给的是缩小后的尺寸，见 maxMode 里那段注释。 */
      restoreRect: { x, y, w:defW, h:defH },
      onClose:null, content:null, opts
    };
    this.windows.set(id, win);
    el.addEventListener('pointerdown', () => this.focus(id), true);
    $$('.win-dot', el).forEach(dot => {
      dot.addEventListener('pointerdown', e => e.stopPropagation());
      dot.addEventListener('click', e => {
        e.stopPropagation();
        const a = dot.dataset.a;
        if (a === 'close') this.close(id);
        else if (a === 'min') this.minimize(id);
        else if (a === 'max') this.toggleMax(id);
        /* 蓝点：直接压到最底（用户定的默认语义）。只下移一层的选项在右键菜单里。 */
        else if (a === 'back') this.sendToBack(id);
      });
      this._bindDotMenu(dot, id);
    });
    const bar = $('.win-bar', el);
    bar.addEventListener('pointerdown', e => this._startDrag(e, win));
    /* 双击标题条 = 最大化 / 还原。挂在窗口根上而不是 title 上：
     * 常规最大化时 .win-screen 会铺到 top:0，把标题条盖在下面，
     * 挂在 title 上的 dblclick 就收不到事件——「最大化之后双击取消不了」就是这个。 */
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.win-dot, .win-tools, input, textarea, select, button, .xterm')) return;
      const r = el.getBoundingClientRect();
      if (e.clientY - r.top > (win._hh || 56) + 2) return;   // 只有顶部那条带子算标题
      this.toggleMax(id);
    });
    this._bindTitleTip(win);

    /* 提手/色点/标题全部按窗口宽度重算：窗口 280 和 1600 用的是同一套比例，
     * 不是几档断点。ResizeObserver 盯 el 的宽度（最大化、拖边框都会触发）。 */
    this._layoutChrome(win);
    try {
      win._ro = new ResizeObserver(() => this._layoutChrome(win));
      win._ro.observe(el);
    } catch (e) {}
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
    /* Dock 折叠时没有图标可落，收到药丸上 */
    const pill = document.getElementById('dockPill');
    if (pill && !pill.hidden) {
      const r = pill.getBoundingClientRect();
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
          win.content.win = win;
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
        case 'htmlapp': win.content = new HtmlApp(win.body, opts); break;
        case 'bezier': win.content = new window.BezierApp(win.body, opts); break;
        case 'shot': win.content = new ShotApp(win.body, opts); break;
        case 'timer': win.content = new TimerApp(win.body, opts); break;
        case 'image': win.content = new ImageApp(win.body, opts); break;
        case 'urlhash': win.content = new UrlHashApp(win.body, opts); break;
        case 'recorder': win.content = new RecorderApp(win.body); break;
        case 'geo': win.content = new GeoApp(win.body); break;
        case 'view3d': win.content = new View3DApp(win.body); break;
        case 'audio': win.content = new AudioApp(win.body); break;
        case 'agent': win.content = new AgentApp(win.body, opts, win); break;
        case 'hsb2': win.content = new HSB2App(win.body, opts, win); break;
        case 'applist': win.content = new AppListApp(win.body, opts); break;
        case 'hanzi': win.content = new HanziApp(win.body, opts); break;
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
    if (e.button !== 0) return;
    if (e.isPrimary === false) return;
    if (e.target.closest('.win-dot') || e.target.closest('.win-tools')) return;
    const bar = e.currentTarget;
    const pid = e.pointerId;

    /* 最大化 / 隐藏式也能一把拖下来：按指针位置还原成普通窗口再跟手。
     * 以前这里遇到 maximized 直接 return，于是「最大化之后拖到左下角换布局」
     * 永远没反应——用户看到的就是「拖到左/右下角没法启动预设布局」。 */
    const mode0 = win.mode || (win.maximized ? 'max' : 'normal');
    if (mode0 !== 'normal') {
      const d0 = deskBox();
      const rr = win.restoreRect || { x:40, y:24, w:Math.min(760, d0.w - 40), h:Math.min(520, d0.h - 60) };
      const nx0 = Math.round(e.clientX - d0.left - rr.w / 2);
      const ny0 = Math.round(e.clientY - d0.top - 18);
      this.maxMode(win.id, 'normal');
      win.el.style.left = clamp(nx0, 90 - rr.w, d0.w - 90) + 'px';
      win.el.style.top = clamp(ny0, 0, Math.max(0, d0.h - 60)) + 'px';
      win.el.style.width = rr.w + 'px';
      win.el.style.height = rr.h + 'px';
    }

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

    let moved = false, snapPos = null, raf = 0, last = null;
    /* 拖动期间只改 transform，松手才把最终坐标写回 left/top。
     * 为什么：left/top 每帧都要重新布局整个窗口（含终端 canvas、iframe），
     * 内容会跟着重排重绘——用户看到的就是「拖动时内容闪」。transform 只走合成层，
     * 窗口里的东西一个像素都不用重画。 */
    let nx = ox, ny = oy;
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
      nx = clamp(Math.round(ox + dx), 90 - w0, box.w - 90);
      ny = clamp(Math.round(oy + dy), 0, box.h - (win._hh || 56));
      win.el.style.transform = 'translate3d(' + (nx - ox) + 'px,' + (ny - oy) + 'px,0)';
      win.el.classList.add('dragging');

      /* 边缘吸附：贴顶 = 最大化，贴左右 = 半屏，贴角 = 四分之一，
       * 贴底中间 = 最小化（黄色提示框）。角优先于边——不然在左上角永远只能拿到「左半屏」。
       *
       * 判据只有一个：**指针（鼠标 / 手指）的位置**。
       *   0.0.1.32 用的是提手矩形，其实是我把需求记错了——用户要的是
       *   「手指拖到哪儿，就算贴哪儿」。手指在屏幕最左边，才吸左半屏；
       *   手指还在窗口中间，窗口再靠边也不吸。
       * 阈值 10px：肉眼「几乎挨着」，不是「靠近了就算」。
       * 底部 28px：手指压到画布最下沿才算「拖到底」。 */
      const SNAP = 10, BOTTOM = 28;
      const px = ev.clientX - box.left;
      const py = ev.clientY - box.top;
      const nearL = px <= SNAP;
      const nearR = px >= box.w - SNAP;
      const nearT = py <= SNAP;
      const nearB = py >= box.h - BOTTOM;
      /* 底部中间：指针落在画布中段，且不贴左右（贴角另有语义） */
      const midX = !nearL && !nearR && px > box.w * 0.25 && px < box.w * 0.75;
      /* 只剩这一扇窗时，「拖到底 = 最小化」要变成「拖到底 = 不许」：
       * 框变灰，松手弹回**拖动前**的位置（不是松手的位置）。 */
      const solo = this.windows.size <= 1;
      if (nearB && midX) snapPos = solo ? 'minsolo' : 'min';
      else if (nearT && nearL) snapPos = 'tl';
      else if (nearT && nearR) snapPos = 'tr';
      else if (nearT) snapPos = 'full';
      else if (nearL && nearB) snapPos = 'bl';
      else if (nearR && nearB) snapPos = 'br';
      else if (nearL) snapPos = 'left';
      else if (nearR) snapPos = 'right';
      else snapPos = null;
      const rect = snapPos ? this._snapRect(snapPos) : null;
      if (rect) {
        snapEl.style.display = 'block';
        snapEl.style.left = rect.x + 'px'; snapEl.style.top = rect.y + 'px';
        snapEl.style.width = rect.w + 'px'; snapEl.style.height = rect.h + 'px';
        snapEl.dataset.pos = snapPos;
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
      /* 把合成层的位移兑现成真实坐标：顺序必须是「先写 left/top，再清 transform」，
       * 反过来的话会有一帧停在旧位置。 */
      if (moved) { win.el.style.left = nx + 'px'; win.el.style.top = ny + 'px'; }
      win.el.style.transform = '';
      if (snapEl) snapEl.style.display = 'none';
      if (snapPos === 'minsolo') {
        win.el.style.left = ox + 'px'; win.el.style.top = oy + 'px';
        if (window.toast) toast('最后一个窗口不能最小化：关掉它等于退出整个页面', 'warn');
      } else if (snapPos === 'min') {
        /* 先放回原位再收进 Dock：恢复时才回到用户原本的位置，而不是拖到底部的位置 */
        win.el.style.left = ox + 'px'; win.el.style.top = oy + 'px';
        this.minimize(win.id);
      } else if (snapPos) {
        /* 还原尺寸必须是「拖动前」的位置：此刻窗口已经跟着指针跑到边缘了，
         * 不先把旧坐标塞回去，snap() 会把边缘位置记成原始位置。 */
        win.restoreRect = { x:Math.round(ox), y:Math.round(oy), w:Math.round(w0), h:Math.round(h0) };
        win.mode = 'normal'; win.maximized = false;
        win.el.classList.remove('max', 'hidemax', 'immersive');
        win.el.style.left = ox + 'px'; win.el.style.top = oy + 'px';
        win.el.style.width = w0 + 'px'; win.el.style.height = h0 + 'px';
        this.snap(win.id, snapPos);
      }
      /* 触屏没有 dblclick：自己数两下。只认「没拖动的点按」，340ms 窗口。 */
      if (ev && ev.pointerType !== 'mouse' && !moved) {
        const now = performance.now();
        if (now - (this._tapT || 0) < 340 &&
            Math.hypot(ev.clientX - (this._tapX || 0), ev.clientY - (this._tapY || 0)) < 30) {
          this._tapT = 0;
          this.toggleMax(win.id);
        } else {
          this._tapT = now; this._tapX = ev.clientX; this._tapY = ev.clientY;
        }
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
    const MINW = 280, MINH = 150 + (win._hh || 56);
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
    if (typeof DotMenu !== 'undefined' && DotMenu.winId && DotMenu.winId !== id) DotMenu.close();
    /* 快路径：点的是已经聚焦的那扇窗。以前这里无条件重建整条 Dock 的 DOM——
     * 计算器里每点一个按键（pointerdown 会冒泡到这里）就 innerHTML 重排一次，
     * 连点两下时第二下要等重排完，手感就是「按了没反应」。 */
    if (this._focusedId === id && win.el.classList.contains('focus')) {
      win.el.style.zIndex = ++this.z;
      return;
    }
    /* 切窗口时把「上一个窗口里正在编辑的输入框」放掉。
     * 不这么做的话，手机上会一直挂着那块键盘：开计时器、开文件管理器，
     * 输入法还在耳边——因为焦点根本没离开上一个终端的 helper textarea。 */
    const act = document.activeElement;
    if (act && act !== document.body && !win.el.contains(act) &&
        (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA' || act.isContentEditable)) {
      try { act.blur(); } catch (e) {}
    }
    this._focusedId = id;
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
    /* 收起来之前必须先确认「收完之后桌面上还有看得见的东西」。
     * 只看窗口总数不够：两扇窗可以先后都收起来，于是空白桌面 + Dock 还在；
     * 更糟的是「收一扇 → 关掉另一扇」，剩下那扇还躺在最小化里，
     * 而这时窗口只剩一个、Dock 按规则不显示——它就再也回不来了（用户截图那张空白页）。
     * 所以判据是「其余未最小化的窗口数」，一扇不剩就拒绝，规则对所有窗口一致。 */
    const hidden = [...this.windows.values()].filter(x => x.id !== id && !x.minimized).length;
    if (this.windows.size <= 1 || hidden === 0) {
      if (window.toast) {
        toast(this.windows.size <= 1
          ? '最后一个窗口不能最小化（关掉它等于退出整个页面）'
          : '桌面上至少得留一扇看得见的窗口，这一扇不能收', 'warn');
      }
      return;
    }
    try { DotMenu.close(); } catch (e) {}
    w.minimized = true;
    /* 先算 Dock 位置再藏：_syncDock 之后图标位置才准，
     * 但 .min 会被 display:none 掉，所以顺序是 同步 Dock → 取点 → 动画 → 加 .min */
    this._syncDock();
    this._syncModeChrome();
    if (w.content && w.content.onHide) w.content.onHide();
    this._animMin(w, () => {
      /* 动画这 380ms 里可能已经被放回来了（比如它是最后一扇、被 _syncDock 兜底恢复），
       * 那时再加 .min 就会「状态是显示、画面却消失」。 */
      if (w.minimized) w.el.classList.add('min');
    });
  },
  restore(id) {
    const w = this.windows.get(id);
    if (!w) return;
    w.minimized = false;
    const wasMin = w.el.classList.contains('min');
    w.el.classList.remove('min');
    this._syncModeChrome();
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
  /* 绿色按钮单击 = 常规最大化 / 还原。
   * 另外三种（布局、隐藏式、彻底全屏）在它的右键菜单里。 */
  toggleMax(id) {
    const w = this.windows.get(id);
    if (!w) return;
    if (w.mode && w.mode !== 'normal') { this.maxMode(id, 'normal'); return; }
    this.maxMode(id, w.maximized ? 'normal' : 'max');
  },

  /* 窗口的四种形态，统一从一个口子进出，避免「最大化标记」和「DOM 类」打架。
   *   normal    普通窗口（可拖可缩）
   *   max       常规最大化：占满桌面，提手翻成倒梯形，标题带还在
   *   hidden    隐藏式最大化：占满桌面但把提手/标题条全收掉，顶栏留一个胶囊还原
   *   immersive 彻底全屏：连顶栏和 Dock 一起盖住，只留一个可拖的悬浮球退出
   */
  maxMode(id, mode) {
    const w = this.windows.get(id);
    if (!w) return;
    /* 形态一变，四钮框的锚点（色点 / 胶囊 / Dock）就没了，先收掉 */
    try { DotMenu.close(); } catch (e) {}
    mode = mode || 'normal';
    const el = w.el;
    const from = w.mode || (w.maximized ? 'max' : 'normal');
    if (mode === from) return;

    /* 只在「从普通窗口离开」时记还原尺寸；模式之间互转沿用同一份，
     * 否则 全屏 → 隐藏式 → 还原 会把全屏尺寸当成原始尺寸存下来。
     *
     * 这里必须用 offset*，不能用 getBoundingClientRect：
     * 入场动画是 @keyframes htWinIn{from{transform:scale(.06)}}，动画那 260ms 里
     * rect 拿到的是「被 transform 缩小后」的尺寸。而 bootDesktop() 恰恰是在
     * open() 之后**同步**调 maxMode(hidden) 的——于是启动那扇终端的还原尺寸
     * 被记成几十像素，从胶囊还原后只剩一条几乎看不见的窗缝。
     * offsetWidth/offsetHeight/offsetLeft/offsetTop 是布局盒，不受 transform 影响。
     * 再兜一层：万一拿到的仍是荒唐值（< 最小窗宽 / 最小窗高），退回默认尺寸。 */
    if (from === 'normal') {
      const db = document.getElementById('desk').getBoundingClientRect();
      const bw = Math.round(el.offsetWidth), bh = Math.round(el.offsetHeight);
      if (bw >= 280 && bh >= 200) {
        w.restoreRect = { x: Math.round(el.offsetLeft), y: Math.round(el.offsetTop), w: bw, h: bh };
      } else {
        w.restoreRect = {
          x: Math.round(db.width * 0.08), y: Math.round(db.height * 0.08),
          w: Math.min(760, db.width - 40), h: Math.min(520, db.height - 80)
        };
      }
    }

    el.classList.remove('max', 'hidemax', 'immersive');
    w.maximized = false;

    if (mode === 'normal') {
      /* 还原尺寸也校验一遍：万一某条路径写进了荒唐值（旧版本遗留的几十像素），
       * 回到默认尺寸总好过还原成一条窗缝。 */
      const rr = w.restoreRect;
      const good = rr && rr.w >= 280 && rr.h >= 200;
      const db = document.getElementById('desk').getBoundingClientRect();
      const r = good ? rr : {
        x: Math.round(db.width * 0.08), y: Math.round(db.height * 0.08),
        w: Math.min(760, db.width - 40), h: Math.min(520, db.height - 80)
      };
      if (!good) w.restoreRect = r;
      el.classList.add('tween');
      clearTimeout(w._tweenT);
      w._tweenT = setTimeout(() => el.classList.remove('tween'), 320);
      el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
      el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
      w.mode = 'normal';
    } else {
      el.classList.add('tween');
      clearTimeout(w._tweenT);
      w._tweenT = setTimeout(() => el.classList.remove('tween'), 320);
      el.style.left = '0px'; el.style.top = '0px';
      el.style.width = '100%'; el.style.height = '100%';
      w.mode = mode;
      if (mode === 'max') { el.classList.add('max'); w.maximized = true; }
      else if (mode === 'hidden') el.classList.add('hidemax');
      else if (mode === 'immersive') el.classList.add('immersive');
    }

    /* 同一个桌面只留一个隐藏式 / 全屏窗口：新的进来，旧的就退回常规最大化 */
    if (mode === 'hidden' || mode === 'immersive') {
      for (const o of this.windows.values()) {
        if (o.id !== id && (o.mode === 'hidden' || o.mode === 'immersive')) this.maxMode(o.id, 'max');
      }
    }
    /* 彻底全屏是「真的全屏」：连浏览器的地址栏/标签栏一起让出去。
     * 顶栏那个全屏按钮也要跟着亮起来（虽然这时它通常已经被盖住了）。 */
    if (mode === 'immersive') this._enterBrowserFS();
    else if (from === 'immersive') this._exitBrowserFS();
    this._syncModeChrome();
    this.focus(id);
    setTimeout(() => w.content && w.content.onResize && w.content.onResize(), 60);
  },

  /* 进入 / 退出浏览器真全屏。失败是正常的：headless、iframe、没有用户手势
   * 都会被浏览器拒绝——拒绝就当软件级全屏，不打扰用户。 */
  _enterBrowserFS() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      try {
        const p = req.call(el, { navigationUI:'hide' });
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
    setTimeout(() => { try { typeof syncFullscreenBtn === 'function' && syncFullscreenBtn(); } catch (e) {} }, 220);
  },
  _exitBrowserFS() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
    }
    setTimeout(() => { try { typeof syncFullscreenBtn === 'function' && syncFullscreenBtn(); } catch (e) {} }, 220);
  },

  /* 顶栏胶囊 + 全屏悬浮球，都只服务「当前那一扇」特殊窗口 */
  _syncModeChrome() {
    const hidden = [...this.windows.values()].find(w => w.mode === 'hidden' && !w.minimized);
    const im = [...this.windows.values()].find(w => w.mode === 'immersive' && !w.minimized);
    document.body.classList.toggle('immersive', !!im);
    const chip = document.getElementById('hidChip');
    if (chip) {
      chip.classList.toggle('on', !!hidden);
      chip.dataset.win = hidden ? hidden.id : '';
      /* 只有图标，没有文字，也不挂原生 title 气泡——长按/右键才是四钮框。 */
      chip.removeAttribute('title');
    }
    const ball = document.getElementById('imBall');
    if (ball) {
      ball.style.display = im ? 'grid' : 'none';
      if (im) this._placeImBall(ball);
    }
    this._imWin = im ? im.id : null;
  },

  /* 悬浮球只允许待在画布内：拖动时按尺寸夹住，窗口变化 / 旋转屏后重夹一次 */
  _placeImBall(ball) {
    if (!ball) return;
    const b = ball.getBoundingClientRect();
    const pad = 8;
    let x = parseFloat(ball.style.left), y = parseFloat(ball.style.top);
    if (!Number.isFinite(x)) x = innerWidth - b.width - 18;
    if (!Number.isFinite(y)) y = innerHeight - b.height - 18;
    x = clamp(x, pad, Math.max(pad, innerWidth - b.width - pad));
    y = clamp(y, pad, Math.max(pad, innerHeight - b.height - pad));
    ball.style.left = x + 'px';
    ball.style.top = y + 'px';
  },

  /* 退出当前特殊形态（供 chip / 悬浮球 / 键盘调用） */
  exitImmersive() {
    const id = this._imWin || [...this.windows.values()].find(w => w.mode === 'immersive')?.id;
    if (id) this.maxMode(id, 'normal');
    else { document.body.classList.remove('immersive'); this._syncModeChrome(); }
  },
  close(id) {
    const w = this.windows.get(id);
    if (!w) return;
    if (w.closing) return;
    try { if (DotMenu.winId === id) DotMenu.close(); } catch (e) {}
    w.closing = true;
    if (w.onClose) { try { w.onClose(); } catch (e) {} }
    /* 内容先 dispose，释放 worker / iframe；视觉上再慢慢溶解掉 */
    if (w.content && w.content.dispose) { try { w.content.dispose(); } catch (e) {} }
    if (w._ro) { try { w._ro.disconnect(); } catch (e) {} }
    this.windows.delete(id);
    const lastOne = this.windows.size === 0;
    const wasImmersive = w.mode === 'immersive';
    if (w.mode === 'hidden' || w.mode === 'immersive') w.mode = 'normal';
    if (wasImmersive) this._exitBrowserFS();
    this._syncModeChrome();
    this._syncDock();
    this._animOut(w, () => { try { w.el.remove(); } catch (e) {} });
    /* 最后一扇窗关上 = 这个页面「退出」。不是留在桌面上看空白——
     * 桌面空白等于没有系统，语义上和终端里敲 exit 完全一致。 */
    if (lastOne) setTimeout(() => exitDesktop(), 120);
  },
  closeFocused() {
    const w = this.focused();
    if (w) this.close(w.id);
  },

  /* 色点：长按 → 四钮悬浮框；右键 → 完整菜单（带文字，含形态与吸附）。 */
  _bindDotMenu(dot, id) {
    const act = dot.dataset.a;
    bindLongPress(dot, () => DotMenu.open(dot, id), () => WinMenu.open(dot, id, act));
  },

  /* 标题被中间截断时，完整标题得有个地方看：
   * 桌面悬停 500ms、触屏长按 500ms、右键，三条路都通向同一个气泡。 */
  _bindTitleTip(win) {
    const bar = $('.win-bar', win.el);
    const t = $('.win-title', win.el);
    if (!bar || !t) return;
    const truncated = () => t.textContent !== (win.title || '');
    let timer = 0, sx = 0, sy = 0, longPressed = false, inside = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    /* 标题本身 pointer-events:none（不然会挡住拖动），所以不能靠 e.target 判断，
     * 只能拿坐标和标题实际矩形比。 */
    const overTitle = (e) => {
      const r = t.getBoundingClientRect();
      return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right &&
             e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const arm = (e) => {
      clear();
      if (!truncated()) return;
      sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { timer = 0; longPressed = true; TitleTip.show(win, t); }, 500);
    };
    const leave = () => { inside = false; clear(); TitleTip.hide(); };

    bar.addEventListener('pointermove', e => {
      const now = overTitle(e);
      if (now && !inside) { inside = true; arm(e); }
      else if (!now && inside) leave();
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clear();
    });
    bar.addEventListener('pointerdown', e => {
      if (!overTitle(e)) return;
      longPressed = false;
      arm(e);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t2 =>
      bar.addEventListener(t2, () => { clear(); if (t2 === 'pointerleave') leave(); }));
    bar.addEventListener('contextmenu', e => {
      if (!overTitle(e)) return;
      e.preventDefault();
      TitleTip.show(win, t);
    });
    bar.addEventListener('click', () => { if (longPressed) { longPressed = false; TitleTip.hide(); } });
  },

  /* 红色：关掉所有同类型窗口（「相关应用」按 type 算，不碰别的类型）。
   * hsb2 的 dispose 会顺带停掉 v86，不需要单独处理。 */
  closeType(type) {
    const list = [...this.windows.values()].filter(w => w.type === type);
    for (const w of list) this.close(w.id);
    return list.length;
  },

  /* 蓝色：只与紧邻的下层窗口交换 z，不是「压到最底」。
   * 交换后焦点给下层那扇窗——否则 focus 会把它重新提到最上层，等于没动。 */
  sendDown(id) {
    const w = this.windows.get(id);
    if (!w) return false;
    if (this.windows.size <= 1) { if (window.toast) toast('只有一个窗口，没有可换层的对象', 'warn'); return false; }
    const z = +(w.el.style.zIndex || 0);
    let below = null;
    for (const o of this.windows.values()) {
      if (o === w || o.minimized) continue;
      const oz = +(o.el.style.zIndex || 0);
      if (oz < z && (!below || oz > +(below.el.style.zIndex || 0))) below = o;
    }
    if (!below) {
      if (window.toast) toast('已经在最下层：下面没有窗口了', 'warn');
      return false;
    }
    const bz = +(below.el.style.zIndex || 0);
    w.el.style.zIndex = bz;
    below.el.style.zIndex = z;
    w.el.classList.remove('focus');
    below.el.classList.add('focus');
    this._syncDock();
    return true;
  },

  /* 绿色：把窗口吸到桌面的一半 / 四分之一。full 仍走 maximized 标记，
   * 这样再点绿点能还原回原来的位置。 */
  /* 吸附目标的几何：屏幕坐标系（相对 #desk），拖动预览与真吸附共用一份 */
  _snapRect(pos) {
    const d = deskBox();
    const hw = Math.round(d.w / 2), hh = Math.round(d.h / 2);
    const map = {
      full:{ x:0, y:0, w:d.w, h:d.h },
      left:{ x:0, y:0, w:hw, h:d.h },
      right:{ x:hw, y:0, w:hw, h:d.h },
      tl:{ x:0, y:0, w:hw, h:hh }, tr:{ x:hw, y:0, w:hw, h:hh },
      bl:{ x:0, y:hh, w:hw, h:hh }, br:{ x:hw, y:hh, w:hw, h:hh },
      /* 底部中间：不是一块吸附区域，只是「松手就最小化」的提示框 */
      min:{ x:Math.round(d.w * 0.29), y:Math.max(0, d.h - 150), w:Math.round(d.w * 0.42), h:88 },
      /* 单窗口时同一个位置，只是配色变灰（CSS [data-pos=minsolo]） */
      minsolo:{ x:Math.round(d.w * 0.29), y:Math.max(0, d.h - 150), w:Math.round(d.w * 0.42), h:88 }
    };
    return map[pos] || null;
  },

  snap(id, pos) {
    const w = this.windows.get(id);
    if (!w) return;
    const r = this._snapRect(pos);
    if (!r) return;
    if (!w.restoreRect) {
      const rr = w.el.getBoundingClientRect();
      const db = document.getElementById('desk').getBoundingClientRect();
      w.restoreRect = { x:rr.left-db.left, y:rr.top-db.top, w:rr.width, h:rr.height };
    }
    w.el.classList.add('tween');
    clearTimeout(w._tweenT);
    w._tweenT = setTimeout(() => w.el.classList.remove('tween'), 320);
    w.el.style.left = r.x + 'px';
    w.el.style.top = r.y + 'px';
    w.el.style.width = r.w + 'px';
    w.el.style.height = r.h + 'px';
    /* 吸附到全屏 = 常规最大化，走 modes 同一套类，绿点菜单和拖拽才不会各说各话 */
    w.el.classList.remove('hidemax', 'immersive');
    w.maximized = (pos === 'full');
    w.mode = pos === 'full' ? 'max' : 'normal';
    w.el.classList.toggle('max', pos === 'full');
    this._syncModeChrome();
    this.focus(id);
    setTimeout(() => w.content && w.content.onResize && w.content.onResize(), 60);
  },
  /* ---------------------------------------------------------------- 窗口 chrome
   * 所有尺寸都从窗口宽度按原稿比例推出来（docs/thoughts/README.md）：
   *   提手宽 43.3% · 提手高 10% · 色点 ⌀6.25% · 外点 ±0.735×提手宽 · 内点 ±0.536×提手宽
   * 上下限只防止极端尺寸下糊成一片，不改变比例关系。
   * 这里写 CSS 变量而不是直接量元素：色点/标题都是 calc(var(--x)) 定位，
   * 一处更新全体跟随，拖动边框时也不会抖。
   */
  _layoutChrome(win) {
    const el = win.el;
    if (!el || !el.isConnected) return;
    const W = el.clientWidth || 640;
    /* 严格按窗口宽度成比例：窗口 240–736 这一段完全线性（也正是绝大多数窗口的宽度），
     * 超出这段才用上下限收住——1920 宽的窗口若还按 6.25% 算，色点会有 120px，
     * 直接盖住半条标题。上下限只兜极值，不参与常规尺寸。 */
    const dot = clamp(Math.round(W * 0.0625), 14, 46);
    const hh  = clamp(Math.round(W * 0.1), 38, 86);
    const hw  = clamp(Math.round(W * 0.433), 150, 430);
    let offOut = hw * 0.735, offIn = hw * 0.536;
    /* 窄窗：四个点不能跑出窗口。按可用半宽整体等比收，别只夹外点——
     * 只夹外点会让内外两对挤在一起，看着像两个点。 */
    const lim = W / 2 - dot / 2 - 6;
    if (offOut > lim) { const k = lim / offOut; offOut *= k; offIn *= k; }
    const tfs = clamp(W * 0.0263, 11.5, 15.5);
    el.style.setProperty('--dot', dot + 'px');
    el.style.setProperty('--hh', hh + 'px');
    el.style.setProperty('--hw', hw + 'px');
    el.style.setProperty('--offout', offOut.toFixed(1) + 'px');
    el.style.setProperty('--offin', offIn.toFixed(1) + 'px');
    el.style.setProperty('--tfs', tfs.toFixed(1) + 'px');
    win._hh = hh;
    this._fitTitle(win);
  },

  _fitTitle(win) {
    const t = $('.win-title', win.el);
    if (!t) return;
    const maxW = parseFloat(getComputedStyle(t).maxWidth) || 0;
    midEllipsis(t, win.title || '', maxW);
  },

  /* 蓝点：把这扇窗压到所有窗口下面，露出别人。
   * 没有别的窗口时不做无意义的 z 调整，给一句提示。 */
  sendToBack(id) {
    const w = this.windows.get(id);
    if (!w) return false;
    if (this.windows.size <= 1) { if (window.toast) toast('只有一个窗口，它已经在最底层了', 'warn'); return false; }
    const others = [...this.windows.values()].filter(x => x.id !== id && !x.minimized && x.el.isConnected);
    if (!others.length) {
      if (window.toast) toast('已经是最底层：没有其它窗口可以露出', 'warn');
      return false;
    }
    others.sort((a, b) => (+a.el.style.zIndex || 0) - (+b.el.style.zIndex || 0));
    let z = 1;
    for (const o of others) o.el.style.zIndex = ++z;
    w.el.style.zIndex = 0;
    this.z = Math.max(this.z, z);
    this.focus(others[others.length - 1].id);
    return true;
  },

  setTitle(id, t) {
    const w = this.windows.get(id);
    if (!w) return;
    w.title = t;
    this._fitTitle(w);
    this._syncDock();
  },
  list() { return [...this.windows.values()].map(w => ({ id:w.id, type:w.type, title:w.title, minimized:w.minimized, maximized:w.maximized })); },

  _syncDock() {
    const dock = document.getElementById('dock');
    if (!dock) return;
    const wrap = document.getElementById('dockWrap');
    const pill = document.getElementById('dockPill');
    /* Dock 是否显示由设置决定；这里只管类，避免每次开窗都读一遍 localStorage */
    const off = !!Number(Settings.get('dockHidden'));
    const folded = !off && !!Number(Settings.get('dockFold'));
    document.body.classList.toggle('dock-off', off);
    document.body.classList.toggle('dock-folded', folded);
    const wins = [...this.windows.values()];
    /* 兜底：桌面上不能一扇看得见的窗口都没有。
     * minimize() 已经拦住了「直接收到零」，但「收一扇 → 再关掉另一扇」会漏过去：
     * 剩下那扇还躺在最小化里，而此时窗口只剩一个、Dock 按规则不显示，
     * 它就没有任何入口能回来了（用户看到的就是一张空白页）。
     * 真出现就强制把最后一扇放出来——用户的原话：「把剩下这个最小化的窗口强制显示出来」。
     * 放到 setTimeout 里：restore() 会回调本函数，同步调用会自己套自己。 */
    if (wins.length && wins.every(w => w.minimized)) {
      const last = wins[wins.length - 1];
      setTimeout(() => {
        this.restore(last.id);
        if (window.toast) toast('桌面上得留一扇窗口，已把「' + last.title + '」放回来', 'info');
      }, 0);
    }
    const focused = this.focused();
    this._syncSolo(wins);
    /* 窗口总数 ≤ 1 时 Dock 直接不显示——不是「隐藏」，是按规则不存在：
     * 一个窗口没什么可切换的，而最后一个窗口又不许最小化，Dock 没有任何用处。 */
    const solo = wins.length <= 1;
    document.body.classList.toggle('dock-solo', solo);
    if (!wins.length || solo) {
      dock.innerHTML = '';
      if (wrap) wrap.hidden = true;
      if (pill) pill.hidden = true;
      this._syncWinList();
      this._syncAppList();
      return;
    }
    /* 折叠后连把手一起收走，只留底部药丸 */
    if (wrap) wrap.hidden = folded;
    dock.hidden = folded;
    if (pill) {
      pill.hidden = !folded;
      const n = document.getElementById('dockPillN');
      if (n) n.textContent = String(wins.length);
    }
    const iconOf = (t) => svgIcon(t === 'browser' ? 'browser' : t === 'agent' ? 'agent' : t === 'files' ? 'files' : t === 'python' ? 'python' : t === 'editor' ? 'editor' : 'term');
    dock.innerHTML = wins.map(w => `<button class="dock-item ${w.minimized ? 'min' : ''} ${focused && focused.id === w.id ? 'focus' : ''}" data-win="${esc(w.id)}" title="${esc(w.title)}">
        <b>${iconOf(w.type)}</b><span>${esc(w.title)}</span></button>`).join('');
    $$('[data-win]', dock).forEach(b => {
      b.onclick = () => this.toggleMin(b.dataset.win);
      this._bindDockMenu(b);
    });
    this._bindDockFold();
    this._syncWinList();
    this._syncAppList();
  },

  /* 只有一个窗口时：红点变「退出」三角，黄/蓝点变灰（CSS 负责），
   * 菜单里对应的条目也置灰。每次窗口增减都刷一次，状态永远跟着实际同步。 */
  _syncSolo(wins) {
    const solo = (wins || [...this.windows.values()]).length <= 1;
    for (const w of this.windows.values()) {
      if (w.el.classList.contains('solo') === solo) continue;
      w.el.classList.toggle('solo', solo);
      const c = $('.win-dot.c', w.el);
      if (c) {
        c.innerHTML = solo ? WIN_DOT_SVG.exit : WIN_DOT_SVG.c;
        c.title = solo ? '退出：关掉最后一个窗口，整个页面随之退出' : '强制关闭';
      }
      const m = $('.win-dot.m', w.el);
      if (m) m.title = solo ? '最后一个窗口不能最小化' : '最小化';
      const b = $('.win-dot.b', w.el);
      if (b) b.title = solo ? '最后一个窗口不能改变层级' : '置于底层';
    }
  },

  /* Dock 图标：单击切换最小化（原有），长按 550ms 弹四钮框。
   * 和窗口色点、顶栏胶囊是同一个框——用户不用记三套菜单。 */
  _bindDockMenu(b) {
    bindLongPress(b, () => DotMenu.open(b, b.dataset.win), () => DotMenu.open(b, b.dataset.win));
  },

  /* 折叠 / 展开：把手点一下、Dock 往下拖、药丸往上滑、药丸点一下 —— 四条路都通 */
  setFold(on) {
    on = !!on;
    if (!!Number(Settings.get('dockFold')) === on) return;
    Settings.set('dockFold', on ? 1 : 0);
    this._syncDock();
    if (on) {
      const p = document.getElementById('dockPill');
      if (p) { p.classList.remove('pulse'); void p.offsetWidth; p.classList.add('pulse'); }
    }
  },

  _bindDockFold() {
    if (this.__foldBound) return;
    this.__foldBound = true;
    const dock = document.getElementById('dock');
    const fold = document.getElementById('dockFold');
    const pill = document.getElementById('dockPill');
    if (fold) fold.onclick = (e) => { e.stopPropagation(); this.setFold(true); };
    if (pill) {
      pill.onclick = () => this.setFold(false);
      let py = 0, pOn = false;
      pill.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        pOn = true; py = e.clientY;
      }, { passive: true });
      pill.addEventListener('pointermove', (e) => {
        if (!pOn) return;
        if (py - e.clientY > 22) { pOn = false; this.setFold(false); }
      }, { passive: true });
      pill.addEventListener('pointerup', () => { pOn = false; }, { passive: true });
    }
    if (dock) {
      let sy = 0, on = false, moved = false;
      dock.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('#dock')) { on = true; moved = false; sy = e.clientY; }
      }, { passive: true });
      dock.addEventListener('pointermove', (e) => {
        if (!on) return;
        const dy = e.clientY - sy;
        if (dy > 26) { on = false; moved = true; this.setFold(true); }
        else if (dy < -26) on = false;
      }, { passive: true });
      dock.addEventListener('pointerup', () => {
        if (moved) {
          /* 拖完别再顺手触发「最小化这个窗口」 */
          dock.__swallow = true;
          setTimeout(() => { dock.__swallow = false; }, 0);
        }
        on = false;
      }, { passive: true });
      dock.addEventListener('click', (e) => {
        if (dock.__swallow) { e.stopPropagation(); e.preventDefault(); }
      }, true);
    }
  },

  /* 「所有应用」窗口开着时，窗口开合要让它把「打开 / 切换」重新算一遍 */
  _syncAppList() {
    for (const w of this.windows.values()) {
      if (w.type === 'applist' && w.content && w.content.refresh) {
        try { w.content.refresh(); } catch (e) {}
      }
    }
  },

  /* 抽屉开着时同步窗口列表；关着就等下次 open 再刷，别做无用的 DOM 重排 */
  _syncWinList() {
    if (typeof Drawer !== 'undefined' && Drawer.opened) {
      try { Drawer.refreshWins(); } catch (e) {}
    }
  }
};

/* ---------------------------------------------------------------- 四钮悬浮框
 * 红黄绿蓝横排，没有任何文字说明（用户明确要求）。
 * 窗口色点长按、顶栏隐藏式胶囊长按/右键、Dock 图标长按，三处共用。
 * 红=强制关闭（彻底结束，没有「后台」）· 黄=最小化/还原 · 绿=最大化/还原 · 蓝=压到最底层。 */
const DotMenu = {
  el: null, anchor: null, winId: null,
  open(anchor, id) {
    this.close();
    const w = WindowManager.windows.get(id);
    if (!w) return;
    const m = document.createElement('div');
    m.className = 'dotmenu';
    m.innerHTML =
      `<button class="win-dot c" data-a="close" aria-label="强制关闭">${WIN_DOT_SVG.c}</button>` +
      `<button class="win-dot m" data-a="min" aria-label="最小化">${WIN_DOT_SVG.m}</button>` +
      `<button class="win-dot x" data-a="max" aria-label="最大化">${WIN_DOT_SVG.x}</button>` +
      `<button class="win-dot b" data-a="back" aria-label="置于底层">${WIN_DOT_SVG.b}</button>`;
    if (WindowManager.windows.size <= 1) m.classList.add('solo');
    document.body.appendChild(m);
    placePopover(m, anchor, 9);

    m.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      const solo = WindowManager.windows.size <= 1;
      if (solo && (a === 'min' || a === 'back')) {
        if (window.toast) toast(a === 'min' ? '最后一个窗口不能最小化' : '最后一个窗口不能改变层级', 'warn');
        return;              // 不关框：用户还能改主意选别的
      }
      this.close();
      if (a === 'close') WindowManager.close(id);
      else if (a === 'min') { if (w.minimized) WindowManager.restore(id); else WindowManager.minimize(id); }
      else if (a === 'max') {
        const cur = w.mode || (w.maximized ? 'max' : 'normal');
        WindowManager.maxMode(id, (cur === 'normal') ? 'max' : (cur === 'max' ? 'normal' : 'max'));
      } else if (a === 'back') WindowManager.sendToBack(id);
    });
    /* 二级菜单：四钮框里的圆钮再长按一次，展开这个动作的完整菜单。
     * 手势和窗口色点完全一样（bindLongPress），框也复用 WinMenu——
     * 只是锚点从色点换成了框里的圆钮。 */
    $$('.win-dot[data-a]', m).forEach(btn => bindLongPress(btn, () => {
      const a = btn.dataset.a;
      /* 二级框加一枚小尖角：形状和一级菜单略有不同，但 DOM 与内容完全复用。
       * **一级框不关**——用户要的是「两个都在」，直到点别处或真的选了一项。 */
      const sub = WinMenu.open(btn, id, a);
      if (sub) { sub.classList.add('lv2'); WinMenu._parent = this; }
    }));
    this.el = m; this.anchor = anchor; this.winId = id;
    setTimeout(() => {
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
      addEventListener('resize', this._close, { once:true });
    }, 0);
  },
  _outside(e) {
    if (!DotMenu.el) return;
    /* 点二级菜单不算「点外面」——它就是从这一级长出来的 */
    if (typeof WinMenu !== 'undefined' && WinMenu.el && WinMenu.el.contains(e.target)) return;
    if (!DotMenu.el.contains(e.target) && !(DotMenu.anchor && DotMenu.anchor.contains(e.target))) DotMenu.close();
  },
  _esc(e) { if (e.key === 'Escape') DotMenu.close(); },
  _close() { DotMenu.close(); },
  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null; this.anchor = null; this.winId = null;
    document.removeEventListener('pointerdown', this._outside, true);
    document.removeEventListener('keydown', this._esc, true);
  }
};

/* 胶囊菜单保留名字（老代码还在调），内容就是四钮框。 */
const ChipMenu = {
  open(anchor, id) { DotMenu.open(anchor, id); },
  close() { DotMenu.close(); }
};

/* ---------------------------------------------------------------- 色点菜单
 * 右键 / 长按四个色点出来的小菜单。红=关掉同类全部，黄=占位，
 * 绿=吸边布局，蓝=层叠。菜单只读 WindowManager 的状态，不改自己的数据。 */
const WinMenu = {
  el: null, winId: null,
  open(dot, id, act) {
    this.close();
    const w = WindowManager.windows.get(id);
    if (!w) return;
    const m = document.createElement('div');
    m.className = 'winmenu';
    m.innerHTML = this._html(w, act);
    document.body.appendChild(m);
    placePopover(m, dot, 8);

    m.addEventListener('click', e => {
      const b = e.target.closest('[data-snap]');
      if (b) { this.closeAll(); WindowManager.snap(id, b.dataset.snap); return; }
      const md = e.target.closest('[data-mode]');
      if (md) { this.closeAll(); WindowManager.maxMode(id, md.dataset.mode); return; }
      const c = e.target.closest('[data-cmd]');
      if (!c) return;
      const cmd = c.dataset.cmd;
      /* 置灰的条目：不执行、不关框，只说明原因 */
      if (c.disabled || c.classList.contains('is-off')) return;
      this.closeAll();
      if (cmd === 'close-type') WindowManager.closeType(w.type);
      else if (cmd === 'close-one') WindowManager.close(id);
      else if (cmd === 'down') WindowManager.sendDown(id);
      else if (cmd === 'bottom') WindowManager.sendToBack(id);
      else if (cmd === 'min-one') WindowManager.minimize(id);
      else if (cmd === 'min-type') {
        for (const x of [...WindowManager.windows.values()]) {
          if (x.type === w.type && !x.minimized) WindowManager.minimize(x.id);
        }
      }
      else if (cmd === 'mintype') WindowManager.minimize(id);
    });

    this.el = m;
    this.winId = id;
    this._dot = dot;
    /* 这里以前 return 在 addEventListener 前面 —— 监听器永远不会挂上，
     * 于是「点外面不关」「Esc 不关」两个都失效。 */
    setTimeout(() => {
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }, 0);
    return m;
  },
  /* 选中一项：二级框和它下面的一级框一起收 */
  closeAll() {
    const p = this._parent;
    this._parent = null;
    this.close();
    if (p) { try { p.close(); } catch (e) {} }
  },
  _html(w, act) {
    const t = esc(w.type);
    const solo = WindowManager.windows.size <= 1;
    const off = (why) => solo ? ` is-off" title="${esc(why)}` : '';
    if (act === 'close') {
      const n = [...WindowManager.windows.values()].filter(x => x.type === w.type).length;
      return `<div class="winmenu__title">红色 · 强制退出</div>
        <button class="danger" data-cmd="close-type">关闭所有「${t}」窗口（${n}）</button>
        <button data-cmd="close-one">只关闭这一个</button>`;
    }
    if (act === 'min') {
      const same = [...WindowManager.windows.values()].filter(x => x.type === w.type && !x.minimized).length;
      return `<div class="winmenu__title">黄色 · 最小化</div>
        ${solo ? '<div class="wm-note">这是最后一个窗口：收了它页面就空了，所以不允许最小化。</div>' : ''}
        <button class="stack${off('最后一个窗口不能最小化')}" data-cmd="min-one" ${solo ? 'disabled' : ''}><span>收进 Dock</span><em>点 Dock 上的图标再回来</em></button>
        <button class="stack${off('最后一个窗口不能最小化')}" data-cmd="min-type" ${solo ? 'disabled' : ''}><span>同类一起收（${same}）</span><em>把所有「${t}」窗口都最小化</em></button>`;
    }
    if (act === 'max') {
      const cur = w.mode || (w.maximized ? 'max' : 'normal');
      const che = (k) => cur === k ? ' on' : '';
      return `<div class="winmenu__title">绿色 · 窗口形态</div>
        <button class="stack${che('max')}" data-mode="max"><span>常规最大化</span><em>占满桌面，提手翻成倒梯形，标题条保留</em></button>
        <button class="stack${che('hidden')}" data-mode="hidden"><span>隐藏式最大化</span><em>收起标题条，顶栏胶囊里的工具栏可还原</em></button>
        <button class="stack${che('immersive')}" data-mode="immersive"><span>彻底全屏</span><em>盖住顶栏与 Dock，留一个可拖的半透明球退出</em></button>
        <div class="winmenu__sep"></div>
        <div class="winmenu__label">吸附到…</div>
        <div class="winmenu__grid">
          <button class="winmenu__snap" data-snap="tl" title="左上四分之一"><i></i></button>
          <button class="winmenu__snap" data-snap="full" title="全屏"><i></i></button>
          <button class="winmenu__snap" data-snap="tr" title="右上四分之一"><i></i></button>
          <button class="winmenu__snap" data-snap="left" title="左半屏"><i></i></button>
          <button class="winmenu__snap" data-snap="right" title="右半屏"><i></i></button>
          <button class="winmenu__snap" data-snap="bl" title="左下四分之一"><i></i></button>
          <button class="winmenu__snap" data-snap="br" title="右下四分之一"><i></i></button>
        </div>
        ${cur !== 'normal' ? '<button class="stack" data-mode="normal"><span>还原窗口</span><em>回到最大化之前的位置和大小</em></button>' : ''}`;
    }
    return `<div class="winmenu__title">蓝色 · 层叠</div>
      ${solo ? '<div class="wm-note">只有一个窗口，没有可换层的对象。</div>' : ''}
      <button class="stack${off('只有一个窗口')}" data-cmd="bottom" ${solo ? 'disabled' : ''}><span>压到最底层</span><em>蓝点单击就是这个（默认行为）</em></button>
      <button class="stack${off('只有一个窗口')}" data-cmd="down" ${solo ? 'disabled' : ''}><span>仅下移一层</span><em>只和紧挨着的那扇窗换个位置</em></button>`;
  },
  _outside(e) {
    if (!WinMenu.el) return;
    /* 点在「一级框」里不算外面：那里的每个圆钮都还能再长出一层 */
    if (typeof DotMenu !== 'undefined' && DotMenu.el && DotMenu.el.contains(e.target)) return;
    if (!WinMenu.el.contains(e.target) && !(WinMenu._dot && WinMenu._dot.contains(e.target))) WinMenu.close();
  },
  _esc(e) { if (e.key === 'Escape') WinMenu.close(); },
  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.winId = null;
    this._dot = null;
    document.removeEventListener('pointerdown', this._outside, true);
    document.removeEventListener('keydown', this._esc, true);
  }
};

/* ---------------------------------------------------------------- 标题气泡
 * 只做一件事：把被 middleEllipsis 截断的标题原样显示出来。
 * 位置跟随窗口顶部那条标题，超出视口就翻到上方。 */
const TitleTip = {
  el: null, timer: 0,
  show(win, titleEl) {
    if (!win || !win.el || !win.el.isConnected) return;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'win-tip';
      document.body.appendChild(this.el);
    }
    this.el.innerHTML = esc(win.title || '') +
      `<i>${esc(win.type || 'window')}${win.mode && win.mode !== 'normal' ? ' · ' + esc(win.mode) : ''}</i>`;
    this.el.classList.add('on');
    placePopover(this.el, titleEl || win.el, 8);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), 3200);
  },
  hide() {
    clearTimeout(this.timer);
    if (this.el) this.el.classList.remove('on');
  }
};


