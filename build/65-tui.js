/* ============================================================================
 * HTerMinaL · 依赖缓存 / 振动 / 截图 / TUI 智能体 / 嵌套 shell
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这个文件解决四件事：
 *   1. 依赖只为「第一次」付网费：CDN 脚本与样式抓一次就进 IndexedDB，
 *      以后所有终端、所有窗口共用同一份，不再每个 session 重下一遍。
 *   2. 振动反馈：**只给方向摇杆**用，键盘输入不震（见下方说明）。
 *   3. 截图：把页面 / 某个元素 / 某个窗口截成 PNG，给智能体做视觉诊断用。
 *   4. TUI 智能体与嵌套 shell：让 AI 和人都能在终端里用函数式接口操作。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 振动反馈 */
/* 只有摇杆用：方向变化时抖一下，连发时轻抖。键盘输入**不**振动——
 * 打字时手本来就在键上，再震一下纯属干扰（这是被用户点名删掉的逻辑）。
 * navigator.vibrate 在桌面端 / 无权限时静默失败，这里包一层 try。 */
let _hapticAt = 0;
function haptic(ms) {
  try {
    if (!navigator.vibrate) return;
    const now = Date.now();
    /* 节流 60ms：小于摇杆连发间隔（180ms），所以每次连发都能感到，但不会重叠加长 */
    if (now - _hapticAt < 60) return;
    _hapticAt = now;
    navigator.vibrate(Math.max(3, Math.min(30, ms || 6)));
  } catch (e) {}
}

/* ---------------------------------------------------------------- 依赖缓存
 * 为什么不用浏览器 HTTP 缓存：它会被「清空数据」清掉、也跨设备不共享，
 * 而且部分 CDN 会返回 no-store。IndexedDB 里的这份是我们自己说了算的。
 * 键 = 完整 URL；值 = { text, at, mime }。
 */
const DepCache = {
  NAME: 'ht-deps',
  STORE: 'files',
  _db: null,
  _mem: new Map(),          // 会话内一级缓存，省掉一次 IDB 往返

  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(this.NAME, 1); }
      catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE, { keyPath: 'url' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => resolve(null);
    });
  },

  async get(url) {
    if (this._mem.has(url)) return this._mem.get(url);
    const db = await this.open();
    if (!db) return null;
    const row = await new Promise((resolve) => {
      try {
        const tx = db.transaction(this.STORE, 'readonly');
        const rq = tx.objectStore(this.STORE).get(url);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    if (row && row.text) this._mem.set(url, row.text);
    return row ? row.text : null;
  },

  async put(url, text, mime) {
    if (!text) return;
    this._mem.set(url, text);
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put({ url, text, mime: mime || '', at: Date.now(), size: text.length });
    } catch (e) {}
  },

  async list() {
    const db = await this.open();
    if (!db) return [];
    return await new Promise((resolve) => {
      try {
        const tx = db.transaction(this.STORE, 'readonly');
        const rq = tx.objectStore(this.STORE).getAll();
        rq.onsuccess = () => resolve((rq.result || []).map(r => ({ url:r.url, size:r.size, at:r.at })));
        rq.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    });
  },

  async clear() {
    this._mem.clear();
    const db = await this.open();
    if (!db) return;
    try { db.transaction(this.STORE, 'readwrite').objectStore(this.STORE).clear(); } catch (e) {}
  },

  /* 统计：给「更多 → 数据」显示「已缓存 N 项 / X KB」 */
  async usage() {
    const rows = await this.list();
    const bytes = rows.reduce((s, r) => s + (r.size || 0), 0);
    return { count: rows.length, bytes };
  }
};

/* 注入一段脚本并等它执行完。用 textContent 而不是 src，这样不再发网络请求。 */
function injectScript(code) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.textContent = code;
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
    /* textContent 的脚本同步执行，这里 resolve 只是让调用方统一 await */
    resolve(true);
  });
}

function injectStyle(css) {
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
  return st;
}

