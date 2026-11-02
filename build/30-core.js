/* ============================================================================
 * hterminal · core
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。设置、IndexedDB 文件系统、虚拟目录、UI 原子件。
 * ==========================================================================*/
'use strict';

const HT_VERSION = '0.0.0.4';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
const uid = (p) => (p || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
const SVG_ICONS = {
  term:'<path d="M4 6l5 5-5 5"/><path d="M12 17h8"/>',
  browser:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.6 3.6 5.4 3.6 8S14.5 17.4 12 20c-2.5-2.6-3.6-5.4-3.6-8S9.5 6.6 12 4z"/>',
  files:'<path d="M3.5 7.5h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19V7.5z"/><path d="M3.5 7.5V5.8A1.3 1.3 0 0 1 4.8 4.5h4l2 2"/>',
  agent:'<path d="M12 3.5l1.7 5.1 5.1 1.7-5.1 1.7L12 17.1l-1.7-5.1-5.1-1.7 5.1-1.7L12 3.5z"/><path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z"/>',
  more:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  python:'<path d="M12 3.5c-3 0-4 1-4 3v2h5v1H7c-2 0-3 1.2-3 3.5S5 16.5 7 16.5h1V15c0-2 1-3 3-3h4c2 0 3-1 3-3V6.5c0-2-1.5-3-6-3z"/><circle cx="9.8" cy="6.2" r=".7" fill="currentColor" stroke="none"/><path d="M12 20.5c3 0 4-1 4-3v-2h-5v-1h6c2 0 3-1.2 3-3.5" opacity=".55"/>',
  editor:'<path d="M5 19l2-6 9-9 3 3-9 9-5 3z"/><path d="M13.5 6.5l3 3"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  about:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".8" fill="currentColor" stroke="none"/>'
};
function svgIcon(name, cls) {
  return `<svg class="${cls || 'ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SVG_ICONS[name] || SVG_ICONS.term}</svg>`;
}

/* ---------------------------------------------------------------- 设置 */
const Settings = {
  DEFAULTS: {
    /* 光标形态与闪烁不提供设置：固定照参考项目那套（竖线 / 失焦椭圆 / 备用屏虚线 / 空闲呼吸）。
     * 背景网格也不提供设置，固定开着（很淡，只为看清桌面边界）。
     * rows = 固定显示行数，0 表示自动铺满。 */
    font: 14, lineHeight: 12, rows: 0,
    cdn: 'esm.sh',
    /* 智能体：backend = 经本地 modelserver 转发（密钥在服务端）；
     * direct = 浏览器直连 OpenAI 兼容服务，密钥存在本机 localStorage（有风险，见设置页警告）。 */
    agentMode: 'backend',
    agentUrl: 'http://127.0.0.1:8787',
    agentDirectUrl: 'https://api.deepseek.com',
    agentKey: '',
    agentProvider: 'openai', agentModel: 'deepseek-flash',
    /* 直连时的深度思考：默认关。DeepSeek 默认开启思考模式，
     * 响应先吐 reasoning_content 再吐 content，测试时又慢又费 token；
     * 关掉后 temperature 才有意义。需要推理时在设置里打开（会正确回传 reasoning_content）。 */
    agentThinking: '0',
    agentSteps: 120, historyLimit: 500
  },
  /* 只在内存里、永不落盘的键（API Key 属于这一类） */
  VOLATILE: ['agentKey'],
  data: {},
  load() {
    try {
      const raw = localStorage.getItem('ht.settings');
      this.data = Object.assign({}, this.DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (e) { this.data = Object.assign({}, this.DEFAULTS); }
    /* 历史遗留版本可能把密钥存进来过：加载时一律丢弃 */
    for (const x of this.VOLATILE) this.data[x] = this.DEFAULTS[x];
    /* 老版本把默认模型写成了 gpt-4o-mini 并落进 localStorage，导致用户升级后
     * 打开直连还在问 GPT。这里做一次无痛迁移：只有「从没改过」的旧默认值才替换。 */
    if (this.data.agentModel === 'gpt-4o-mini') {
      this.data.agentModel = this.DEFAULTS.agentModel;
      try { localStorage.setItem('ht.settings', JSON.stringify(this._persisted())); } catch (e) {}
    }
    return this.data;
  },
  get(k) { return this.data[k] !== undefined ? this.data[k] : this.DEFAULTS[k]; },
  set(k, v) {
    this.data[k] = v;
    /* 直连密钥只在内存：不写 localStorage，也不写 .config.settings。刷新即消失。 */
    const volatile = this.VOLATILE.includes(k);
    if (!volatile) {
      try {
        const keep = Object.assign({}, this.data);
        for (const x of this.VOLATILE) delete keep[x];
        localStorage.setItem('ht.settings', JSON.stringify(keep));
      } catch (e) {}
      FS.write('.config.settings', JSON.stringify(this._persisted(), null, 2), { kind:'object', mime:'application/json' }).catch(() => {});
    }
    if (k === 'font' || k === 'lineHeight' || k === 'rows') {
      if (typeof TerminalManager !== 'undefined') TerminalManager.applyAll();
    }
    return v;
  },
  _persisted() {
    const o = Object.assign({}, this.data);
    for (const x of this.VOLATILE) delete o[x];
    return o;
  },
  all() { return Object.assign({}, this.data); }
};

/* ---------------------------------------------------------------- 主题（跟随系统）
 * 不提供手动开关：设置里只有一行只读的「主题」，值随系统变。
 * 监听 prefers-color-scheme，系统切深浅时整页（含 xterm）一起换。 */
function systemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch (e) { return 'dark'; }
}
function applyTheme() {
  const t = systemTheme();
  const light = t === 'light';
  document.body.classList.toggle('light', light);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  const st = document.getElementById('stTheme');
  if (st) st.textContent = light ? '浅色（随系统）' : '深色（随系统）';
  if (typeof TerminalManager !== 'undefined') TerminalManager.applyTheme(t);
}
function watchSystemTheme() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const on = () => applyTheme();
  if (mq.addEventListener) mq.addEventListener('change', on);
  else if (mq.addListener) mq.addListener(on);   // Safari < 14
}
/* 背景网格固定开着：很淡的一层，只为让人看得出桌面边界，不给设置项。 */
function applyGrid() {
  document.body.classList.remove('nogrid');
}

/* ---------------------------------------------------------------- Toast */
let toastTimer = null;
function toast(msg, bad) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ---------------------------------------------------------------- Modal */
function modal(opts) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const body = opts.body || '';
    wrap.innerHTML = `<div class="modal ${opts.className || ''}" role="dialog" aria-modal="true">
      <h3>${esc(opts.title || '')}</h3>
      <div class="mbody">${body}</div>
      <div class="mfoot"></div>
    </div>`;
    const foot = $('.mfoot', wrap);
    const buttons = opts.buttons || [{ label:'确定', primary:true, value:true }];
    const close = (v) => { wrap.remove(); resolve(v); };
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.primary ? 'primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.onclick = async () => {
        if (b.onClick) {
          const r = await b.onClick(wrap);
          if (r === false) return;
          close(r === undefined ? b.value : r);
        } else close(b.value);
      };
      foot.appendChild(el);
    });
    if (opts.onMount) opts.onMount(wrap, close);
    if (opts.dismiss !== false) {
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
    }
    root.appendChild(wrap);
    const inp = $('input,textarea', wrap);
    if (inp) setTimeout(() => inp.focus(), 30);
  });
}
function confirmDlg(title, text, danger) {
  return modal({
    title,
    body: `<div style="line-height:1.75">${text}</div>`,
    buttons: [{ label:'取消', value:false }, { label:'确认', value:true, primary:!danger, danger }]
  });
}

