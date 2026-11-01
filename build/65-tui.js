/* ============================================================================
 * hterminal · 依赖缓存 / 振动 / 截图 / TUI 智能体 / 嵌套 shell
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这个文件解决四件事：
 *   1. 依赖只为「第一次」付网费：CDN 脚本与样式抓一次就进 IndexedDB，
 *      以后所有终端、所有窗口共用同一份，不再每个 session 重下一遍。
 *   2. 振动反馈：移动端按键、智能体完成/失败时的短振动。
 *   3. 截图：把页面 / 某个元素 / 某个窗口截成 PNG，给智能体做视觉诊断用。
 *   4. TUI 智能体与嵌套 shell：让 AI 和人都能在终端里用函数式接口操作。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 振动反馈 */
/* 只在「像一次按键」时抖一下；很轻，且始终尊重用户的系统设置（navigator.vibrate
 * 在没有权限或桌面端会静默失败，这里包一层 try）。 */
let _hapticAt = 0;
function haptic(ms) {
  try {
    if (typeof Settings !== 'undefined' && Settings.get('haptic') === '0') return;
    if (!navigator.vibrate) return;
    const now = Date.now();
    /* 连打时节流：40ms 内不重复抖，否则输入快的用户手机会一直嗡嗡 */
    if (now - _hapticAt < 40) return;
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
    const a = HeadlessAgent.app;
    return { running: !!(a && a.running), messages: a ? a.messages.length : 0 };
  }
};

/* ---------------------------------------------------------------- DOM RPC（主线程侧）
 * Worker 里没有 DOM。这个对象是「Worker 想摸页面」时唯一的入口，Worker 侧那层
 * document 代理把每个操作翻译成一次 call('dom.op', name, args)。
 *
 * 设计原则：**只传值，不传引用**。返回值一律是能 JSON 化的快照，
 * 因为跨线程没有对象身份可言。改完想再看最新值，就再查一次。
 */
const DomRpc = {
  _el(sel) {
    if (!sel) return null;
    if (typeof sel !== 'string') return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  },
  _desc(el, i) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      index: i,
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      id: el.id || '',
      cls: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').trim().slice(0, 500),
      value: el.value === undefined ? undefined : el.value,
      rect: { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) },
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
      style: { display:cs.display, position:cs.position, color:cs.color, background:cs.backgroundColor }
    };
  },
  async op(name, args) {
    args = args || [];
    switch (name) {
      case 'query': return this._desc(this._el(args[0]), 0);
      case 'all': {
        let list = [];
        try { list = [...document.querySelectorAll(String(args[0] || '*'))]; } catch (e) {}
        const lim = Math.min(list.length, Number(args[1]) || 40);
        return { count: list.length, items: list.slice(0, lim).map((el, i) => this._desc(el, i)) };
      }
      case 'text': { const el = this._el(args[0]); return el ? (el.textContent || '').trim() : null; }
      case 'html': { const el = this._el(args[0]); return el ? el.innerHTML : null; }
      case 'attr': { const el = this._el(args[0]); return el ? el.getAttribute(args[1]) : null; }
      case 'setAttr': { const el = this._el(args[0]); if (!el) return false; el.setAttribute(args[1], String(args[2])); return true; }
      case 'setText': { const el = this._el(args[0]); if (!el) return false; el.textContent = String(args[1]); return true; }
      case 'setValue': { const el = this._el(args[0]); if (!el) return false; el.value = String(args[1]); el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); return true; }
      case 'click': { const el = this._el(args[0]); if (!el) return false; el.click(); return true; }
      case 'addClass': { const el = this._el(args[0]); if (!el) return false; el.classList.add(String(args[1])); return true; }
      case 'removeClass': { const el = this._el(args[0]); if (!el) return false; el.classList.remove(String(args[1])); return true; }
      case 'toggleClass': { const el = this._el(args[0]); if (!el) return false; el.classList.toggle(String(args[1]), args[2] === undefined ? undefined : !!args[2]); return true; }
      case 'hasClass': { const el = this._el(args[0]); return el ? el.classList.contains(String(args[1])) : false; }
      case 'setTitle': document.title = String(args[0]); return true;
      case 'exists': return !!this._el(args[0]);
      case 'rect': { const el = this._el(args[0]); if (!el) return null; const r = el.getBoundingClientRect(); return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) }; }
      case 'computed': {
        const el = this._el(args[0]); if (!el) return null;
        const cs = getComputedStyle(el); const out = {};
        for (const p of (args[1] || [])) out[p] = cs.getPropertyValue(p);
        return out;
      }
      case 'title': return document.title;
      case 'url': return location.href;
      case 'readyState': return document.readyState;
      case 'ls.get': return localStorage.getItem(String(args[0]));
      case 'ls.set': localStorage.setItem(String(args[0]), String(args[1])); return true;
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
      case 'toast': { toast(String(args[0] || '')); return true; }
      case 'dialog': { const ok = await confirmDlg(String(args[0] || '确认'), String(args[1] || ''), false); return !!ok; }
      case 'openWindow': { const w = WindowManager.open(args[0] || {}); return w ? { id:w.id, type:w.type } : null; }
      case 'wins': return WindowManager.list();
      default: throw new Error('dom.op 不支持：' + name);
    }
  }
};
