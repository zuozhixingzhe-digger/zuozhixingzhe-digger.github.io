/* ============================================================================
 * hterminal · terminal + windows
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
async function loadXterm(onLog) {
  if (window.Terminal && window.FitAddon) return true;
  onLog && onLog('加载 xterm.css');
  await CDN.css(XTERM_CSS);
  onLog && onLog('加载 xterm.js');
  if (!window.Terminal) {
    const ok = await CDN.js(XTERM_JS);
    if (!ok || !window.Terminal) throw new Error('xterm.js 加载失败：请检查网络或 CDN 可用性');
  }
  onLog && onLog('加载 addon-fit');
  if (!window.FitAddon) {
    const ok = await CDN.js(FIT_JS);
    if (!ok || !window.FitAddon) throw new Error('addon-fit 加载失败');
  }
  return true;
}

/* ---------------------------------------------------------------- 主题取值 */
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}
function termTheme() {
  const light = document.body.classList.contains('light');
  return {
    background: 'rgba(0,0,0,0)',
    foreground: cssVar('--fg') || (light ? '#182624' : '#d6e7e3'),
    cursor: cssVar('--accent') || '#5eead4',
    cursorAccent: light ? '#ffffff' : '#08110f',
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
    brightBlack: light ? '#7b918d' : '#5b7570',
    brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
    brightBlue: '#bae6fd', brightMagenta: '#ddd6fe', brightCyan: '#99f6e4', brightWhite: '#ffffff'
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

/* ---------------------------------------------------------------- 终端实例 */
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
    Proc.add({ pid:this.pid, role:this.role, state:'running', cwd:this.cwd, title:this.title, session:this });
  }

  _mount() {
    if (!this.container) throw new Error('终端缺少容器');
    this.term = new window.Terminal({
      cursorBlink: Settings.get('cursorBlink') === '1',
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: cssVar('--mono') || 'monospace',
      fontSize: Number(Settings.get('font')) || 14,
      lineHeight: (Number(Settings.get('lineHeight')) || 12) / 10,
      letterSpacing: 0,
      allowTransparency: true,
      scrollback: 8000,
      convertEol: false,
      theme: termTheme(),
      windowsMode: false,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      smoothScrollDuration: 0
    });
    this.term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C/V 走浏览器复制粘贴；其余交给全局快捷键。
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' || k === 'v') return false;
      }
      return true;
    });
    this.term.open(this.container);
    try {
      this.fit = new window.FitAddon.FitAddon();
      this.term.loadAddon(this.fit);
      this.fit.fit();
    } catch (e) { console.warn('fit 失败', e); }
    this.term.onData(d => this._post({ t:'in', data:d }));
    this.term.onResize(({ cols, rows }) => this._post({ t:'resize', cols, rows }));
    this._ro = new ResizeObserver(() => this.fitNow());
    this._ro.observe(this.container);
    setTimeout(() => this.fitNow(), 30);
    this.term.focus();
  }

  fitNow() {
    if (!this.fit || this.disposed) return;
    try {
      const dims = this.fit.proposeDimensions();
      if (!dims || !isFinite(dims.cols) || !isFinite(dims.rows) || dims.cols < 2 || dims.rows < 1) return;
      this.fit.fit();
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
    const dims = this.term && this.term.cols ? { cols:this.term.cols, rows:this.term.rows } : { cols:80, rows:24 };
    this._post({
      t:'init', role, cwd:this.cwd, prompt:this.role === 'shell' ? (Settings.get('prompt') || '> ') : '>>> ',
      cols:dims.cols, rows:dims.rows, history:this.opts.history || [], code:this.opts.code || '',
      banner:this.opts.banner !== false
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
    this.term.options.cursorBlink = Settings.get('cursorBlink') === '1';
    this.term.options.theme = termTheme();
    setTimeout(() => this.fitNow(), 20);
  }

  write(s) { this.term && this.term.write(s); }
  clear() { this.term && this.term.clear(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    Proc.remove(this.pid);
    try { this.worker && this.worker.postMessage({ t:'terminate' }); } catch (e) {}
    try { this.worker && this.worker.terminate(); } catch (e) {}
    this.worker = null;
    try { this._ro && this._ro.disconnect(); } catch (e) {}
    try { this.term && this.term.dispose(); } catch (e) {}
    this.term = null;
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
      onCwd: (p) => { const el = document.getElementById('hudWhere'); if (el) el.textContent = p; },
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
  applyTheme() {
    for (const s of this.sessions) {
      if (!s.term) continue;
      s.term.options.theme = termTheme();
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
    if (opts.app === 'agent' || opts.type === 'agent') {
      const ex = [...this.windows.values()].find(w => w.type === 'agent');
      if (ex) { this.focus(ex.id); if (ex.minimized) this.restore(ex.id); return ex; }
    }
    if (opts.type === 'drawer') { Drawer.open(); return null; }

    const id = opts.id || uid('w');
    const TYPE_TITLES = { browser:'浏览器', files:'文件', shell:'终端', python:'Python', agent:'智能体', editor:'编辑器', about:'关于', html:'窗口' };
    const TYPE_SIZE = { browser:[920, 620], files:[820, 540], shell:[780, 480], python:[820, 540], agent:[880, 600], editor:[860, 600], about:[560, 420] };
    opts.title = opts.title || TYPE_TITLES[opts.type] || '窗口';
    const vw = window.innerWidth, vh = window.innerHeight;
    const base = TYPE_SIZE[opts.type] || [780, 500];
    const defW = Math.min(opts.w || base[0], vw - 40);
    const defH = Math.min(opts.h || base[1], vh - 90);
    const n = this.cascade++ % 6;
    // 层叠步长要比标题栏（36px）大一点，否则两个窗口的标题栏会糊在一起像一条
    const x = opts.x != null ? opts.x : clamp(72 + n * 46, 8, Math.max(8, vw - defW - 8));
    const y = opts.y != null ? opts.y : clamp(54 + n * 42, 8, Math.max(8, vh - defH - 56));

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
    return win;
  },

  _render(win, opts) {
    try {
      switch (win.type) {
        case 'shell': {
          win.body.innerHTML = '<div class="win-term"></div>';
          win.content = TerminalManager.create({
            container: $('.win-term', win.body), role:'shell', cwd:opts.cwd || '.home',
            title:win.title, pid:(Proc.map.size + 110), history:loadHistory(), code:opts.code || '',
            onCwd:(p) => { win.cwd = p; },
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
        case 'agent': win.content = new AgentApp(win.body, opts, win); break;
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
    if (e.target.closest('.win-dots') || e.target.closest('.win-tools')) return;
    if (win.maximized) return;
    e.preventDefault();
    this.focus(win.id);
    const startX = e.clientX, startY = e.clientY;
    const r = win.el.getBoundingClientRect();
    const ox = r.left, oy = r.top;
    let snap = null;
    const snapEl = document.getElementById('winSnap');
    const move = (ev) => {
      const nx = ox + ev.clientX - startX;
      const ny = oy + ev.clientY - startY;
      win.el.style.left = clamp(nx, -win.el.offsetWidth + 80, window.innerWidth - 80) + 'px';
      win.el.style.top = clamp(ny, 0, window.innerHeight - 40) + 'px';
      win.el.classList.add('dragging');
      const vw = window.innerWidth, vh = window.innerHeight;
      if (ev.clientY <= 6) snap = { x:0, y:0, w:vw, h:vh };
      else if (ev.clientX <= 6) snap = { x:0, y:0, w:vw / 2, h:vh };
      else if (ev.clientX >= vw - 6) snap = { x:vw / 2, y:0, w:vw / 2, h:vh };
      else snap = null;
      if (snap) {
        snapEl.style.display = 'block';
        snapEl.style.left = snap.x + 'px'; snapEl.style.top = snap.y + 'px';
        snapEl.style.width = snap.w + 'px'; snapEl.style.height = snap.h + 'px';
      } else snapEl.style.display = 'none';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      win.el.classList.remove('dragging');
      snapEl.style.display = 'none';
      if (snap) {
        win.restoreRect = { x:parseFloat(win.el.style.left), y:parseFloat(win.el.style.top), w:r.width, h:r.height };
        win.el.style.left = snap.x + 'px'; win.el.style.top = snap.y + 'px';
        win.el.style.width = snap.w + 'px'; win.el.style.height = snap.h + 'px';
        win.maximized = snap.w === window.innerWidth && snap.h === window.innerHeight;
        win.el.classList.toggle('max', win.maximized);
        win.content && win.content.onResize && win.content.onResize();
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  },

  _startResize(e, win, dir) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    this.focus(win.id);
    if (win.maximized) return;
    const r = win.el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const start = { x:r.left, y:r.top, w:r.width, h:r.height };
    const move = (ev) => {
      let { x, y, w, h } = start;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (dir.includes('e')) w = Math.max(280, start.w + dx);
      if (dir.includes('s')) h = Math.max(150, start.h + dy);
      if (dir.includes('w')) { w = Math.max(280, start.w - dx); x = start.x + (start.w - w); }
      if (dir.includes('n')) { h = Math.max(150, start.h - dy); y = start.y + (start.h - h); }
      win.el.style.left = x + 'px'; win.el.style.top = y + 'px';
      win.el.style.width = w + 'px'; win.el.style.height = h + 'px';
      win.el.classList.add('resizing');
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      win.el.classList.remove('resizing');
      win.content && win.content.onResize && win.content.onResize();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
    if (!w) return;
    w.minimized = true;
    w.el.classList.add('min');
    if (w.content && w.content.onHide) w.content.onHide();
    this._syncDock();
  },
  restore(id) {
    const w = this.windows.get(id);
    if (!w) return;
    w.minimized = false;
    w.el.classList.remove('min');
    this.focus(id);
    if (w.content && w.content.onShow) w.content.onShow();
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
    if (w.maximized) {
      const r = w.restoreRect || { x:60, y:60, w:760, h:480 };
      w.el.style.left = r.x + 'px'; w.el.style.top = r.y + 'px';
      w.el.style.width = r.w + 'px'; w.el.style.height = r.h + 'px';
      w.maximized = false;
      w.el.classList.remove('max');
    } else {
      const rect = w.el.getBoundingClientRect();
      w.restoreRect = { x:rect.left, y:rect.top, w:rect.width, h:rect.height };
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
    if (w.onClose) { try { w.onClose(); } catch (e) {} }
    if (w.content && w.content.dispose) { try { w.content.dispose(); } catch (e) {} }
    w.el.remove();
    this.windows.delete(id);
    this._syncDock();
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