/* ---------------------------------------------------------------- 路径规则
 * 分隔符是 `.`，根是 `.`；每一段必须像标识符：字母/中文开头，后续字母数字 _ -。
 * 不区分大小写 —— 内部一律小写存储。 */
const SEG_RE = /^[\p{L}][\p{L}\p{N}_-]{0,63}$/u;
const RESERVED = new Set(['', '.', '..']);
function normPath(p, cwd) {
  cwd = cwd || '.home';
  if (p === undefined || p === null || String(p).trim() === '') return cwd;
  let s = String(p).trim().replace(/\\/g, '/');
  if (!s) return cwd;
  if (s === '/' || s === '.') return '.';

  /* 路径方言（模仿 Linux 终端，底层仍是点分扁平结构）：
   *   /            根                 /home/notes = .home.notes
   *   ~            .home
   *   @            当前目录           @、@/notes、@.notes
   *   ..           上一级             ../x
   *   "/" 与 "." 都是分隔符，反斜杠也当分隔符。
   */
  const cwdSegs = cwd === '.' ? [] : cwd.slice(1).split('.');
  let base, rest;
  if (s === '~' || s.startsWith('~/') || s.startsWith('~.')) {
    base = []; rest = 'home/' + s.replace(/^~[\/.]?/, '');
  } else if (s === '@') {
    return cwd.toLowerCase();
  } else if (s.startsWith('@')) {
    base = cwdSegs.slice(); rest = s.slice(1);
  } else if (s.startsWith('/')) {
    base = []; rest = s.slice(1);
  } else if (s.startsWith('..')) {
    base = cwdSegs.slice(); rest = s;
  } else if (s.startsWith('.')) {
    base = []; rest = s.replace(/^\.+/, '');
  } else {
    base = cwdSegs.slice(); rest = s;
  }

  const out = base.slice();
  /* ".." 里含点，直接 split 会被当成分隔符吃掉，先换成占位符 */
  rest = rest.replace(/\.\./g, '\u0001');
  for (const seg of rest.split(/[\/.]+/)) {
    if (!seg) continue;
    if (seg === '\u0001') { out.pop(); continue; }
    if (seg === '~') { out.length = 0; out.push('home'); continue; }
    /* 路径中间出现的 @ 代表「当前目录」这个绝对位置 */
    if (seg === '@') { out.length = 0; out.push(...cwdSegs); continue; }
    out.push(seg);
  }
  return (out.length ? '.' + out.join('.') : '.').toLowerCase();
}
function pathSegs(p) { return p === '.' ? [] : p.slice(1).split('.'); }
function parentPath(p) {
  const s = pathSegs(p);
  s.pop();
  return s.length ? '.' + s.join('.') : '.';
}
function baseName(p) {
  const s = pathSegs(p);
  return s.length ? s[s.length - 1] : '.';
}
function checkName(name) {
  const n = String(name || '').trim();
  if (!SEG_RE.test(n)) return '名称必须以字母或中文开头，只能包含字母、中文、数字、下划线、短横线';
  if (n.length > 64) return '名称太长（最多 64）';
  return null;
}
function sanitizeName(name, fallback) {
  let n = String(name || '').trim();
  n = n.replace(/^\.+/, '').replace(/\.[^.]*$/, '');
  n = n.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!n || !/^[\p{L}]/u.test(n)) n = (fallback || 'file') + (n ? '-' + n : '');
  return n.slice(0, 48);
}

