/* ---------------------------------------------------------------- hsl2
 * 第二代 shell：WASM + v86 + 真实 FreeBSD 12.0 用户态。
 *
 * 这是**可选组件**，四条硬约束（用户明确要求，改之前先读）：
 *   1. 不主动加载：只有用户敲 hsl2() / 在 hsl1 里敲 hsl2，才会走下面这条链，
 *      页面平时一个字节都不下载。index.html 里没有任何外部 <script src>。
 *   2. 不分发：本项目不附带 FreeBSD / v86 / WASM 的源码或二进制，也不打包镜像；
 *      所有资源运行时从 CDN 拉取。
 *   3. 可完全不用：不碰 hsl2，其余功能一行代码都不受影响。
 *   4. 缓存：拉下来的资源进 IndexedDB，第二次启动优先读本地，不再走网络。
 *
 * 风险：FreeBSD 及其工具链有 GPL 相关历史遗留问题（见 README §5.4 与
 * licenses/README.md）。这里只给出处与许可证原文，不做法律结论。
 *
 * 实现要点：v86 底层用 XMLHttpRequest 取资源，且靠 URL 后缀（.zst）和分块命名
 * 来判断解压/拼接。所以缓存层不能改 URL —— 我们在 XHR.prototype 上做一层
 * **按前缀生效**的拦截：命中我们的 CDN 前缀就从 IndexedDB 喂 ArrayBuffer，
 * 其余请求原样交给浏览器。v86 看到的仍是原始 URL，解压逻辑完全不受影响。
 *
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 */

