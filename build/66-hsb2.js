/* ---------------------------------------------------------------- hsb2
 * 第二代 shell：WASM + v86 + 真实 FreeBSD 12.0 用户态。
 *
 * 这是**可选组件**，四条硬约束（用户明确要求，改之前先读）：
 *   1. 不主动加载：只有用户敲 hsb2() / 在 hsb1 里敲 hsb2，才会走下面这条链，
 *      页面平时一个字节都不下载。index.html 里没有任何外部 <script src>。
 *   2. 不分发：本项目不附带 FreeBSD / v86 / WASM 的源码或二进制，也不打包镜像；
 *      所有资源运行时从 CDN 拉取。
 *   3. 可完全不用：不碰 hsb2，其余功能一行代码都不受影响。
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

const HSB2 = (() => {
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

  const DB_NAME = 'ht-hsb2', STORE = 'assets';
  /* 旧库名。只用于一次性迁移：不迁的话，改个名字就让所有用户重下 16 MB 镜像。 */
  const DB_OLD = 'ht-hsl2';
  const CACHE_MEM = new Map();   /* 本次会话的内存缓存：IndexedDB 不可用时的兜底 */
  let dbPromise = null;
  let interceptorInstalled = false;
  let oldCopied = false;

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
      req.onsuccess = () => {
        const d = req.result;
        res(d);
        /* 让首次读取先跑完，再去搬旧库；迁移慢一点没人等它。 */
        setTimeout(() => copyOldCache(d), 0);
      };
      req.onerror = () => rej(req.error || new Error('IndexedDB 打不开'));
    });
    return dbPromise;
  }

  /* 从旧库 ht-hsl2 搬一次缓存。异步、失败即放弃，绝不阻塞启动。 */
  async function copyOldCache(d) {
    if (oldCopied) return;
    oldCopied = true;
    try { if (localStorage.getItem(DB_NAME + '.mig') === '1') return; } catch (_) {}
    let old = null;
    try {
      old = await new Promise((res, rej) => {
        const r = indexedDB.open(DB_OLD);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error || new Error('old db'));
      });
      if (!old.objectStoreNames.contains(STORE)) { old.close(); return; }
      const read = (fn) => new Promise(res => {
        const q = fn(old.transaction(STORE, 'readonly').objectStore(STORE));
        q.onsuccess = () => res(q.result); q.onerror = () => res(null);
      });
      const keys = await read(s => s.getAllKeys()) || [];
      if (!keys.length) { old.close(); return; }
      /* 新库已经有东西就不覆盖 */
      const now = await new Promise(res => {
        const q = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
        q.onsuccess = () => res(q.result || []); q.onerror = () => res([]);
      });
      if (now && now.length) { old.close(); return; }
      for (const k of keys) {
        const v = await read(s => s.get(k));
        if (!v) continue;
        await new Promise(res => {
          const t = d.transaction(STORE, 'readwrite');
          t.objectStore(STORE).put(v, k);
          t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res();
        });
      }
      old.close();
      try { localStorage.setItem(DB_NAME + '.mig', '1'); } catch (_) {}
    } catch (_) { try { old && old.close(); } catch (__) {} }
  }
  /* IndexedDB 只是缓存，不是运行前提。
   * Safari 无痕、部分浏览器在 file:// 下、企业策略禁用存储时，
   * indexedDB.open() 会直接抛 SecurityError。以前这里会把异常抛给 loadAsset，
   * 被上层当成"资源加载失败"——看起来就像"不开后端跑不起来"。
   * 现在一律降级：读不到当没缓存，写不进当没写，网络照走。 */
  async function dbGet(key) {
    const mem = CACHE_MEM.get(key);
    if (mem) return mem;
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const q = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => rej(q.error);
      });
    } catch (e) { return null; }
  }
  async function dbPut(key, buf) {
    /* 缓存整个 2 GB 磁盘会撑爆内存，只给"一次启动用得上、又不大"的组件留内存副本 */
    if (buf && buf.byteLength <= 24 * 1024 * 1024) CACHE_MEM.set(key, buf);
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(buf, key);
        t.oncomplete = () => res(true);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('IndexedDB 写入被中止'));
      });
    } catch (e) { return false; }
  }
  function dbClear() {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).clear();
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    })).then(r => {
      try { localStorage.removeItem(DB_NAME + '.mig'); } catch (_) {}
      /* 旧库也一起清：不然「清缓存」对迁移过来的副本不起作用 */
      try {
        const rq = indexedDB.open(DB_OLD);
        rq.onsuccess = () => {
          const od = rq.result;
          if (!od.objectStoreNames.contains(STORE)) { od.close(); return; }
          const t = od.transaction(STORE, 'readwrite');
          t.objectStore(STORE).clear();
          t.oncomplete = () => od.close();
        };
      } catch (_) {}
      return r;
    });
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
      this.__hsb2Url = String(url || '');
      return oOpen.apply(this, arguments);
    };
    P.getResponseHeader = function (name) {
      if (this.__hsb2Url && isOurs(this.__hsb2Url)) return null;
      return oGetHeader.apply(this, arguments);
    };
    P.abort = function () {
      if (this.__hsb2Url && isOurs(this.__hsb2Url)) this.__hsb2Aborted = true;
      return oAbort.apply(this, arguments);
    };
    P.send = function () {
      const url = this.__hsb2Url || '';
      if (!isOurs(url)) return oSend.apply(this, arguments);
      const x = this;
      x.__hsb2Aborted = false;
      (async () => {
        try {
          const r = await loadAsset(url, (got, total) => {
            if (x.onprogress) x.onprogress({ lengthComputable: !!total, loaded: got, total: total || 0 });
          });
          if (x.__hsb2Aborted) return;
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
    else console.log('[hsb2] ' + msg);
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
      log('提示：state 快照恢复失败时可用 hsb2({cold:true}) 走冷启动');
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
    /* 只留一个虚拟机窗口：重复敲 hsb2() 就聚焦已有窗口，别开出一堆 v86 吃内存。 */
    const ex = [...WindowManager.windows.values()].find(w => w.type === 'hsb2');
    if (ex) { WindowManager.focus(ex.id); if (ex.minimized) WindowManager.restore(ex.id); return { id: ex.id, reused: true }; }
    const w = WindowManager.open({ type: 'hsb2', title: 'hsb2 · FreeBSD 12.0 (v86)' });
    return w ? { id: w.id, reused: false } : null;
  }

  return {
    A, VER, start, stop, open, clearCache, usage,
    get running() { return S.running; },
    get cold() { return S.cold; },
    /* 供 HSB2App 转发键盘；不用 HSB2.start 直连，保持单一入口 */
    sendText: (s) => { if (S.emu) S.emu.keyboard_send_text(s); },
    sendKeys: (a) => { if (S.emu) S.emu.keyboard_send_keys(a); },
    sendScancodes: (a) => { if (S.emu) S.emu.keyboard_send_scancodes(a); },
  };
})();

/* ---------------------------------------------------------------- 窗口样式
 * 只注入一次，不进 00-head.html —— 不启动 hsb2 时连这段 CSS 都不必生效。 */
(() => {
  const id = 'hsb2-style';
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = `
.hsb2-warn{padding:8px 12px;font-size:12px;line-height:1.6;color:var(--amber);
  background:rgba(255,180,60,.07);border-bottom:1px solid var(--line);flex:0 0 auto}
.hsb2-bar{display:flex;align-items:center;gap:10px;padding:6px 10px;font-size:12px;
  border-bottom:1px solid var(--line);flex:0 0 auto}
.hsb2-state{font-weight:600;color:var(--fg)}
.hsb2-state.ok{color:var(--green)} .hsb2-state.err{color:var(--red)}
.hsb2-state.warn{color:var(--amber)} .hsb2-state.busy{color:var(--fg-dim)}
.hsb2-cache{color:var(--fg-dim)}
.hsb2-bar button{font:inherit;font-size:12px;padding:3px 9px;border-radius:6px;
  border:1px solid var(--line);background:var(--bg-2,transparent);color:var(--fg);cursor:pointer}
.hsb2-bar button:hover{border-color:var(--fg-dim)}
.hsb2-progress{height:2px;background:var(--line);flex:0 0 auto}
.hsb2-progress i{display:block;height:100%;width:0;background:var(--green);transition:width .25s}
.hsb2-view{flex:1 1 auto;overflow:auto;background:#000;padding:8px;outline:none;cursor:text}
.hsb2-view:focus-within{box-shadow:inset 0 0 0 1px var(--fg-dim)}
.hsb2-view>div{color:#ddd}
.hsb2-log{flex:0 0 auto;max-height:60px;overflow:auto;padding:5px 10px;font:11px/1.55 monospace;
  color:var(--fg-dim);border-top:1px solid var(--line);white-space:pre-wrap}

/* ---- 启动完成：把警告、进度、日志、状态栏全收起来，只留画面 ----
 * 用户明确要求：FreeBSD 起来以后不要再挂一串提示文字。
 * 控制条收成右上角一颗悬浮药丸，鼠标移上去（或键盘聚焦）才出现。 */
.hsb2-app{position:relative}
.hsb2-app.is-live .hsb2-warn,
.hsb2-app.is-live .hsb2-progress,
.hsb2-app.is-live .hsb2-log{display:none}
.hsb2-app.is-live .hsb2-bar{
  position:absolute;right:8px;top:8px;z-index:6;width:auto;
  padding:3px 6px;border:1px solid var(--line);border-radius:8px;
  background:rgba(10,14,16,.74);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  opacity:0;pointer-events:none;transition:opacity .18s ease;
}
/* 运行态不再需要"运行中/缓存 N 项"这行字，也不留那个 flex 占位——
 * 留着它会把药丸撑成横贯窗口的一条，重新盖住画面顶部。 */
.hsb2-app.is-live .hsb2-bar > span{display:none}
.hsb2-app.is-live .hsb2-bar button{font-size:11px;padding:2px 7px}
.hsb2-app.is-live:hover .hsb2-bar,
.hsb2-app.is-live .hsb2-bar:focus-within{opacity:1;pointer-events:auto}
/* 触屏没有 hover：留一颗常驻的淡药丸，点一下就能展开 */
@media (hover:none){
  /* 触屏没有 hover：药丸常驻但挪到右下角，别压住 FreeBSD 启动时刷屏的顶部几行 */
  .hsb2-app.is-live .hsb2-bar{opacity:.55;pointer-events:auto;top:auto;bottom:42px;right:8px}
  .hsb2-app.is-live .hsb2-bar button{font-size:10.5px;padding:1px 6px}
}
/* 键盘桥：一个几乎看不见的 textarea。桌面端负责接收按键，
 * 移动端点画面时 focus() 它，软键盘才会弹出来。1px 高是为了不占版面，
 * font-size:16px 是 iOS 的硬要求——小于 16px 聚焦时会自动放大页面。 */
.hsb2-kbd{
  position:absolute;left:0;bottom:0;width:100%;height:1px;z-index:5;
  margin:0;padding:0;border:0;resize:none;overflow:hidden;
  background:transparent;color:transparent;caret-color:transparent;
  font-size:16px;line-height:1;opacity:.01;pointer-events:none;
}
`;
  document.head.appendChild(st);
})();

/* ---------------------------------------------------------------- 窗口 App */

/* 键盘桥的哨兵字符。textarea 永远留一个零宽空格：
 * 手机软键盘的退格是「删一个字符」，输入框空的时候它连事件都不发——
 * 表现就是点了退格没反应。留个哨兵，退格必然产生一次 input，
 * 我们据此判定「用户按了退格」，再把哨兵补回去。 */
const KBD_SENTINEL = '\u200B';

/* 终端序列 → PS/2 set1 的 make/break。转发顶栏按键和 hsb2 自己的键盘事件都走这里，
 * 不再经过 xterm，所以 OpenBSD/FreeBSD 控制台认的仍是真实的键位。 */
const KBD_SCAN = {
  Escape:   [0x01, 0x81], Tab:      [0x0F, 0x8F],
  Enter:    [0x1C, 0x9C], Backspace:[0x0E, 0x8E],
  Delete:   [0x53, 0xD3], ArrowUp:  [0x48, 0xC8],
  ArrowDown:[0x50, 0xD0], ArrowLeft:[0x4B, 0xCB],
  ArrowRight:[0x4D, 0xCD], Home:    [0x47, 0xC7],
  End:      [0x4F, 0xCF], PageUp:   [0x49, 0xC9],
  PageDown: [0x51, 0xD1],
};
/* Ctrl+字母：字母的 set1 scancode。FreeBSD 的终端 erase / kill / eof 全走这条，
 * Ctrl-C、Ctrl-D、Ctrl-L 之外，Ctrl-U（清行）、Ctrl-W（删词）、Ctrl-K 也常用。 */
const KBD_LETTER = {
  a:0x1E, b:0x30, c:0x2E, d:0x20, e:0x12, f:0x21, g:0x22, h:0x23, i:0x17,
  j:0x24, k:0x25, l:0x26, m:0x32, n:0x31, o:0x18, p:0x19, q:0x10, r:0x13,
  s:0x1F, t:0x14, u:0x16, v:0x2F, w:0x11, x:0x2D, y:0x15, z:0x2C,
};
const KBD_CSI = {
  A:'ArrowUp', B:'ArrowDown', C:'ArrowRight', D:'ArrowLeft',
  H:'Home', F:'End',
};

class HSB2App {
  constructor(body, opts, win) {
    this.body = body;
    this.win = win;
    this.winId = win && win.id;
    this.emu = null;
    this._focused = false;
    this._build();
    HSB2.start(this);
  }

  _build() {
    this.body.classList.add('hsb2-app');
    this.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0b0b0b;position:relative';
    this.body.innerHTML = `
      <div class="hsb2-warn">⚠ <b>hsb2 是可选实验组件</b>：在浏览器里用 WASM 模拟 x86、跑真实的 FreeBSD 12.0。
        FreeBSD 及其工具链存在 GPL 相关历史遗留问题，授权情况复杂；本项目<b>不分发</b>任何相关源码或二进制。
        组件仅在你主动启动后经 CDN 下载并缓存到 IndexedDB，不启动就不下载。完全不用它，其它功能不受影响。</div>
      <div class="hsb2-bar">
        <span class="hsb2-state busy">准备中</span>
        <span class="hsb2-cache"></span>
        <span style="flex:1"></span>
        <button data-a="stop">停止</button>
        <button data-a="restart">重启</button>
        <button data-a="clear">清缓存</button>
      </div>
      <div class="hsb2-progress"><i></i></div>
      <div class="hsb2-view" tabindex="0">
        <div class="hsb2-screen"><div style="white-space:pre;font:14px monospace;line-height:14px"></div><canvas style="display:none"></canvas></div>
        <textarea class="hsb2-kbd" autocomplete="off" autocorrect="off" autocapitalize="off"
                  spellcheck="false" aria-label="虚拟机键盘输入"></textarea>
      </div>
      <div class="hsb2-log"></div>`;

    this.stateEl = this.body.querySelector('.hsb2-state');
    this.cacheEl = this.body.querySelector('.hsb2-cache');
    this.barEl = this.body.querySelector('.hsb2-progress i');
    this.logEl = this.body.querySelector('.hsb2-log');
    this.viewEl = this.body.querySelector('.hsb2-view');
    this.screenEl = this.body.querySelector('.hsb2-screen');

    this.body.querySelector('.hsb2-bar').addEventListener('click', e => {
      const a = e.target.closest('button') && e.target.closest('button').dataset.a;
      if (a === 'stop') HSB2.stop();
      else if (a === 'restart') { HSB2.stop(); this.reload(); }
      else if (a === 'clear') HSB2.clearCache();
    });

    this.kbdEl = this.body.querySelector('.hsb2-kbd');

    /* 点画面即接管键盘；失焦后按键交还给 hterminal 的全局快捷键。
     * 焦点必须落在 textarea 上，不能落在 div 上：
     * 移动端只有 input/textarea/contenteditable 聚焦才会唤起软键盘，
     * div[tabindex] 在 iOS/Android 上只会得到一个光标，键盘不出来。 */
    this.viewEl.addEventListener('pointerdown', e => {
      if (e.target === this.kbdEl) return;
      /* 必须阻止默认聚焦：.hsb2-view 自己带 tabindex，点下去浏览器会把焦点
       * 从 textarea 抢回 div，软键盘随之收起。preventDefault 之后焦点只落在 kbd 上。 */
      e.preventDefault();
      this._focusKbd();
    });
    /* 只挂在 textarea 上：keydown 会冒泡到 viewEl，两处都绑就发两遍。 */
    this.kbdEl.addEventListener('keydown', e => this._onKey(e));

    /* 手机软键盘的退格在空输入框里可能既不发 keydown 也不发 input，
     * 留一个哨兵字符让它「有东西可删」。这里把哨兵放好，光标挪到最后。 */
    this._resetKbd();

    /* beforeinput 是安卓上最可靠的删除信号：即使 keydown 只给 229，
     * 这里仍会拿到 deleteContentBackward。拦掉默认行为，退格由我们自己发。 */
    this.kbdEl.addEventListener('beforeinput', e => {
      if (!e.inputType || e.inputType.indexOf('delete') !== 0) return;
      e.preventDefault();
      this._backspace();
      this._resetKbd();
    });

    /* 软键盘不保证给 keydown（很多中文输入法只给 input），
     * 所以字符统一从 input 事件取；取完立刻恢复哨兵，避免越积越长。 */
    this.kbdEl.addEventListener('input', e => {
      if (e.isComposing) return;              /* 拼音阶段不发，等上屏后的那次 input */
      const type = e.inputType || '';
      if (type.indexOf('delete') === 0) {     /* beforeinput 没兜住时的最后一道 */
        this._backspace();
        this._resetKbd();
        return;
      }
      const v = this.kbdEl.value.split(KBD_SENTINEL).join('');
      this._resetKbd();
      if (!v || !this.emu) return;
      /* 走 _put：顶栏 Ctrl 锁定后，这里输入的字母也要被改写成控制字符 */
      for (const ch of v) this._put(ch === '\n' ? '\r' : ch);
    });
    this.refreshCache();
  }

  screenContainer() { return this.screenEl; }

  onEmulator(emu) {
    this.emu = emu;
    /* 起来了就把提示全部收掉：警告条、进度条、日志、状态栏 */
    this.body.classList.add('is-live');
    this.screenEl.style.visibility = 'visible';
    this._focusKbd();
  }

  /* 聚焦键盘桥。桌面端 preventScroll 防止页面被拽走；
   * 移动端必须由用户手势（pointerdown）同步调用，异步调用 iOS 会拒绝弹键盘。
   * 光标必须落在末尾：否则软键盘的退格会先删掉开头的哨兵，
   * 我们会把它误判成一次删除，而用户看到的字符一个都没少。 */
  _focusKbd() {
    const el = this.kbdEl;
    if (!el) return;
    try { el.focus({ preventScroll: true }); }
    catch (e) { try { el.focus(); } catch (_) {} }
    this._resetKbd();
  }

  /* 供顶栏调用：焦点回到虚拟机的键盘桥（不是桌面终端） */
  focusTerm() { this._focusKbd(); }

  /** 恢复哨兵并把光标放到末尾。 */
  _resetKbd() {
    const el = this.kbdEl;
    if (!el) return;
    if (el.value !== KBD_SENTINEL) el.value = KBD_SENTINEL;
    try { el.setSelectionRange(KBD_SENTINEL.length, KBD_SENTINEL.length); } catch (_) {}
  }

  /** 发一次退格。beforeinput 与 input 可能同时来，40ms 内只认一次。 */
  _backspace() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - (this._bsAt || 0) < 40) return;
    this._bsAt = now;
    HSB2.sendKeys([8]);
  }

  /** 统一入口：先按顶栏的粘滞 Ctrl 改写，再交给 typeTermSeq。 */
  _put(str) {
    if (!str) return;
    if (typeof Keys !== 'undefined' && Keys.anyActive && Keys.anyActive()) str = Keys.shape(str);
    this.typeTermSeq(str);
  }

  /** 终端语义的字节串 → 虚拟机的键事件。
   * 顶栏 Esc/Tab/方向键、Ctrl 组合、软键盘字符都从这里进。
   * 可打印字符合并成一次 sendText（少几次中断，中文也不会被打散）。 */
  typeTermSeq(str) {
    if (!this.emu || !str) return;
    let buf = '';
    const flush = () => { if (buf) { HSB2.sendText(buf); buf = ''; } };
    const scan = (pair) => { if (pair) HSB2.sendScancodes([pair[0], pair[1]]); };

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const code = str.charCodeAt(i);

      if (ch === '\x1b') {
        flush();
        const rest = str.slice(i);
        const m = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest);
        if (m) {
          const name = m[2] === '~'
            ? ({ '3':'Delete', '1':'Home', '4':'End', '5':'PageUp', '6':'PageDown' }[m[1]] || '')
            : (KBD_CSI[m[2]] || '');
          if (name) scan(KBD_SCAN[name]);
          i += m[0].length - 1;
        } else {
          scan(KBD_SCAN.Escape);
        }
        continue;
      }
      if (ch === '\r' || ch === '\n') { flush(); scan(KBD_SCAN.Enter); continue; }
      if (ch === '\t') { flush(); scan(KBD_SCAN.Tab); continue; }
      if (ch === '\x7f' || ch === '\b') { flush(); scan(KBD_SCAN.Backspace); continue; }

      /* 0x01–0x1A = Ctrl+A…Z（0x09/0x0A/0x0D 已在上面处理） */
      if (code >= 1 && code <= 26) {
        flush();
        const letter = String.fromCharCode(code + 96);
        const sc = KBD_LETTER[letter];
        if (sc) HSB2.sendScancodes([0x1D, sc, sc + 0x80, 0x9D]);
        continue;
      }
      buf += ch;
    }
    flush();
  }

  reload() {
    /* 重启要走完整的窗口重建，避免 v86 往已销毁的 DOM 里继续写。 */
    if (this.winId) WindowManager.close(this.winId);
    setTimeout(() => HSB2.open(), 60);
  }

  state(msg, kind) {
    if (!this.stateEl) return;
    this.stateEl.textContent = msg;
    this.stateEl.className = 'hsb2-state ' + (kind || '');
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
    const n = await HSB2.usage();
    if (this.cacheEl) this.cacheEl.textContent = n < 0 ? '缓存不可用' : ('缓存 ' + n + ' 项');
  }

  _onKey(e) {
    if (!this.emu || e.isComposing || e.metaKey) return;
    if (e.ctrlKey && e.altKey) return;          /* AltGr / Ctrl-Alt 交给系统 */
    if (e.ctrlKey && e.shiftKey) return;        /* Ctrl+Shift+C/V 是浏览器复制粘贴 */

    /* F 键没有对应的终端序列，仍按 keyCode 交给 v86 的映射表 */
    const FKEY = { F1:112, F2:113, F3:114, F4:115, F5:116, F6:117,
                   F7:118, F8:119, F9:120, F10:121, F11:122, F12:123 };
    if (FKEY[e.key]) {
      e.preventDefault(); e.stopPropagation();
      HSB2.sendKeys([FKEY[e.key]]);
      return;
    }

    const SEQ = {
      Enter:'\r', Backspace:'\x7f', Tab:'\t', Escape:'\x1b', Delete:'\x1b[3~',
      ArrowUp:'\x1b[A', ArrowDown:'\x1b[B', ArrowLeft:'\x1b[D', ArrowRight:'\x1b[C',
      Home:'\x1b[H', End:'\x1b[F', PageUp:'\x1b[5~', PageDown:'\x1b[6~'
    };

    let out = null;
    if (SEQ[e.key] != null) {
      out = SEQ[e.key];
    } else if (e.key.length === 1) {
      if (e.ctrlKey) {
        const c = e.key.toLowerCase();
        if (c < 'a' || c > 'z') return;         /* Ctrl+数字/符号不认，别插图字符 */
        out = String.fromCharCode(c.charCodeAt(0) - 96);
      } else {
        out = e.key;
      }
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    /* 统一入口：顶栏 ⌃ 锁定后，这里按下的字母也要被改写成控制字符 */
    this._put(out);
  }
}