/* ---------------------------------------------------------------- 内置文件系统内容 */
const DIRS = ['.home', '.bin', '.app', '.dev', '.proc', '.pkg', '.config', '.agent', '.sys', '.perm', '.temp', '.queryfile', '.localstorage'];
const APP_DEFS = [
  { name:'shell', title:'终端', desc:'新的 JS shell 窗口', type:'shell', icon:'▣' },
  { name:'browser', title:'浏览器', desc:'窗口里的真浏览器（iframe）', type:'browser', icon:'◎' },
  { name:'python', title:'Python', desc:'Pyodide 交互式环境', type:'python', icon:'🐍' },
  { name:'agent', title:'智能体', desc:'轻量 AI harness（需要后端）', type:'agent', icon:'✦' },
  { name:'files', title:'文件', desc:'浏览一切皆文件的世界', type:'files', icon:'▤' },
  { name:'editor', title:'编辑器', desc:'查看/编辑文本文件', type:'editor', icon:'✎' },
  { name:'settings', title:'设置', desc:'打开“更多”抽屉', type:'drawer', icon:'≥' },
  { name:'about', title:'关于', desc:'版本、许可与第三方声明', type:'about', icon:'ⓘ' },
];
const DEV_DEFS = [
  { name:'tty', device:'tty', hint:'当前终端' },
  { name:'null', device:'null', hint:'黑洞，写入即丢弃' },
  { name:'zero', device:'zero', hint:'永远读到 0' },
  { name:'random', device:'random', hint:'随机数' },
  { name:'time', device:'time', hint:'当前时间戳' },
  { name:'console', device:'console', hint:'控制台输出' },
];
const PERM_DEFS = [
  { name:'clipboard', hint:'剪贴板读写' },
  { name:'notification', hint:'桌面通知' },
  { name:'camera', hint:'摄像头' },
  { name:'microphone', hint:'麦克风' },
  { name:'geolocation', hint:'地理位置' },
  { name:'fullscreen', hint:'全屏' },
  { name:'persistent', hint:'持久化存储' },
];
const SEED_FILES = {
  '.home.welcome': {
    kind:'file', mime:'text/plain',
    content:`欢迎来到 hterminal。

这是一个跑在浏览器里的 JS 终端。你看到的每一行都是 JavaScript：

  > 1 + 2
  > await ls()
  > const x = await fs.read('.home.welcome')
  > python()          // 在当前终端开一个 Python
  > winOpen({type:'browser', url:'https://example.com'})
  > agentOpen()       // 轻量智能体（需要本地后端）

路径用点分隔，根是 "."。例如：
  .home.notes       根下的 home 目录里的 notes
  .bin.hello        一个可执行函数
  .localstorage.x   浏览器 localStorage 里的 x

输入 help 看完整命令表。`
  },
  '.home.readme': {
    kind:'file', mime:'text/plain',
    content:`hterminal 的几条“世界观”：

1. 一切皆文件。文件可以是文本、函数、应用、设备、权限、包、线程、会话。
2. 文件系统尽量扁平。所有目录都挂在根 "." 下，路径用 "." 分隔。
3. 文件名必须像标识符：字母/中文开头，只含字母、中文、数字、_、-；不区分大小写。
4. 浏览器就是沙箱。这里不再套一层安全沙箱，执行 JS 不需要许可。
5. 多线程。每个终端、每个 Python、每个窗口应用都跑在独立的 Worker 里。
6. 数据都在你本地。IndexedDB + localStorage，没有云端。

常用目录：
  .home         你的文件
  .bin          可执行函数
  .app          应用
  .dev          设备
  .proc         进程/线程
  .pkg          已安装的包
  .config       设置
  .agent        智能体会话
  .sys          系统信息（只读）
  .perm         权限
  .temp         临时文件（刷新即失）
  .queryfile    你通过“询问文件”交进来的文件
  .localstorage localStorage 的镜像

试试：
  > await ls('.bin')
  > await exec('.bin.hello')
  > cat('.home.readme')
`
  },
  '.bin.hello': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'示例可执行文件', interpreter:'js' },
    content:`print('hello from .bin.hello');
print('cwd =', await pwd());
print('现在时间是', new Date().toLocaleString('zh-CN'));
return 'done';`
  },
  '.bin.sysinfo': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'打印环境信息', interpreter:'js' },
    content:`const u = await navigator.storage.estimate().catch(()=>({}));
print('hterminal', '${HT_VERSION}');
print('UA       ', navigator.userAgent);
print('CPU      ', navigator.hardwareConcurrency, 'threads');
print('内存     ', navigator.deviceMemory || '?', 'GB');
print('存储用量 ', ((u.usage||0)/1048576).toFixed(2), 'MB /', ((u.quota||0)/1048576).toFixed(0), 'MB');
print('cwd      ', await pwd());`
  },
  '.bin.ask': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'向用户要一个文件并统计行数', interpreter:'js' },
    content:`const p = await askFile({ title:'选一个文本文件' });
if (!p) { print('没有选择文件'); return; }
const r = await fs.read(p);
const lines = String(r.content || '').split('\\n').length;
print('已放入', p, '，共', lines, '行');`
  },
  '.sys.version': { kind:'file', mime:'text/plain', content:'hterminal ' + HT_VERSION + '\nJSHeL / 一切皆文件\nApache-2.0 OR MIT\n' },
  '.sys.license': { kind:'file', mime:'text/plain', content:`Apache License 2.0 OR MIT（双许可，任选其一）

Copyright (c) 2026 hterminal contributors

本项目由 AI 智能体生成并维护。第三方组件：
  xterm.js                 MIT
  @xterm/addon-fit         MIT
  Pyodide                  MPL-2.0
完整原文见仓库 licenses/ 目录与 README。` },
  '.sys.about': { kind:'file', mime:'text/plain', content:`hterminal
浏览器里的 JS 终端 / 一切皆文件桌面 / 轻量智能体宿主

一个自包含的 index.html，加上三个可选的单文件模型转发后端。
没有构建步骤，没有账号，没有云端。

Apache-2.0 OR MIT · 由 AI 智能体生成并维护` },
  '.config.settings': { kind:'object', mime:'application/json', content:'{}' },
  '.config.agent': { kind:'object', mime:'application/json', content:'{}' },
  '.agent.session': { kind:'file', mime:'application/x-ndjson', content:'' },
};