const HSL2 = (() => {
  'use strict';

  /* 版本锁定：https://cdn.jsdelivr.net/npm/v86@0.5.473/build/libv86.js
   * 这个字面量是给 check-licenses.sh 扫的（它会核对 licenses/README.md 里的版本号）。
   * 升级 v86 时三处一起改：VER、下面这行注释、licenses/README.md 的版本列与许可证原文。 */
  const VER = '0.5.473';                       // v86（Simplified BSD / BSD-2-Clause）
  const JSDELIVR = 'https://cdn.jsdelivr.net/npm/v86@' + VER + '/build/';
  const GH_BIOS = 'https://cdn.jsdelivr.net/gh/copy/v86@master/bios/';
  const IMG_HOST = 'https://i.copy.sh/';       // v86 官方镜像 CDN（CORS: *）

  const A = {
    lib:          JSDELIVR + 'libv86.js',
    wasm:         JSDELIVR + 'v86.wasm',
    wasmFallback: JSDELIVR + 'v86-fallback.wasm',
    bios:         GH_BIOS + 'seabios.bin',
    vgaBios:      GH_BIOS + 'vgabios.bin',
    state:        IMG_HOST + 'freebsd_state-v2.bin.zst',
    hda:          IMG_HOST + 'freebsd/.img',
  };

  /* 官方 freebsd profile 的原始参数（src/browser/main.js）：
   *   memory_size 256MB，2GB 分块盘，1MB 一块，use_parts + state 快照。 */
  const MEM = 256 * 1024 * 1024;
  const DISK_SIZE = 2147483648;
  const CHUNK = 1024 * 1024;

  const DB_NAME = 'ht-hsl2', STORE = 'assets';
  let dbPromise = null;
  let interceptorInstalled = false;

  const S = { app: null, emu: null, running: false, starting: false, cold: false };

  /* ------------------------------------------------------------ IndexedDB */
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { rej(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('IndexedDB 打不开'));
    });
    return dbPromise;
  }
  function dbGet(key) {
    return db().then(d => new Promise((res, rej) => {
      const q = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    }));
  }
  function dbPut(key, buf) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(buf, key);
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('IndexedDB 写入被中止'));
    }));
  }
  function dbClear() {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).clear();
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    }));
  }
  async function usage() {
    try {
      const d = await db();
      return await new Promise(res => {
        const q = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
        q.onsuccess = () => res(q.result.length);
        q.onerror = () => res(-1);
      });
    } catch (e) { return -1; }
  }

  /* ------------------------------------------------------------ 资源加载
   * 先查 IndexedDB，没有才走 CDN；拿回来立刻落库。
   * 这里用的是 fetch，和下面拦截的 XHR 互不相干。 */
  async function loadAsset(url, onProgress) {
    const hit = await dbGet(url);
    if (hit) return { buf: hit, cached: true, bytes: hit.byteLength || 0 };

    /* i.copy.sh 挂在 BunnyCDN 上，带 Referer 的跨域请求会被防盗链判 403
     * （实测：裸 GET 200，只加 Referer 就 403，其它头都无所谓）。
     * 浏览器跨域 fetch 默认会带 Referer，这里显式关掉。 */
    const r = await fetch(url, {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' · ' + short(url));
    const total = Number(r.headers.get('content-length')) || 0;
    let buf;
    if (r.body && total && typeof r.body.getReader === 'function') {
      const reader = r.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        /* CDN 常对文本资源做 gzip/br 传输，content-length 是压缩后的大小，
         * 而 body 读出来的是解压后的字节。超了就别拿它当分母，否则会显示
         * 「1.9 MB / 260 KB」这种鬼东西。 */
        if (onProgress) onProgress(got, (total && got <= total * 1.2) ? total : 0);
      }
      const all = new Uint8Array(got);
      let off = 0;
      for (const p of parts) { all.set(p, off); off += p.length; }
      buf = all.buffer;
    } else {
      buf = await r.arrayBuffer();
    }
    if (!buf || !buf.byteLength) throw new Error('空资源 · ' + short(url));
    try { await dbPut(url, buf); } catch (e) { /* 缓存写不进去不影响本次启动 */ }
    return { buf, cached: false, bytes: buf.byteLength };
  }

  /* ------------------------------------------------------------ XHR 拦截层
   * 只对我们自己的 CDN 前缀生效，别的请求一律原样放行。
   * v86 的加载器读的是 e.response / e.status / e.readyState /
   * e.getResponseHeader()，这几个在实例上用 defineProperty 覆盖即可。 */
  function isOurs(url) {
    return url.indexOf(JSDELIVR) === 0 || url.indexOf(GH_BIOS) === 0 ||
           url.indexOf(IMG_HOST + 'freebsd') === 0;
  }
  function defineRO(obj, key, val) {
    try { Object.defineProperty(obj, key, { configurable: true, get() { return val; } }); }
    catch (e) { /* 极老浏览器：退化为普通赋值 */ try { obj[key] = val; } catch (_) {} }
  }
  function installInterceptor() {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    const P = window.XMLHttpRequest.prototype;
    const oOpen = P.open, oSend = P.send, oAbort = P.abort, oGetHeader = P.getResponseHeader;

    P.open = function (method, url) {
      this.__hsl2Url = String(url || '');
      return oOpen.apply(this, arguments);
    };
    P.getResponseHeader = function (name) {
      if (this.__hsl2Url && isOurs(this.__hsl2Url)) return null;
      return oGetHeader.apply(this, arguments);
    };
    P.abort = function () {
      if (this.__hsl2Url && isOurs(this.__hsl2Url)) this.__hsl2Aborted = true;
      return oAbort.apply(this, arguments);
    };
    P.send = function () {
      const url = this.__hsl2Url || '';
      if (!isOurs(url)) return oSend.apply(this, arguments);
      const x = this;
      x.__hsl2Aborted = false;
      (async () => {
        try {
          const r = await loadAsset(url, (got, total) => {
            if (x.onprogress) x.onprogress({ lengthComputable: !!total, loaded: got, total: total || 0 });
          });
          if (x.__hsl2Aborted) return;
          defineRO(x, 'response', r.buf);
          defineRO(x, 'responseText', '');
          defineRO(x, 'status', 200);
          defineRO(x, 'readyState', 4);
          if (x.onreadystatechange) x.onreadystatechange({ target: x });
          if (x.onload) x.onload({ target: x });
        } catch (e) {
          log('资源加载失败：' + short(url) + ' · ' + (e && e.message || e));
          if (x.onerror) x.onerror(e);
        }
      })();
      return undefined;
    };
  }

  /* ------------------------------------------------------------ 工具 */
  function short(url) {
    return String(url).replace(/^https?:\/\//, '').replace(JSDELIVR, 'v86/').replace(GH_BIOS, 'bios/');
  }
  function fmt(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function log(msg) {
    if (S.app && S.app.log) S.app.log(msg);
    else console.log('[hsl2] ' + msg);
  }
  function progress(msg, pct) {
    if (S.app && S.app.progress) S.app.progress(msg, pct);
  }
  function state(msg, kind) {
    if (S.app && S.app.state) S.app.state(msg, kind);
  }

  /* libv86.js 也走缓存：拿 ArrayBuffer 生成 blob: 脚本，页面上不留 CDN <script>。 */
  async function ensureLib() {
    if (window.V86) return;
    const r = await loadAsset(A.lib, (got, total) =>
      progress('下载 v86 引擎 … ' + fmt(got) + (total ? ' / ' + fmt(total) : ''),
        total ? Math.round(Math.min(1, got / total) * 8) : 0));
    const url = URL.createObjectURL(new Blob([r.buf], { type: 'text/javascript' }));
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { URL.revokeObjectURL(url); res(); };
      s.onerror = () => { URL.revokeObjectURL(url); rej(new Error('libv86.js 执行失败')); };
      document.head.appendChild(s);
    });
    if (!window.V86) throw new Error('libv86.js 没有导出 V86');
  }

  /* ------------------------------------------------------------ 启动 / 停止 */
  async function start(app, opts) {
    if (S.running || S.starting) { state('已在运行', 'ok'); return; }
    S.app = app || S.app;
    S.starting = true;
    S.cold = !!(opts && opts.cold);
    try {
      installInterceptor();
      const list = [A.lib, A.wasm, A.wasmFallback, A.bios, A.vgaBios];
      if (!S.cold) list.push(A.state);

      state('下载组件', 'busy');
      for (let i = 0; i < list.length; i++) {
        const url = list[i];
        const r = await loadAsset(url, (got, total) => {
          progress('组件 ' + (i + 1) + '/' + list.length + ' · ' + short(url) + ' · ' +
            fmt(got) + (total ? ' / ' + fmt(total) : ''),
            Math.round(((i + (total ? Math.min(1, got / total) : 0)) / list.length) * 100));
        });
        log((r.cached ? '缓存命中 ' : '已下载 ') + short(url) + ' · ' + fmt(r.bytes));
      }
      if (S.app && S.app.refreshCache) S.app.refreshCache();
      progress('组件就绪，启动 v86 引擎 …', 100);
      await ensureLib();

      state('启动虚拟机', 'busy');
      log('v86 ' + VER + ' · ' + (S.cold ? '冷启动（无 state 快照）' : '从 state 快照恢复'));

      const emu = new window.V86({
        wasm_path: A.wasm,
        memory_size: MEM,
        vga_memory_size: 8 * 1024 * 1024,
        screen_container: S.app.screenContainer(),
        bios: { url: A.bios },
        vga_bios: { url: A.vgaBios },
        hda: { url: A.hda, size: DISK_SIZE, async: true, fixed_chunk_size: CHUNK, use_parts: true },
        ...(S.cold ? {} : { initial_state: { url: A.state } }),
        disable_mouse: true,
        disable_speaker: true,
        autostart: true,
      });

      /* v86 默认在 window 上挂全局键盘监听，会把 hterminal 自己的快捷键全抢走。
       * 不设 disable_keyboard（那样 keyboard_adapter 不存在，转发方法也用不了），
       * 而是创建完立刻 destroy()：对象保留，全局监听移除，键盘由我们自己转发。 */
      try { if (emu.keyboard_adapter) emu.keyboard_adapter.destroy(); } catch (e) {}

      emu.add_listener('emulator-loaded', () => {
        log('虚拟机已加载');
        state('FreeBSD 12.0 运行中', 'ok');
        progress('运行中 · 点一下画面再敲键盘', 100);
      });
      emu.add_listener('emulator-started', () => log('CPU 开始运行'));
      emu.add_listener('emulator-stopped', () => { state('已停止', 'warn'); S.running = false; });

      S.emu = emu;
      S.running = true;
      if (S.app) S.app.onEmulator(emu);
      log('提示：state 快照恢复失败时可用 hsl2({cold:true}) 走冷启动');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      log('启动失败：' + msg);
      state('启动失败', 'err');
      progress(msg, 0);
      S.running = false;
    } finally {
      S.starting = false;
    }
  }

  function stop() {
    if (!S.emu) { state('未启动', 'warn'); return; }
    try { S.emu.stop(); } catch (e) { log('stop: ' + (e && e.message || e)); }
    S.emu = null;
    S.running = false;
    state('已停止', 'warn');
    log('已停止。缓存仍在，重启不会重新下载。');
  }

  async function clearCache() {
    await dbClear();
    log('IndexedDB 缓存已清空（不影响正在运行的虚拟机）');
    if (S.app) S.app.refreshCache();
  }

  function open(opts) {
    /* 只留一个虚拟机窗口：重复敲 hsl2() 就聚焦已有窗口，别开出一堆 v86 吃内存。 */
    const ex = [...WindowManager.windows.values()].find(w => w.type === 'hsl2');
    if (ex) { WindowManager.focus(ex.id); if (ex.minimized) WindowManager.restore(ex.id); return { id: ex.id, reused: true }; }
    const w = WindowManager.open({ type: 'hsl2', title: 'hsl2 · FreeBSD 12.0 (v86)' });
    return w ? { id: w.id, reused: false } : null;
  }

  return {
    A, VER, start, stop, open, clearCache, usage,
    get running() { return S.running; },
    get cold() { return S.cold; },
    /* 供 HSL2App 转发键盘；不用 HSL2.start 直连，保持单一入口 */
    sendText: (s) => { if (S.emu) S.emu.keyboard_send_text(s); },
    sendKeys: (a) => { if (S.emu) S.emu.keyboard_send_keys(a); },
    sendScancodes: (a) => { if (S.emu) S.emu.keyboard_send_scancodes(a); },
  };
})();