/* 带缓存的脚本加载：缓存优先 → 网络 → 回写缓存。失败会抛错，让调用方降级。 */
async function loadScriptCached(url, onLog) {
  const hit = await DepCache.get(url);
  if (hit) {
    onLog && onLog('缓存命中 ' + shortUrl(url));
    try { await injectScript(hit); return true; }
    catch (e) { /* 缓存内容坏了：当作没命中，走网络 */ }
  }
  onLog && onLog('下载 ' + shortUrl(url));
  const res = await fetch(url, { mode:'cors', credentials:'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url);
  const text = await res.text();
  if (!text) throw new Error('空响应 · ' + url);
  await DepCache.put(url, text, 'text/javascript');
  await injectScript(text);
  return true;
}

async function loadStyleCached(url, onLog) {
  const hit = await DepCache.get(url);
  if (hit) { onLog && onLog('缓存命中 ' + shortUrl(url)); injectStyle(hit); return true; }
  const res = await fetch(url, { mode:'cors', credentials:'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url);
  const text = await res.text();
  await DepCache.put(url, text, 'text/css');
  injectStyle(text);
  return true;
}

function shortUrl(u) {
  try { return String(u).replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/'); }
  catch (e) { return String(u); }
}

/* ---------------------------------------------------------------- 截图
 * html2canvas 而不是浏览器原生 getDisplayMedia：前者能截「页面里的某个元素」，
 * 不需要用户授权，也能把 iframe 之外的 UI 一起拍进去。原生 API 只能整屏，
 * 而且必须用户点确认——对「智能体自动诊断」毫无用处。
 */
let _h2c = null;
const H2C_URLS = [
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
];

async function ensureHtml2Canvas() {
  if (_h2c || window.html2canvas) { _h2c = window.html2canvas; return _h2c; }
  let last;
  for (const u of H2C_URLS) {
    try { await loadScriptCached(u); if (window.html2canvas) { _h2c = window.html2canvas; return _h2c; } }
    catch (e) { last = e; }
  }
  throw new Error('html2canvas 加载失败：' + (last && last.message || last));
}

/* 截图主入口。target 可以是 CSS 选择器、DOM 元素，或省略（= 整个桌面）。 */
async function shot(target, opts) {
  opts = opts || {};
  const h2c = await ensureHtml2Canvas();
  let el = target;
  if (typeof target === 'string') el = document.querySelector(target);
  if (target == null) el = document.getElementById('desk') || document.body;
  if (!el) throw new Error('截图目标不存在：' + target);

  /* backgroundColor:null 保留透明；scale 默认 1（不要 2，AI 用不到那么清楚，
   * 体积翻四倍反而更慢更容易超 token）。 */
  const canvas = await h2c(el, {
    backgroundColor: opts.bg || null,
    scale: opts.scale || 1,
    useCORS: true,
    allowTaint: false,
    logging: false,
    ignoreElements: (n) => n.classList && (n.classList.contains('ht-cursor') || n.classList.contains('win-snap'))
  });
  const type = opts.type || 'image/png';
  return canvas.toDataURL(type, opts.quality || 0.92);
}

async function shotWindow(id) {
  const w = WindowManager.get ? WindowManager.get(id) : null;
  const el = w && w.el ? w.el : document.querySelector('.win[data-id="' + id + '"]');
  if (!el) throw new Error('找不到窗口 ' + id);
  return await shot(el);
}

/* 把 dataURL 转成可以塞进 OpenAI 多模态消息的结构 */
function dataUrlToPart(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { type:'image_url', image_url:{ url: dataUrl } };
}

/* ---------------------------------------------------------------- 无头智能体
 * 给 TUI 版和函数式调用用：不占屏幕，直接复用 AgentApp 的完整 harness（工具、
 * 会话、JSONL 全都一样），只是把 DOM 放在一个游离节点里。
 * 这样「窗口版」和「TUI 版」永远共用同一套逻辑，不会出现两边行为不一致。
 */
const HeadlessAgent = {
  app: null,
  ensure() {
    if (this.app && !this.app._disposed) return this.app;
    const host = document.createElement('div');
    host.style.display = 'none';
    document.body.appendChild(host);
    this.app = new AgentApp(host, { headless: true }, null);
    this.app.onTitle = null;
    return this.app;
  },
  async reset() {
    if (this.app) { try { this.app.dispose(); } catch (e) {} }
    this.app = null;
  },
  /* 跑一轮：发一条用户消息，等 harness 把工具循环走完，把新增消息原样返回。 */
  async turn(text, hooks) {
    const app = this.ensure();
    if (app.running) throw new Error('上一轮还没结束（可用 hterm.agentTui.stop() 中断）');
    const before = app.messages.length;
    if (hooks && hooks.onStart) hooks.onStart();
    await app.send(String(text || ''));
    const added = app.messages.slice(before);
    return {
      messages: added,
      text: added.filter(m => m.role === 'assistant' && m.content).map(m => m.content).join('\n\n'),
      tools: added.filter(m => m.role === 'tool').map(m => ({ name:m.name, content:m.content }))
    };
  }
};

/* ---------------------------------------------------------------- 格式化助手
 * TUI 里打印消息用。故意不引 markdown 库：终端里渲染 markdown 反而更难读，
 * 这里只做「去掉多余空行 + 缩进工具结果」两件事。
 */
function tuiText(m, width) {
  width = width || 80;
  const wrap = (s, indent) => {
    const pad = ' '.repeat(indent || 0);
    const lines = [];
    for (const raw of String(s == null ? '' : s).split('\n')) {
      if (raw.length <= width - (indent || 0)) { lines.push(pad + raw); continue; }
      let rest = raw;
      while (rest.length > width - (indent || 0)) {
        lines.push(pad + rest.slice(0, width - (indent || 0)));
        rest = rest.slice(width - (indent || 0));
      }
      lines.push(pad + rest);
    }
    return lines.join('\n');
  };
  if (m.role === 'assistant') {
    let s = String(m.content || '').trim();
    if (m.tool_calls && m.tool_calls.length) {
      s += (s ? '\n' : '') + m.tool_calls.map(t => '→ ' + t.function.name + ' ' + String(t.function.arguments || '').slice(0, 120)).join('\n');
    }
    return wrap(s || '(空)', 0);
  }
  if (m.role === 'tool') return wrap('  ← ' + (m.name || 'tool') + ': ' + String(m.content || '').replace(/\n/g, '\n    '), 0);
  if (m.role === 'error') return wrap('! ' + (m.content || ''), 0);
  return wrap(String(m.content || ''), 0);
}

/* ---------------------------------------------------------------- 提示词小工具 */
/* 让智能体少写代码：这些是「一句话就能开的窗口」，比让它拼 API 省很多 token。 */
const QuickUI = {
  /* 弹一个小卡片（不是窗口，是一条浮动提示），适合报进度 */
  note(text, ms) {
    toast(String(text || ''), false, ms);
    return 'noted';
  },
  /* 开一个只有 HTML 的窗口——智能体最常见的需求 */
  html(title, html, opts) {
    opts = opts || {};
    const w = WindowManager.open({ type:'browser', title:title || 'html', html:String(html || ''), w:opts.w, h:opts.h });
    return w ? w.id : null;
  },
  /* 开一个文件查看器 */
  file(path, title) {
    const w = WindowManager.open({ type:'editor', path, title:title || baseName(path) });
    return w ? w.id : null;
  },
  /* 开一个跑代码的窗口 */
  code(code, title) {
    const w = WindowManager.open({ type:'shell', code:String(code || ''), title:title || 'code', banner:false });
    return w ? w.id : null;
  },
  /* 桌面上所有窗口的极简快照——智能体「看一眼」比 list() 更省 token */
  desk() {
    return WindowManager.list().map(w => ({ id:w.id, type:w.type, title:w.title, x:Math.round(w.x), y:Math.round(w.y), w:Math.round(w.w), h:Math.round(w.h), max:!!w.maximized }));
  }
};

/* ---------------------------------------------------------------- TUI 宿主（主线程侧）
 * Worker 里的 agentTui 每一步都会调到这里。只做三件事：跑一轮、停、重置。
 * 会话仍然是同一个 .agent.session——TUI 和窗口版看到的是同一段对话。
 */
const AgentTuiHost = {
  async turn(text, opts) {
    const app = HeadlessAgent.ensure();
    if (app.running) throw new Error('上一轮还没跑完');
    const before = app.messages.length;
    await app.send(String(text || ''));
    const added = app.messages.slice(before);
    return {
      messages: added.map(m => ({ role:m.role, name:m.name, content:String(m.content == null ? '' : m.content).slice(0, 4000), tool_calls:(m.tool_calls || []).map(t => ({ name:t.function && t.function.name, args:String(t.function && t.function.arguments || '').slice(0, 400) })) })),
      text: added.filter(m => m.role === 'assistant' && m.content).map(m => m.content).join('\n\n'),
      tools: added.filter(m => m.role === 'tool').map(m => m.name)
    };
  },
  stop() {
    if (HeadlessAgent.app) HeadlessAgent.app.act('stop');
    return true;
  },
  reset() {
    HeadlessAgent.reset();
    return true;
  },
  status() {
    /* 用 ensure 而不是读 app：没开过 TUI 的时候也要能看到「历史里有几条」，
     * 否则用户会以为对话没了。ensure 只建一个 display:none 的宿主。 */
    const a = HeadlessAgent.ensure();
    return { running: !!(a && a.running), messages: a ? a.messages.length : 0 };
  }
};

/* ---------------------------------------------------------------- DOM RPC（主线程侧）
 * Worker 里没有 DOM。这个对象是「Worker 想摸页面」时的唯一通道。
 *
 * 设计原则是**照浏览器原样执行，不自作聪明**：
 *   document.write('…')        → 真的调 document.write，文档被清空也照做
 *   document.body.innerHTML=…  → 真的写宿主 body
 *   el.value = 'x'             → 真的赋值，**不**补发 input/change（原生也不发）
 *
 * 唯一绕不过去的硬限制是「同步返回」：跨线程调用只能是异步的。所以
 *   - 写：立刻下发，语义 100% 相同
 *   - 读：Worker 执行前预取一份快照，读不到就是 undefined（和「元素还没渲染」同感）
 *   - 要 100% 原生同步行为：page.eval('…')，那段代码在主线程跑
 * ==========================================================================*/
const DomRpc = {
  _reg: new Map(),          // ref -> Node
  _rev: new WeakMap(),      // Node -> ref
  _seq: 0,
  _lis: new Map(),          // id -> { sel, type }
  _lisSeq: 0,
  _evBound: false,
  _sinks: new Set(),        // 每个 TerminalSession 注册一个「往自己 Worker 发消息」的函数

  attach(fn) { if (typeof fn === 'function') this._sinks.add(fn); },
  detach(fn) { this._sinks.delete(fn); },
  _emit(msg) { for (const f of this._sinks) { try { f(msg); } catch (e) {} } },

  /* 元素引用：\u0001<n>。用控制字符开头，绝不会和 CSS 选择器撞车。 */
  _tag(node) {
    if (!node) return null;
    if (node === document) return '\u0001doc';
    if (node === window) return '\u0001win';
    let r = this._rev.get(node);
    if (r) return r;
    r = '\u0001' + (++this._seq);
    try { this._rev.set(node, r); } catch (e) { return null; }
    this._reg.set(r, node);
    return r;
  },
  /* 把节点注册到 Worker 指定的 ref 上：Worker 那边同步创建句柄、先拿到 ref，
   * 主线程建好节点后回填。这样 createElement / cloneNode 能同步返回。 */
  _tagAs(ref, node) {
    if (!ref || !node) return null;
    try { this._rev.set(node, ref); } catch (e) {}
    this._reg.set(ref, node);
    return ref;
  },
  _res(ref) {
    if (ref === '\u0001doc') return document;
    if (ref === '\u0001win') return window;
    if (typeof ref !== 'string' || !ref) return null;
    if (ref.charCodeAt(0) === 1) return this._reg.get(ref) || null;
    try { return document.querySelector(ref); } catch (e) { return null; }
  },
  _json(v, depth) {
    if (v === undefined) return null;
    if (v === null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    if (v && v.nodeType) return { __ref: this._tag(v), __kind: 'node', nodeType: v.nodeType,
                                  tag: v.nodeType === 1 ? v.tagName.toLowerCase() : '', text: (v.textContent || '').slice(0, 200) };
    if (v && v.window === v) return { __kind: 'window' };
    if (Array.isArray(v)) {
      if ((depth || 0) > 2) return '[Array(' + v.length + ')]';
      return v.slice(0, 200).map(x => this._json(x, (depth || 0) + 1));
    }
    if (t === 'object') {
      if ((depth || 0) > 2) return '[Object]';
      const o = {};
      let n = 0;
      for (const k of Object.keys(v)) {
        if (n++ > 200) break;
        try { o[k] = this._json(v[k], (depth || 0) + 1); } catch (e) { o[k] = '[getter threw]'; }
      }
      return o;
    }
    return String(v);
  },
  _desc(node, deep) {
    if (!node) return null;
    if (node === document) {
      return {
        ref: '\u0001doc', tag: '#document', id: '', cls: '',
        text: (document.body ? document.body.textContent : '').slice(0, deep ? 20000 : 200),
        attrs: {}, rect: { x:0, y:0, w:innerWidth, h:innerHeight }, visible: true,
        style: {}, parent: null, children: [document.documentElement ? this._tag(document.documentElement) : null].filter(Boolean),
        nodeName: '#document'
      };
    }
    if (node.nodeType !== 1) {
      return { ref: this._tag(node), tag: '#text', id: '', cls: '', text: String(node.nodeValue || '').slice(0, deep ? 20000 : 200),
               attrs: {}, rect:{x:0,y:0,w:0,h:0}, visible: true, style: {}, parent: node.parentNode ? this._tag(node.parentNode) : null,
               children: [], nodeName: node.nodeName };
    }
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    const attrs = {};
    for (const a of node.attributes) attrs[a.name] = a.value;
    const d = {
      ref: this._tag(node),
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      cls: typeof node.className === 'string' ? node.className : (node.className && node.className.baseVal) || '',
      text: (node.textContent || '').slice(0, deep ? 20000 : 200),
      attrs,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
      style: { display: cs.display, position: cs.position, color: cs.color, background: cs.backgroundColor },
      parent: node.parentNode ? this._tag(node.parentNode) : null,
      children: [...node.children].map(c => this._tag(c)),
      nodeName: node.nodeName,
      connected: node.isConnected !== false
    };
    if (deep) {
      /* 截断：整页 innerHTML 可以到几 MB，跨线程克隆一次就是几十毫秒。
       * 20 万字符够覆盖任何正常的「读一段 HTML」场景。 */
      const CAP = 200000;
      d.html = String(node.innerHTML).slice(0, CAP);
      d.outer = String(node.outerHTML).slice(0, CAP);
      if (d.html.length >= CAP) d.htmlTruncated = true;
      if (d.outer.length >= CAP) d.outerTruncated = true;
      if (node.value !== undefined) d.value = node.value;
      if (node.checked !== undefined) d.checked = node.checked;
      if (node.selectedIndex !== undefined) d.selectedIndex = node.selectedIndex;
      if (node.href !== undefined) d.href = node.href;
      if (node.src !== undefined) d.src = node.src;
      const cs2 = {};
      for (const p of ['display','position','color','background-color','width','height','left','top','z-index','font-size','opacity','visibility','transform','overflow','flex-direction','justify-content','align-items','border-radius','box-shadow','padding','margin']) {
        cs2[p] = cs.getPropertyValue(p);
      }
      d.computed = cs2;
    }
    return d;
  },

  _bindEvents() {
    if (this._evBound) return;
    this._evBound = true;
    const types = ['click','dblclick','mousedown','mouseup','mousemove','pointerdown','pointerup',
                   'keydown','keyup','keypress','input','change','submit','focus','blur','scroll','resize','touchstart','touchend'];
    const fire = (t, e) => {
      if (!this._lis.size) return;
      const path = [];
      let n = e.target;
      while (n && path.length < 40) { if (n.nodeType === 1) path.push(this._tag(n)); n = n.parentNode; }
      for (const [id, L] of this._lis) {
        if (L.type !== t) continue;
        const sel = L.sel;
        let hit = false;
        if (!sel || sel === '\u0001win' || sel === 'window' || sel === '\u0001doc' || sel === 'document') hit = true;
        else {
          const el = this._res(sel);
          if (el) hit = (el === e.target) || (el.nodeType === 1 && el.contains(e.target));
        }
        if (!hit) continue;
        let data = null;
        try {
          data = {
            type: e.type, phase: e.eventPhase,
            target: e.target ? { ref: this._tag(e.target), tag: (e.target.tagName||'').toLowerCase(), id: e.target.id||'' } : null,
            path,
            key: e.key, code: e.code, repeat: e.repeat,
            clientX: e.clientX, clientY: e.clientY, button: e.button,
            value: e.target && e.target.value !== undefined ? e.target.value : undefined,
            checked: e.target && e.target.checked !== undefined ? e.target.checked : undefined,
            defaultPrevented: e.defaultPrevented
          };
        } catch (err) { data = { type: e.type }; }
        try { this._emit({ t: 'dom-event', id, ev: data }); } catch (err) {}
      }
    };
    for (const t of types) {
      try { document.addEventListener(t, (e) => fire(t, e), true); } catch (e) {}
      try { window.addEventListener(t, (e) => fire(t, e), true); } catch (e) {}
    }
  },

  async op(name, args) {
    args = args || [];
    switch (name) {
      /* ------------------------------------------------ 文档级读 */
      case 'snap': {
        return {
          url: location.href,
          title: document.title,
          readyState: document.readyState,
          cookie: document.cookie,
          dark: (() => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } })(),
          w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1,
          sx: scrollX || 0, sy: scrollY || 0,
          doc: this._desc(document, false),
          html: document.documentElement ? this._desc(document.documentElement, false) : null,
          head: document.head ? this._desc(document.head, false) : null,
          body: document.body ? this._desc(document.body, false) : null,
          active: document.activeElement ? this._desc(document.activeElement, false) : null
        };
      }
      case 'prefetch': {
        /* 把代码里出现的选择器一次拿全，deep=true（带 innerHTML/value）。
         * 这样 `document.querySelector('#x').innerHTML` 能在 Worker 里同步读到值。 */
        const out = {};
        for (const sel of (args[0] || [])) {
          try {
            const el = document.querySelector(String(sel));
            out[sel] = el ? this._desc(el, true) : null;
          } catch (e) { out[sel] = null; }
        }
        for (const sel of (args[1] || [])) {
          try {
            const list = [...document.querySelectorAll(String(sel))];
            out[sel] = { __list: true, count: list.length, items: list.slice(0, 300).map(el => this._desc(el, true)) };
          } catch (e) { out[sel] = { __list: true, count: 0, items: [] }; }
        }
        return out;
      }
      case 'query': { const el = this._res(args[0]); return el ? this._desc(el, !!args[1]) : null; }
      case 'all': {
        let list = [];
        try { list = [...document.querySelectorAll(String(args[0] || '*'))]; } catch (e) {}
        const lim = Math.min(list.length, Number(args[1]) || 300);
        return { count: list.length, items: list.slice(0, lim).map(el => this._desc(el, !!args[2])) };
      }
      case 'text': { const el = this._res(args[0]); return el ? (el.textContent || '') : null; }
      case 'html': { const el = this._res(args[0]); return el ? el.innerHTML : null; }
      case 'outer': { const el = this._res(args[0]); return el ? el.outerHTML : null; }
      case 'attr': { const el = this._res(args[0]); return el ? el.getAttribute(args[1]) : null; }
      case 'prop': {
        const el = this._res(args[0]); if (!el) return null;
        const prop = String(args[1]);
        if (prop.startsWith('style.')) return this._json(el.style[prop.slice(6)] || '');
        if (prop.startsWith('attr:')) return el.getAttribute(prop.slice(5));
        let v;
        try { v = el[prop]; } catch (e) { v = el.getAttribute(prop); }
        return this._json(v, 0);
      }
      case 'rect': { const el = this._res(args[0]); if (!el) return null; const r = el.getBoundingClientRect(); return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) }; }
      case 'computed': {
        const el = this._res(args[0]); if (!el) return null;
        const cs = getComputedStyle(el); const out = {};
        for (const p of (args[1] || [])) out[p] = cs.getPropertyValue(p);
        return out;
      }
      case 'exists': { const el = this._res(args[0]); return !!(el && el.isConnected !== false); }
      case 'title': return document.title;
      case 'url': return location.href;
      case 'readyState': return document.readyState;
      case 'cookie': return document.cookie;
      case 'htmlRaw': return document.documentElement ? document.documentElement.outerHTML : '';

      /* ------------------------------------------------ 文档级写（真的写） */
      case 'docWrite': {
        /* 真·document.write。文档已加载完时它会隐式 open() 并清空整页——
         * 终端也会没。这就是浏览器行为，不拦、不改成窗口、不搬走。 */
        document.write(String(args[0] == null ? '' : args[0]));
        return true;
      }
      case 'docWriteln': { document.writeln(String(args[0] == null ? '' : args[0])); return true; }
      case 'docOpen': { document.open(); return true; }
      case 'docClose': { document.close(); return true; }
      case 'setTitle': { document.title = String(args[0]); return true; }
      case 'setCookie': { document.cookie = String(args[0]); return true; }
      case 'scrollTo': { window.scrollTo(Number(args[0]) || 0, Number(args[1]) || 0); return { x: scrollX || 0, y: scrollY || 0 }; }

      /* ------------------------------------------------ 元素写（真的写） */
      case 'setHtml': { const el = this._res(args[0]); if (!el) return false; el.innerHTML = String(args[1]); return true; }
      case 'setOuter': { const el = this._res(args[0]); if (!el || !el.parentNode) return false; el.outerHTML = String(args[1]); return true; }
      case 'setText': { const el = this._res(args[0]); if (!el) return false; el.textContent = String(args[1]); return true; }
      case 'setAttr': { const el = this._res(args[0]); if (!el) return false; el.setAttribute(String(args[1]), String(args[2])); return true; }
      case 'rmAttr': { const el = this._res(args[0]); if (!el) return false; el.removeAttribute(String(args[1])); return true; }
      case 'setProp': {
        const el = this._res(args[0]); if (!el) return false;
        const prop = String(args[1]); const v = args[2];
        if (prop.startsWith('style.')) { el.style[prop.slice(6)] = v; return true; }
        if (prop.startsWith('attr:')) { el.setAttribute(prop.slice(5), v); return true; }
        try { el[prop] = v; }
        catch (e) { try { el.setAttribute(prop, v); } catch (e2) { return false; } }
        return true;
      }
      case 'insertHtml': {
        const el = this._res(args[0]); if (!el) return false;
        el.insertAdjacentHTML(String(args[1] || 'beforeend'), String(args[2]));
        return true;
      }
      case 'remove': { const el = this._res(args[0]); if (!el || !el.remove) return false; el.remove(); return true; }
      case 'appendHtml': { const el = this._res(args[0]); if (!el) return false; el.insertAdjacentHTML('beforeend', String(args[1])); return true; }
      case 'prependHtml': { const el = this._res(args[0]); if (!el) return false; el.insertAdjacentHTML('afterbegin', String(args[1])); return true; }
      case 'click': { const el = this._res(args[0]); if (!el) return false; el.click(); return true; }
      case 'focus': { const el = this._res(args[0]); if (!el) return false; el.focus(); return true; }
      case 'blur': { const el = this._res(args[0]); if (!el) return false; el.blur(); return true; }
      case 'addClass': { const el = this._res(args[0]); if (!el) return false; el.classList.add(String(args[1])); return true; }
      case 'removeClass': { const el = this._res(args[0]); if (!el) return false; el.classList.remove(String(args[1])); return true; }
      case 'toggleClass': { const el = this._res(args[0]); if (!el) return false; el.classList.toggle(String(args[1]), args[2] === undefined ? undefined : !!args[2]); return true; }
      case 'hasClass': { const el = this._res(args[0]); return el ? el.classList.contains(String(args[1])) : false; }

      /* ------------------------------------------------ 节点创建 / 组装 */
      case 'createElement': {
        let el;
        try { el = document.createElement(String(args[0])); } catch (e) { throw new Error('createElement 失败：' + args[0]); }
        const props = args[1];
        if (props && typeof props === 'object') {
          for (const k of Object.keys(props)) {
            const v = props[k];
            try {
              if (k === 'style' && v && typeof v === 'object') Object.assign(el.style, v);
              else if (k === 'dataset' && v && typeof v === 'object') Object.assign(el.dataset, v);
              else if (k === 'className') el.className = String(v);
              else if (k === 'html') el.innerHTML = String(v);
              else el.setAttribute(k, String(v));
            } catch (e) {}
          }
        }
        if (args[2] != null) el.innerHTML = String(args[2]);
        return this._tag(el);
      }
      /* ---------------- Worker 预分配 ref 的创建类（能同步返回句柄） ---------------- */
      case 'queryAs': {
        const el = this._res(args[1]);
        if (!el) return null;
        this._tagAs(args[0], el);
        return this._desc(el, true);
      }
      case 'queryInAs': {
        const p = this._res(args[1]); if (!p) return null;
        let el = null;
        try { el = p.querySelector(String(args[2])); } catch (e) {}
        if (!el) return null;
        this._tagAs(args[0], el);
        return this._desc(el, true);
      }
      case 'allIn': {
        const p = this._res(args[1]); if (!p) return { count: 0, items: [] };
        let list = [];
        try { list = [...p.querySelectorAll(String(args[2]))]; } catch (e) {}
        return { count: list.length, items: list.slice(0, 300).map(el => this._desc(el, true)) };
      }
      case 'createAs': {
        const el = document.createElement(String(args[1]));
        this._tagAs(args[0], el);
        const props = args[2];
        if (props && typeof props === 'object') {
          for (const k of Object.keys(props)) {
            const v = props[k];
            try {
              if (k === 'style' && v && typeof v === 'object') Object.assign(el.style, v);
              else if (k === 'dataset' && v && typeof v === 'object') Object.assign(el.dataset, v);
              else if (k === 'className') el.className = String(v);
              else if (k === 'textContent') el.textContent = String(v);
              else if (k === 'html' || k === 'innerHTML') el.innerHTML = String(v);
              else el.setAttribute(k, String(v));
            } catch (e) {}
          }
        }
        if (args[3] != null) el.innerHTML = String(args[3]);
        return this._desc(el, true);
      }
      case 'createTextAs': {
        const t = document.createTextNode(String(args[1] == null ? '' : args[1]));
        this._tagAs(args[0], t);
        return { ref: args[0], tag: '#text', text: t.nodeValue };
      }
      case 'createFragmentAs': {
        const f = document.createDocumentFragment();
        this._tagAs(args[0], f);
        return { ref: args[0], tag: '#fragment' };
      }
      case 'cloneAs': {
        const src = this._res(args[0]); if (!src) return null;
        const cp = src.cloneNode(!!args[2]);
        this._tagAs(args[1], cp);
        return this._desc(cp, true);
      }
      case 'matches': { const el = this._res(args[0]); if (!el || !el.matches) return false; try { return el.matches(String(args[1])); } catch (e) { return false; } }
      case 'closest': {
        const el = this._res(args[0]); if (!el || !el.closest) return null;
        let c2 = null;
        try { c2 = el.closest(String(args[1])); } catch (e) {}
        return c2 ? this._tag(c2) : null;
      }
      case 'fromPoint': {
        const el = document.elementFromPoint(Number(args[1]) || 0, Number(args[2]) || 0);
        if (!el) return null;
        this._tagAs(args[0], el);
        return this._desc(el, true);
      }
      case 'rectRefresh': { const el = this._res(args[0]); if (!el) return null; const r = el.getBoundingClientRect(); return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) }; }
      case 'computedRefresh': {
        const el = this._res(args[0]); if (!el) return null;
        const cs = getComputedStyle(el); const o = {};
        for (const p of ['display','position','color','background-color','width','height','left','top','z-index','font-size','opacity','visibility','transform','overflow','flex-direction','justify-content','align-items','border-radius','box-shadow','padding','margin']) o[p] = cs.getPropertyValue(p);
        return o;
      }
      case 'callMethod': {
        const el = this._res(args[0]); if (!el) return null;
        const m = String(args[1]);
        if (typeof el[m] !== 'function') return null;
        return this._json(el[m](...(Array.isArray(args[2]) ? args[2] : [])), 0);
      }
      case 'nav': { location.href = String(args[0]); return true; }
      case 'navReplace': {
        try { history.replaceState(null, '', String(args[0])); return true; } catch (e) { return false; }
      }
      case 'reload': { location.reload(); return true; }
      case 'createText': { return this._tag(document.createTextNode(String(args[0] == null ? '' : args[0]))); }
      case 'createFragment': { return this._tag(document.createDocumentFragment()); }
      case 'append': { const p = this._res(args[0]), k = this._res(args[1]); if (!p || !k) return false; p.appendChild(k); return true; }
      case 'prepend': { const p = this._res(args[0]), k = this._res(args[1]); if (!p || !k) return false; p.insertBefore(k, p.firstChild); return true; }
      case 'insertBefore': { const p = this._res(args[0]), k = this._res(args[1]), b = this._res(args[2]); if (!p || !k) return false; p.insertBefore(k, b || null); return true; }
      case 'removeChild': { const p = this._res(args[0]), k = this._res(args[1]); if (!p || !k) return false; p.removeChild(k); return true; }
      case 'replaceChild': { const p = this._res(args[0]), n = this._res(args[1]), o = this._res(args[2]); if (!p || !n || !o) return false; p.replaceChild(n, o); return true; }
      case 'clone': { const el = this._res(args[0]); if (!el) return null; return this._tag(el.cloneNode(!!args[1])); }
      case 'call': {
        const el = this._res(args[0]); if (!el) return null;
        const m = String(args[1]);
        if (typeof el[m] !== 'function') throw new Error((m) + ' 不是方法');
        const r = el[m](...(Array.isArray(args[2]) ? args[2] : []));
        return this._json(r, 0);
      }
      case 'dispatch': {
        const el = this._res(args[0]); if (!el) return false;
        const type = String(args[1] || 'click');
        const Ctor = /^(click|dblclick|mouse)/.test(type) ? MouseEvent : (type === 'input' || type === 'change' ? Event : Event);
        const ev = new Ctor(type, { bubbles: true, cancelable: true, detail: args[2] === undefined ? null : args[2] });
        return el.dispatchEvent(ev);
      }

      /* ------------------------------------------------ 事件监听（异步转发） */
      case 'listen': {
        const id = ++this._lisSeq;
        this._lis.set(id, { sel: args[0] || null, type: String(args[1] || 'click') });
        this._bindEvents();
        return id;
      }
      case 'unlisten': { this._lis.delete(Number(args[0])); return true; }
      case 'listeners': return [...this._lis.entries()].map(([id, L]) => ({ id, sel: L.sel, type: L.type }));

      /* ------------------------------------------------ 主线程求值（100% 原生） */
      case 'evalPage': {
        const code = String(args[0] == null ? '' : args[0]);
        let v;
        try {
          /* 间接 eval：在全局作用域执行，和 F12 里敲一行完全一致，
           * 包括「最后一条表达式的值」这个语义（new Function 包一层会丢掉它）。
           * 返回 Promise 就 await，这样 await 写法也能用。 */
          v = (0, eval)(code);
          if (v && typeof v.then === 'function') v = await v;
        } catch (e) { return { __error: true, name: e && e.name, message: e && e.message || String(e) }; }
        return { __ok: true, value: this._json(v, 0) };
      }

      /* ------------------------------------------------ localStorage */
      case 'ls.get': return localStorage.getItem(String(args[0]));
      case 'ls.set': localStorage.setItem(String(args[0]), String(args[1])); return true;
      case 'ls.rm': localStorage.removeItem(String(args[0])); return true;
      case 'ls.clear': localStorage.clear(); return true;
      case 'ls.keys': return Object.keys(localStorage);
      case 'ls.all': {
        const o = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          o[k] = localStorage.getItem(k);
        }
        return o;
      }

      /* ------------------------------------------------ 宿主能力（HTerMinaL 自己的） */
      case 'toast': { toast(String(args[0] || '')); return true; }
      case 'dialog': { const ok = await confirmDlg(String(args[0] || '确认'), String(args[1] || ''), false); return !!ok; }
      case 'openWindow': { const w = WindowManager.open(args[0] || {}); return w ? { id:w.id, type:w.type } : null; }
      case 'wins': return WindowManager.list();
      default: throw new Error('dom.op 不支持：' + name);
    }
  }
};