/* ---------------------------------------------------------------- IndexedDB */
const IDB = {
  db: null,
  NAME: 'hterm-fs', STORE: 'files',
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          const st = db.createObjectStore(this.STORE, { keyPath:'path' });
          st.createIndex('parent', 'parent', { unique:false });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(mode) { return this.db.transaction(this.STORE, mode).objectStore(this.STORE); },
  async get(path) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this.tx('readonly').get(path);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  },
  async put(rec) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this.tx('readwrite').put(rec);
      r.onsuccess = () => res(rec);
      r.onerror = () => rej(r.error);
    });
  },
  async del(path) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this.tx('readwrite').delete(path);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  },
  async all() {
    await this.open();
    return new Promise((res, rej) => {
      const r = this.tx('readonly').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async keys() {
    await this.open();
    return new Promise((res, rej) => {
      const r = this.tx('readonly').getAllKeys();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async clear() {
    await this.open();
    return new Promise((res, rej) => {
      const r = this.tx('readwrite').clear();
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  }
};

/* ---------------------------------------------------------------- FS */
const FS = {
  idx: new Map(),          // lowerPath -> {path, kind, size, mtime, meta}
  temp: new Map(),         // .temp.* 内存存储
  seeded: false,

  async init() {
    await IDB.open();
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
    if (!this.idx.size) await this.seed();
    else {
      // 补齐内置目录/应用（升级时不丢用户数据）
      await this.ensureBuiltins();
      await this.syncIndex();
    }
    this.persistIndex();
    rebuildLsMap();
    try {
      const s = await IDB.get('.config.settings');
      if (s && s.content && s.content !== '{}') {
        const saved = JSON.parse(s.content);
        Settings.data = Object.assign({}, Settings.data, saved);
        try { localStorage.setItem('ht.settings', JSON.stringify(Settings.data)); } catch (e) {}
      }
    } catch (e) {}
  },

  async seed() {
    const t = Date.now();
    const put = (path, kind, content, meta) => IDB.put({
      path, parent:parentPath(path), name:baseName(path), kind,
      content: content == null ? '' : content, meta: meta || {},
      ctime:t, mtime:t, size: contentSize(content)
    });
    await put('.', 'dir', '', { hint:'根目录' });
    for (const d of DIRS) await put(d, 'dir', '', { hint:'系统目录' });
    for (const [p, f] of Object.entries(SEED_FILES)) {
      await put(p, f.kind, f.content, Object.assign({ hint:'' }, f.meta || {}, f.mime ? { mime:f.mime } : {}));
    }
    for (const a of APP_DEFS) await put('.app.' + a.name, 'app', '', { app:a.name, hint:a.desc, icon:a.icon, title:a.title });
    for (const d of DEV_DEFS) await put('.dev.' + d.name, 'device', '', { device:d.device, hint:d.hint });
    for (const p of PERM_DEFS) await put('.perm.' + p.name, 'grant', '', { perm:p.name, hint:p.hint });
    this.seeded = true;
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
  },

  async ensureBuiltins() {
    const t = Date.now();
    const put = (path, kind, content, meta) => IDB.put({
      path, parent:parentPath(path), name:baseName(path), kind,
      content: content == null ? '' : content, meta: meta || {},
      ctime:t, mtime:t, size: contentSize(content)
    });
    if (!this.idx.has('.')) await put('.', 'dir', '', { hint:'根目录' });
    for (const d of DIRS) if (!this.idx.has(d)) await put(d, 'dir', '', { hint:'系统目录' });
    for (const a of APP_DEFS) if (!this.idx.has('.app.' + a.name)) await put('.app.' + a.name, 'app', '', { app:a.name, hint:a.desc, icon:a.icon, title:a.title });
    for (const d of DEV_DEFS) if (!this.idx.has('.dev.' + d.name)) await put('.dev.' + d.name, 'device', '', { device:d.device, hint:d.hint });
    for (const p of PERM_DEFS) if (!this.idx.has('.perm.' + p.name)) await put('.perm.' + p.name, 'grant', '', { perm:p.name, hint:p.hint });
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
  },

  async syncIndex() {
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
  },

  persistIndex() {
    try {
      const o = {};
      for (const [k, v] of this.idx) o[k] = v.kind;
      const s = JSON.stringify(o);
      if (s.length < 1500000) localStorage.setItem('ht.fs.index', s);
    } catch (e) {}
  },

  exists(p) { return this.idx.has(p) || this.temp.has(p) || DIRS.indexOf(p) >= 0 || this.virtualStat(p); },
  isVirtual(p) {
    return p === '.proc' || p.startsWith('.proc.') || p === '.localstorage' || p.startsWith('.localstorage.') ||
      p === '.pkg' || p.startsWith('.pkg.') || p === '.temp' || p.startsWith('.temp.') ||
      p === '.queryfile' || p.startsWith('.queryfile.');
  },

  virtualStat(p) {
    if (p === '.proc') return { path:p, name:'proc', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'进程/线程' } };
    if (p.startsWith('.proc.')) {
      const pid = Number(p.slice(6));
      const pr = Proc.list().find(x => x.pid === pid);
      if (pr) return { path:p, name:String(pid), kind:'proc', size:0, mtime:Date.now(), meta:{ pid, hint:pr.title, state:pr.state, role:pr.role, cwd:pr.cwd } };
    }
    if (p === '.localstorage') return { path:p, name:'localstorage', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'localStorage 镜像' } };
    if (p.startsWith('.localstorage.')) {
      const key = decodeLsName(p.slice(14));
      const v = localStorage.getItem('ht.ls.' + key);
      if (v !== null) return { path:p, name:baseName(p), kind:'file', size:v.length, mtime:Date.now(), meta:{ hint:'localStorage', lsKey:key, mime:'text/plain' }, content:v };
    }
    if (p === '.pkg') return { path:p, name:'pkg', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'已安装的包' } };
    if (p.startsWith('.pkg.')) {
      const spec = Pkg.getSpecByPath(p);
      if (spec) return { path:p, name:baseName(p), kind:'package', size:0, mtime:Date.now(), meta:{ hint:spec.spec, spec:spec.spec, url:spec.url, name:spec.name } };
    }
    if (p === '.temp') return { path:p, name:'temp', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'临时文件（刷新即失）' } };
    if (p.startsWith('.temp.')) {
      const v = this.temp.get(p);
      if (v) return { path:p, name:baseName(p), kind:'file', size:String(v.content || '').length, mtime:v.mtime, meta:v.meta || {}, content:v.content };
    }
    if (p === '.queryfile') return { path:p, name:'queryfile', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'用户提供的文件' } };
    return null;
  },

  async list(p) {
    p = normPath(p || '.');
    const out = new Map();
    const add = (rec) => {
      if (rec.path === p) return;
      if (parentPath(rec.path) !== p) return;
      const name = baseName(rec.path);
      out.set(name, {
        name, path:rec.path, kind:rec.kind, size:rec.size || 0, mtime:rec.mtime || Date.now(),
        meta:rec.meta || {}, hint:(rec.meta && rec.meta.hint) || ''
      });
    };
    for (const rec of this.idx.values()) add(rec);
    if (p === '.') {
      for (const d of DIRS) {
        const rec = this.idx.get(d);
        if (rec) add(rec); else add({ path:d, kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'系统目录' } });
      }
    }
    for (const [path, v] of this.temp) add({ path, kind:'file', size:String(v.content || '').length, mtime:v.mtime, meta:v.meta || {} });
    if (p === '.proc') {
      for (const pr of Proc.list()) add({ path:'.proc.' + pr.pid, kind:'proc', size:0, mtime:Date.now(), meta:{ hint:pr.title, pid:pr.pid, state:pr.state } });
    }
    if (p === '.localstorage') {
      for (const k of lsKeys()) {
        const name = encodeLsName(k);
        add({ path:'.localstorage.' + name, kind:'file', size:(localStorage.getItem('ht.ls.' + k) || '').length, mtime:Date.now(), meta:{ hint:'localStorage', lsKey:k } });
      }
    }
    if (p === '.pkg') {
      for (const pk of Pkg.list()) {
        const name = pkgPathName(pk.spec);
        add({ path:'.pkg.' + name, kind:'package', size:0, mtime:pk.at || Date.now(), meta:{ hint:pk.spec, spec:pk.spec, url:pk.url, name:pk.name } });
      }
    }
    const arr = [...out.values()];
    // 隐藏内部 . 前缀（除根目录）
    return arr.sort(byName);
  },

  async stat(p) {
    p = normPath(p);
    if (p === '.') return { path:'.', name:'.', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'根目录' } };
    const v = this.virtualStat(p);
    if (v) return v;
    if (this.temp.has(p)) {
      const t = this.temp.get(p);
      return { path:p, name:baseName(p), kind:'file', size:String(t.content || '').length, mtime:t.mtime, meta:t.meta || {}, content:t.content };
    }
    const rec = this.idx.get(p);
    return rec ? Object.assign({}, rec) : null;
  },

  async read(p) {
    p = normPath(p);
    const v = this.virtualStat(p);
    if (v) {
      if (v.kind === 'dir') return Object.assign({}, v, { content:null });
      if (v.content !== undefined) return v;
      if (v.kind === 'package') return Object.assign({}, v, { content:'' });
      return Object.assign({}, v, { content:'' });
    }
    if (this.temp.has(p)) {
      const t = this.temp.get(p);
      return { path:p, name:baseName(p), kind:'file', size:String(t.content || '').length, mtime:t.mtime, meta:t.meta || {}, content:t.content };
    }
    const rec = await IDB.get(p);
    if (!rec) throw new Error('文件不存在: ' + p);
    return Object.assign({}, rec);
  },

  async write(p, data, meta) {
    p = normPath(p);
    if (p === '.' || p === '.sys' || p.startsWith('.sys.')) throw new Error('只读路径: ' + p);
    if (p === '.proc' || p.startsWith('.proc.') || p === '.dev' || p.startsWith('.dev.') || p === '.app' || p.startsWith('.app.') || p === '.perm' || p.startsWith('.perm.')) {
      throw new Error('系统路径不可写: ' + p);
    }
    const seg = baseName(p);
    const err = checkName(seg);
    if (err) throw new Error(err + '（' + seg + '）');
    /* 父目录必须存在。点号既是分隔符又常被当成扩展名，于是
     * `write(".home.a.txt")` 会被解析成「.home.a 目录下的 txt」，
     * 默默在不存在的地方造一个谁也看不见的文件（`ls .home` 永远列不出来）。
     * 与其留下幽灵，不如当场报错——这也和 mkdir 的规则保持一致。 */
    const par = parentPath(p);
    if (par !== '.' && !this.exists(par) && !this.temp.has(par)) {
      throw new Error('父目录不存在: ' + par + '（点名就是路径分隔符，文件名不要带点）');
    }
    if (p.startsWith('.localstorage.')) {
      const key = decodeLsName(p.slice(14));
      if (key === null) throw new Error('localStorage 键名不合法');
      lsSet(key, String(data == null ? '' : data));
      this.persistIndex();
      return this.stat(p);
    }
    meta = Object.assign({}, meta || {});
    if (!meta.mime) meta.mime = guessMime(p, data);
    if (p.startsWith('.temp.')) {
      const rec = { content:data == null ? '' : data, meta, mtime:Date.now() };
      this.temp.set(p, rec);
      return { path:p, name:seg, kind:'file', size:String(data || '').length, mtime:rec.mtime, meta };
    }
    let kind = meta.kind || 'file';
    if (!this.exists(p) && /\.bin\./.test(p)) kind = kind || 'file';
    const old = this.idx.get(p);
    const rec = {
      path:p, parent:parentPath(p), name:seg, kind,
      content:data == null ? '' : data, meta,
      ctime:old ? old.ctime || Date.now() : Date.now(), mtime:Date.now(),
      size:contentSize(data)
    };
    delete meta.kind;
    await IDB.put(rec);
    this.idx.set(p, metaOf(rec));
    this.persistIndex();
    EventBus.emit('fs', { type:'write', path:p });
    return Object.assign({}, rec);
  },

  async mkdir(p) {
    p = normPath(p);
    if (this.exists(p)) throw new Error('已存在: ' + p);
    const seg = baseName(p);
    const err = checkName(seg);
    if (err) throw new Error(err);
    if (!this.exists(parentPath(p))) throw new Error('父目录不存在: ' + parentPath(p));
    const rec = { path:p, parent:parentPath(p), name:seg, kind:'dir', content:'', meta:{ hint:'目录' }, ctime:Date.now(), mtime:Date.now(), size:0 };
    await IDB.put(rec);
    this.idx.set(p, metaOf(rec));
    this.persistIndex();
    EventBus.emit('fs', { type:'mkdir', path:p });
    return rec;
  },

  async remove(p, recursive) {
    p = normPath(p);
    if (p === '.' || DIRS.includes(p) || p.startsWith('.sys.') || p.startsWith('.app.') || p.startsWith('.dev.') || p.startsWith('.perm.')) {
      throw new Error('不可删除: ' + p);
    }
    if (p.startsWith('.localstorage.')) {
      const key = decodeLsName(p.slice(14));
      localStorage.removeItem('ht.ls.' + key);
      EventBus.emit('fs', { type:'remove', path:p });
      return true;
    }
    if (p.startsWith('.temp.')) { this.temp.delete(p); EventBus.emit('fs', { type:'remove', path:p }); return true; }
    if (p.startsWith('.pkg.')) { const pk = Pkg.getSpecByPath(p); if (pk) Pkg.remove(pk.spec); EventBus.emit('fs', { type:'remove', path:p }); return true; }
    const st = await this.stat(p);
    if (!st) throw new Error('不存在: ' + p);
    if (st.kind === 'dir') {
      const kids = await this.list(p);
      if (kids.length && !recursive) throw new Error('目录非空（用 {r:true}）: ' + p);
      for (const k of kids) await this.remove(k.path, true);
    }
    await IDB.del(p);
    this.idx.delete(p);
    this.persistIndex();
    EventBus.emit('fs', { type:'remove', path:p });
    return true;
  },

  async move(a, b) {
    a = normPath(a); b = normPath(b);
    const st = await this.stat(a);
    if (!st) throw new Error('不存在: ' + a);
    if (st.kind === 'dir') {
      const kids = await this.list(a);
      for (const k of kids) await this.move(k.path, b + k.path.slice(a.length));
      await this.remove(a, true);
      return true;
    }
    const rec = await this.read(a);
    await this.write(b, rec.content, rec.meta);
    await this.remove(a, false);
    return true;
  },

  async copy(a, b) {
    const st = await this.stat(a);
    if (!st) throw new Error('不存在: ' + a);
    if (st.kind === 'dir') {
      await this.mkdir(b);
      for (const k of await this.list(a)) await this.copy(k.path, b + k.path.slice(a.length));
      return true;
    }
    const rec = await this.read(a);
    await this.write(b, rec.content, rec.meta);
    return true;
  },

  async usage() {
    let est = {};
    try { est = await navigator.storage.estimate(); } catch (e) {}
    let ls = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls += (k || '').length + (localStorage.getItem(k) || '').length;
    }
    return { usage: est.usage || 0, quota: est.quota || 0, localStorage:ls, files:this.idx.size };
  },

  async exportAll() {
    const files = [];
    for (const r of await IDB.all()) {
      files.push(Object.assign({}, r, { content:await packContent(r.content) }));
    }
    const temp = [];
    for (const [path, v] of this.temp) temp.push({ path, content:await packContent(v.content), meta:v.meta });
    const ls = {};
    for (const k of lsKeys()) ls[k] = localStorage.getItem('ht.ls.' + k);
    return { format:'hterminal-fs', version:1, at:nowISO(), files, temp, localstorage:ls, settings:Settings.all() };
  },

  async importAll(obj) {
    if (!obj || obj.format !== 'hterminal-fs') throw new Error('不是 hterminal 导出的文件');
    if (Array.isArray(obj.files)) {
      for (const r of obj.files) {
        if (!r || !r.path) continue;
        const path = normPath(r.path);
        const rec = Object.assign({}, r, {
          path, parent:parentPath(path), name:baseName(path),
          content:await unpackContent(r.content)
        });
        await IDB.put(rec);
      }
    }
    if (obj.temp) for (const t of obj.temp) this.temp.set(normPath(t.path), { content:await unpackContent(t.content), meta:t.meta || {}, mtime:Date.now() });
    if (obj.localstorage) for (const [k, v] of Object.entries(obj.localstorage)) lsSet(k, v);
    await this.syncIndex();
    this.persistIndex();
    return true;
  },

  mounts() {
    return [
      { mount:'idb://hterm', path:'.', type:'indexeddb' },
      { mount:'ls://local', path:'.localstorage', type:'localstorage' },
      { mount:'tmpfs', path:'.temp', type:'memory' },
      { mount:'procfs', path:'.proc', type:'virtual' },
      { mount:'devfs', path:'.dev', type:'virtual' },
      { mount:'pkgfs', path:'.pkg', type:'virtual' },
    ];
  }
};
async function packContent(c) {
  if (c == null) return { t:'s', v:'' };
  if (typeof c === 'string') return { t:'s', v:c };
  if (c instanceof ArrayBuffer) return { t:'b64', v:toB64(c) };
  if (c instanceof Blob) return { t:'b64', v:toB64(await c.arrayBuffer()), mime:c.type };
  return { t:'s', v:String(c) };
}
async function unpackContent(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (c.t === 'b64') return fromB64(c.v);
  return c.v || '';
}
function toB64(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s || '');
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}
function metaOf(r) {
  return { path:r.path, name:r.name || baseName(r.path), kind:r.kind || 'file', size:r.size || 0, mtime:r.mtime || Date.now(), ctime:r.ctime || Date.now(), meta:r.meta || {} };
}
function contentSize(c) {
  if (c == null) return 0;
  if (typeof c === 'string') return c.length;
  if (c instanceof Blob) return c.size;
  if (c instanceof ArrayBuffer) return c.byteLength;
  try { return JSON.stringify(c).length; } catch (e) { return 0; }
}
function byName(a, b) {
  if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-CN');
}
function guessMime(p, data) {
  const n = baseName(p);
  if (/json|settings|agent/.test(n)) return 'application/json';
  if (/readme|welcome|license|about|version|txt|note/.test(n)) return 'text/plain';
  if (typeof data === 'string' && /^\s*[[{]/.test(data)) return 'application/json';
  return 'text/plain';
}

/* ---------------------------------------------------------------- 进程表（worker 线程） */
const Proc = {
  map: new Map(),
  add(p) { this.map.set(p.pid, p); return p; },
  get(pid) { return this.map.get(pid); },
  remove(pid) { this.map.delete(pid); },
  list() { return [...this.map.values()].map(p => ({ pid:p.pid, role:p.role, state:p.state, cwd:p.cwd, title:p.title })); }
};

/* ---------------------------------------------------------------- 事件总线 */
const EventBus = {
  h: {},
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return () => this.off(ev, fn); },
  off(ev, fn) { this.h[ev] = (this.h[ev] || []).filter(x => x !== fn); },
  emit(ev, data) { for (const fn of (this.h[ev] || [])) { try { fn(data); } catch (e) { console.error(e); } } }
};

/* ---------------------------------------------------------------- localStorage 镜像 */
function encodeLsName(key) {
  let out = '';
  for (const ch of String(key)) {
    if (/[\p{L}\p{N}-]/u.test(ch)) out += ch;
    else if (ch === '_') out += '__';
    else {
      for (const b of new TextEncoder().encode(ch)) out += '_x' + b.toString(16).padStart(2, '0') + '_';
    }
  }
  if (!/^[\p{L}]/u.test(out)) out = 'k' + out;
  return out.slice(0, 64) || 'k';
}
function decodeLsName(name) {
  const map = lsMap();
  if (map[name] !== undefined) return map[name];
  let s = name;
  // 为合法化添加的 k 前缀：只有原键为空或以非字母开头时才可能添加。
  // 手动写在 .localstorage. 下的名字没有映射，保留字面。
  let out = '', bytes = [];
  const flush = () => {
    if (bytes.length) {
      try { out += new TextDecoder().decode(new Uint8Array(bytes)); } catch (e) {}
      bytes = [];
    }
  };
  for (let i = 0; i < s.length;) {
    if (s.startsWith('_x', i)) {
      const m = s.slice(i).match(/^_x([0-9a-f]{2})_/i);
      if (m) { bytes.push(parseInt(m[1], 16)); i += m[0].length; continue; }
    }
    if (s.startsWith('__', i)) { flush(); out += '_'; i += 2; continue; }
    flush();
    out += s[i++];
  }
  flush();
  return out;
}
function rebuildLsMap() {
  const m = lsMap();
  let changed = false;
  for (const k of lsKeys()) {
    const e = encodeLsName(k);
    if (m[e] !== k) { m[e] = k; changed = true; }
  }
  if (changed) { try { localStorage.setItem('ht.lsmap', JSON.stringify(m)); } catch (e) {} }
}
function lsMap() {
  try {
    return JSON.parse(localStorage.getItem('ht.lsmap') || localStorage.getItem('ht.ls.map') || '{}');
  } catch (e) { return {}; }
}
function lsSet(key, value) {
  localStorage.setItem('ht.ls.' + key, value);
  const m = lsMap(); m[encodeLsName(key)] = key;
  try { localStorage.setItem('ht.lsmap', JSON.stringify(m)); } catch (e) {}
}
function lsKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('ht.ls.') && k !== 'ht.ls.map') out.push(k.slice(6));
  }
  return out;
}