/* ---------------------------------------------------------------- 窗口样式
 * 只注入一次，不进 00-head.html —— 不启动 hsl2 时连这段 CSS 都不必生效。 */
(() => {
  const id = 'hsl2-style';
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = `
.hsl2-warn{padding:8px 12px;font-size:12px;line-height:1.6;color:var(--amber);
  background:rgba(255,180,60,.07);border-bottom:1px solid var(--line);flex:0 0 auto}
.hsl2-bar{display:flex;align-items:center;gap:10px;padding:6px 10px;font-size:12px;
  border-bottom:1px solid var(--line);flex:0 0 auto}
.hsl2-state{font-weight:600;color:var(--fg)}
.hsl2-state.ok{color:var(--green)} .hsl2-state.err{color:var(--red)}
.hsl2-state.warn{color:var(--amber)} .hsl2-state.busy{color:var(--fg-dim)}
.hsl2-cache{color:var(--fg-dim)}
.hsl2-bar button{font:inherit;font-size:12px;padding:3px 9px;border-radius:6px;
  border:1px solid var(--line);background:var(--bg-2,transparent);color:var(--fg);cursor:pointer}
.hsl2-bar button:hover{border-color:var(--fg-dim)}
.hsl2-progress{height:2px;background:var(--line);flex:0 0 auto}
.hsl2-progress i{display:block;height:100%;width:0;background:var(--green);transition:width .25s}
.hsl2-view{flex:1 1 auto;overflow:auto;background:#000;padding:8px;outline:none;cursor:text}
.hsl2-view:focus{box-shadow:inset 0 0 0 1px var(--fg-dim)}
.hsl2-view>div{color:#ddd}
.hsl2-log{flex:0 0 auto;max-height:60px;overflow:auto;padding:5px 10px;font:11px/1.55 monospace;
  color:var(--fg-dim);border-top:1px solid var(--line);white-space:pre-wrap}
`;
  document.head.appendChild(st);
})();