/* ---------------------------------------------------------------- 包索引 */
const Pkg = {
  KEY: 'ht.packages',
  list() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (e) { return []; }
  },
  save(list) { localStorage.setItem(this.KEY, JSON.stringify(list)); EventBus.emit('pkg', list); },
  add(rec) {
    const l = this.list().filter(x => x.spec !== rec.spec);
    l.push(rec); this.save(l); return rec;
  },
  remove(spec) { this.save(this.list().filter(x => x.spec !== spec)); },
  getSpecByPath(p) {
    const name = baseName(p);
    return this.list().find(x => pkgPathName(x.spec) === name);
  }
};
function pkgPathName(spec) {
  return sanitizeName(String(spec).replace(/^@[^/]+\//, '').replace(/@.*$/, '').replace(/[\/.]/g, '-'), 'pkg');
}

/* ---------------------------------------------------------------- 下载 / 询问文件 */
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name || 'download';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
async function saveFile(name, content, mime) {
  let blob;
  if (content instanceof Blob) blob = content;
  else if (content instanceof ArrayBuffer) blob = new Blob([content], { type:mime || 'application/octet-stream' });
  else blob = new Blob([String(content == null ? '' : content)], { type:mime || 'text/plain;charset=utf-8' });
  downloadBlob(sanitizeName(name || 'download', 'download'), blob);
  toast('已保存 ' + (name || 'download'));
  return true;
}
function pickFiles(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = !!opts.multiple;
    if (opts.accept) inp.accept = opts.accept;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    inp.oncancel = () => { resolve([]); inp.remove(); };
    inp.click();
  });
}
async function askFile(opts) {
  opts = opts || {};
  const files = await pickFiles({ multiple:!!opts.multiple, accept:opts.accept });
  if (!files.length) return opts.multiple ? [] : null;
  const out = [];
  for (const f of files) {
    let name = sanitizeName(f.name, 'query');
    let path = '.queryfile.' + name;
    let n = 2;
    while (FS.exists(path)) { path = '.queryfile.' + name + '-' + n; n++; }
    const isText = /^text\//.test(f.type) || /\.(txt|md|json|js|csv|log|yml|yaml|xml|html|css)$/i.test(f.name) || f.size < 262144;
    let content;
    if (isText) content = await f.text();
    else content = await f.arrayBuffer();
    await FS.write(path, content, { mime:f.type || 'application/octet-stream', hint:f.name, binary:!isText, origin:'queryfile' });
    out.push(path);
  }
  EventBus.emit('fs', { type:'queryfile' });
  toast('已放入 ' + out.length + ' 个文件到 .queryfile');
  return opts.multiple ? out : out[0];
}

/* ---------------------------------------------------------------- 权限 */
async function requestPermission(name) {
  name = String(name || '').toLowerCase();
  try {
    if (name === 'notification') {
      if (!('Notification' in window)) return 'unsupported';
      return await Notification.requestPermission();
    }
    if (name === 'clipboard') {
      if (navigator.clipboard && navigator.clipboard.readText) { await navigator.clipboard.readText(); return 'granted'; }
      return 'unsupported';
    }
    if (name === 'camera' || name === 'microphone') {
      const stream = await navigator.mediaDevices.getUserMedia(name === 'camera' ? { video:true } : { audio:true });
      stream.getTracks().forEach(t => t.stop());
      return 'granted';
    }
    if (name === 'geolocation') {
      return await new Promise((res) => navigator.geolocation.getCurrentPosition(() => res('granted'), () => res('denied'), { timeout:8000 }));
    }
    if (name === 'fullscreen') {
      await document.documentElement.requestFullscreen();
      return 'granted';
    }
    if (name === 'persistent') {
      const ok = await navigator.storage.persist();
      return ok ? 'granted' : 'denied';
    }
    return 'unsupported';
  } catch (e) { return 'denied'; }
}

/* ---------------------------------------------------------------- CDN 装载器 */
const CDN = {
  async css(urls) {
    for (const u of urls) {
      await new Promise(res => {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = u;
        l.onload = () => res(true); l.onerror = () => { l.remove(); res(false); };
        document.head.appendChild(l);
      });
      if ([...document.querySelectorAll('link[rel=stylesheet]')].some(x => x.href === u)) return true;
    }
    return false;
  },
  async js(urls) {
    for (const u of urls) {
      const ok = await new Promise(res => {
        const s = document.createElement('script');
        s.src = u;
        s.onload = () => res(true);
        s.onerror = () => { s.remove(); res(false); };
        document.head.appendChild(s);
      });
      if (ok) return true;
    }
    return false;
  }
};

/* ---------------------------------------------------------------- 快捷键帮助 */
function isTypingTarget(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}

/* ---------------------------------------------------------------- 关于 */
function aboutHtml() {
  return `<div style="line-height:1.8">
    <p><b style="color:var(--accent);font-family:var(--mono)">hterminal ${HT_VERSION}</b><br>
    浏览器里的 JS 终端、一切皆文件桌面、轻量智能体宿主。</p>
    <p>一个自包含的 <span class="code">index.html</span>，加上三个可选的单文件模型转发后端
    （<span class="code">modelserver.py / .js / .go</span>）。没有构建步骤，没有账号，没有云端。</p>
    <p style="color:var(--fg-mute)">许可：Apache-2.0 OR MIT（双许可，任选其一）。<br>
    本项目由 AI 智能体生成并维护。<br>
    第三方：xterm.js (MIT)、@xterm/addon-fit (MIT)、Pyodide (MPL-2.0)，均经 CDN 引用。</p>
    <p style="color:var(--fg-mute);font-size:11px">数据全部留在本机浏览器。清除数据会删除 IndexedDB、localStorage 与缓存。</p>
  </div>`;
}