/* ---------------------------------------------------------------- 窗口 App */
class HSL2App {
  constructor(body, opts, win) {
    this.body = body;
    this.win = win;
    this.winId = win && win.id;
    this.emu = null;
    this._focused = false;
    this._build();
    HSL2.start(this);
  }

  _build() {
    this.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0b0b0b';
    this.body.innerHTML = `
      <div class="hsl2-warn">⚠ <b>hsl2 是可选实验组件</b>：在浏览器里用 WASM 模拟 x86、跑真实的 FreeBSD 12.0。
        FreeBSD 及其工具链存在 GPL 相关历史遗留问题，授权情况复杂；本项目<b>不分发</b>任何相关源码或二进制。
        组件仅在你主动启动后经 CDN 下载并缓存到 IndexedDB，不启动就不下载。完全不用它，其它功能不受影响。</div>
      <div class="hsl2-bar">
        <span class="hsl2-state busy">准备中</span>
        <span class="hsl2-cache"></span>
        <span style="flex:1"></span>
        <button data-a="stop">停止</button>
        <button data-a="restart">重启</button>
        <button data-a="clear">清缓存</button>
      </div>
      <div class="hsl2-progress"><i></i></div>
      <div class="hsl2-view" tabindex="0">
        <div class="hsl2-screen"><div style="white-space:pre;font:14px monospace;line-height:14px"></div><canvas style="display:none"></canvas></div>
      </div>
      <div class="hsl2-log"></div>`;

    this.stateEl = this.body.querySelector('.hsl2-state');
    this.cacheEl = this.body.querySelector('.hsl2-cache');
    this.barEl = this.body.querySelector('.hsl2-progress i');
    this.logEl = this.body.querySelector('.hsl2-log');
    this.viewEl = this.body.querySelector('.hsl2-view');
    this.screenEl = this.body.querySelector('.hsl2-screen');

    this.body.querySelector('.hsl2-bar').addEventListener('click', e => {
      const a = e.target.closest('button') && e.target.closest('button').dataset.a;
      if (a === 'stop') HSL2.stop();
      else if (a === 'restart') { HSL2.stop(); this.reload(); }
      else if (a === 'clear') HSL2.clearCache();
    });

    /* 点画面即接管键盘；失焦后按键交还给 hterminal 的全局快捷键。 */
    this.viewEl.addEventListener('pointerdown', () => this.viewEl.focus());
    this.viewEl.addEventListener('keydown', e => this._onKey(e));
    this.refreshCache();
  }

  screenContainer() { return this.screenEl; }

  onEmulator(emu) { this.emu = emu; this.viewEl.focus(); }

  reload() {
    /* 重启要走完整的窗口重建，避免 v86 往已销毁的 DOM 里继续写。 */
    if (this.winId) WindowManager.close(this.winId);
    setTimeout(() => HSL2.open(), 60);
  }

  state(msg, kind) {
    if (!this.stateEl) return;
    this.stateEl.textContent = msg;
    this.stateEl.className = 'hsl2-state ' + (kind || '');
  }
  progress(msg, pct) {
    if (this.barEl && typeof pct === 'number') this.barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (msg) this.log(msg);
  }
  log(msg) {
    if (!this.logEl) return;
    const line = document.createElement('div');
    line.textContent = '· ' + msg;
    this.logEl.appendChild(line);
    while (this.logEl.childElementCount > 120) this.logEl.removeChild(this.logEl.firstChild);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  async refreshCache() {
    const n = await HSL2.usage();
    if (this.cacheEl) this.cacheEl.textContent = n < 0 ? '缓存不可用' : ('缓存 ' + n + ' 项');
  }

  _onKey(e) {
    if (!this.emu || e.isComposing) return;
    const SPECIAL = {
      Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46,
      ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
      Home: 36, End: 35, PageUp: 33, PageDown: 34, F1: 112, F2: 113, F3: 114
    };
    /* Ctrl-C / Ctrl-D / Ctrl-L：走 scancode，按下 Ctrl 前后要成对。
     * make/break：Ctrl=0x1D/0x9D，C=0x2E/0xAE，D=0x20/0xA0，L=0x26/0xA6 */
    const CTRL_SCAN = { c: 0x2E, d: 0x20, l: 0x26, z: 0x2C, a: 0x1E, e: 0x12 };
    if (e.ctrlKey && CTRL_SCAN[e.key.toLowerCase()]) {
      const k = CTRL_SCAN[e.key.toLowerCase()];
      HSL2.sendScancodes([0x1D, k, k + 0x80, 0x9D]);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      HSL2.sendText(e.key);
    } else if (SPECIAL[e.key] != null) {
      HSL2.sendKeys([SPECIAL[e.key]]);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
