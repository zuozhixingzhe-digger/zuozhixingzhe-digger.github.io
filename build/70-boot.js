/* ============================================================================
 * HTerMinaL · boot / RPC / window API / drawer
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 原生 API 转发
 *
 * Worker 里没有 window.alert / confirm / prompt / open / print …，而它们**只能**
 * 由页面线程执行。所以这里原样转发：不换文案、不换按钮、不换返回值类型，
 * 你在屏幕上看到的就是浏览器自己的对话框、自己的弹窗拦截、自己的焦点处理。
 *
 * 两个必须写明的物理限制：
 *   1. 同步返回做不到。跨线程没有同步通道（要 SharedArrayBuffer，需要 COOP/COEP，
 *      双击 index.html 打开时必然没有）。所以 confirm / prompt 的返回值是 Promise。
 *   2. window.open 返回的是 WindowProxy，结构化克隆传不回来，只能回 null。
 */
const NATIVE_ALLOWED = new Set(['alert','confirm','prompt','print','open','close','focus','blur','stop','scrollTo','scrollBy']);

function nativeCall(name, args) {
  if (!NATIVE_ALLOWED.has(String(name))) throw new Error('native: 不允许转发 ' + name);
  const fn = window[name];
  if (typeof fn !== 'function') throw new Error('native: 浏览器没有 ' + name);
  const r = fn.apply(window, Array.isArray(args) ? args : []);
  if (name === 'open') return null;
  return r === undefined ? null : r;
}

/* fastfetch 要的真实信息。拿不到就返回空字符串，由命令那边显示 n/a——
 * 不编数字。 */
function sysInfo() {
  const ua = navigator.userAgent || '';
  const m = ua.match(/(Edg|Chrome|Firefox)\/([\d.]+)/);
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  let mem = '';
  if (navigator.deviceMemory) mem = navigator.deviceMemory + ' GB';
  else if (performance.memory) mem = Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB heap';
  return {
    engine: m ? m[1] + ' ' + m[2] : '',
    os,
    screen: screen.width + 'x' + screen.height,
    dpr: window.devicePixelRatio || 1,
    theme: window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    lang: navigator.language || '',
    cores: navigator.hardwareConcurrency || 0,
    mem
  };
}

/* ---------------------------------------------------------------- RPC（worker → 主线程） */
const RPC = {
  async dispatch(m, session) {
    const op = m.op;
    const a = m.args || [];
    switch (op) {
      case 'fs.resolve': return normPath(a[0] == null ? '.home' : a[0]);
      case 'fs.list': return await FS.list(a[0] || '.home');
      case 'fs.read': return await FS.read(a[0]);
      case 'fs.write': {
        const r = await FS.write(a[0], a[1], a[2] || {});
        return { path:r.path, kind:r.kind, size:r.size };
      }
      case 'fs.stat': return await FS.stat(a[0]);
      case 'fs.remove': return await FS.remove(a[0], !!a[1]);
      case 'fs.mkdir': return await FS.mkdir(a[0]);
      case 'fs.move': return await FS.move(a[0], a[1]);
      case 'fs.copy': return await FS.copy(a[0], a[1]);
      case 'fs.usage': return await FS.usage();
      case 'fs.mounts': return FS.mounts();
      /* spotfs 六个 syscall（worker 侧的命令都落到这里） */
      case 'fs.sptc': return await FS.sptc(a[0], a[1], a[2] || null);
      case 'fs.sptn': return await FS.sptn(a[0], a[1] || {});
      case 'fs.spta': return await FS.spta(a[0], a[1]);
      case 'fs.sptr': return await FS.sptr(a[0]);
      case 'fs.sptx': return await FS.sptx(a[0], a[1] || []);
      case 'fs.sptd': return await FS.sptd(a[0]);
      case 'fs.sptm': return await FS.sptm(a[0], a[1], a[2] || {});
      case 'fs.escape': return spotEscape(a[0]);
      case 'fs.unescape': return spotUnescape(a[0]);
      case 'fs.exportName': return spotExportName(a[0]);
      case 'history.get': return loadHistory();
      case 'history.set': saveHistoryList(a[0] || []); return true;
      case 'settings.get': return Settings.get(a[0]);
      case 'settings.set': Settings.set(a[0], a[1]); return true;
      case 'settings.all': return Settings.all();
      case 'pkg.list': return Pkg.list();
      case 'pkg.add': Pkg.add(a[0]); return true;
      case 'pkg.remove': Pkg.remove(a[0]); return true;
      case 'file.save': return await saveFile(a[0], a[1], a[2]);
      case 'file.ask': return await askFile(a[0] || {});
      case 'file.download': {
        const r = await FS.read(a[0]);
        await saveFile(baseName(a[0]), r.content, (r.meta && r.meta.mime) || 'application/octet-stream');
        return true;
      }
      case 'term.exec': {
        if (session && (a[0] === 'python' || a[0] === 'py')) session.execApp('python');
        return true;
      }
      case 'term.readline': return null;
      case 'win.open': {
        const w = WindowManager.open(a[0] || {});
        return w ? { id:w.id, type:w.type, title:w.title } : null;
      }
      case 'win.close': WindowManager.close(a[0]); return true;
      case 'win.list': return WindowManager.list();
      case 'proc.list': return Proc.list();
      case 'proc.kill': {
        const p = Proc.get(Number(a[0]));
        if (!p || !p.session) return false;
        if (p.session === TerminalManager.desktop) return false;
        p.session.dispose();
        return true;
      }
      case 'perm.request': return await requestPermission(a[0]);
      /* 终端里敲 nuke()：清空所有本地数据并重载。真正的清理逻辑在主线程，
       * Worker 只发一条 RPC——因为 wipeAllStorage 要关 IndexedDB 连接、删库、清 caches。 */
      case 'nuke.run': { nuke(); return true; }
      case 'notify': {
        const msg = String(a[0] || '');
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('HTerMinaL', { body:msg }); return true; } catch (e) {}
        }
        toast(msg);
        return true;
      }
      case 'drawer.open': Drawer.open(); return true;
      case 'agent.open': { const w = WindowManager.open({ type:'agent' }); return w ? w.id : null; }
      /* ---- TUI 智能体：worker 里的 agentTui.* 全走这里 ---- */
      case 'agent.turn': return await AgentTuiHost.turn(a[0]);
      case 'agent.stop': return AgentTuiHost.stop();
      case 'agent.status': return AgentTuiHost.status();
      case 'agent.reset': return AgentTuiHost.reset();
      /* ---- 嵌套 shell / 截图 ---- */
      case 'shell.open': { const w = WindowManager.open({ type:'shell', cwd:a[0] || undefined, banner:a[1] !== false }); return w ? { id:w.id, cwd:w.cwd || a[0] || '.home' } : null; }
      case 'shot.page': return await shot(a[0] || null, a[1] || {});
      case 'shot.window': return await shotWindow(a[0]);
      /* ---- 依赖缓存 ---- */
      case 'deps.usage': return await DepCache.usage();
      case 'deps.list': return await DepCache.list();
      case 'deps.clear': await DepCache.clear(); return true;
      case 'deps.load': await loadScriptCached(a[0]); return true;
      /* ---- DOM：worker 摸页面的唯一通道 ---- */
      case 'dom.op': return await DomRpc.op(a[0], a[1] || []);
      /* ---- 原生 API：Worker 里没有，转回主线程调真的 ----
       * 白名单是「浏览器真实存在的 window 方法」，不做任何替换或包装。 */
      case 'util.hash': {
        const bytes = a[1] instanceof Uint8Array ? a[1]
          : (a[1] instanceof ArrayBuffer ? new Uint8Array(a[1]) : new TextEncoder().encode(String(a[1] == null ? '' : a[1])));
        return hexOf(await hashBytes(a[0], bytes));
      }
      case 'util.algos': return HASH_ALGS.slice();
      /* 编解码统一走这里：算法只有一份（本文件的 56-data 段），
       * HSL 的 b64/hex/hash 命令和「数据」窗口共用，不各写一套。 */
      case 'util.codec': {
        const op = String(a[0] || '');
        const d = a[1];
        const bytes = d instanceof Uint8Array ? d
          : d instanceof ArrayBuffer ? new Uint8Array(d)
          : new TextEncoder().encode(String(d == null ? '' : d));
        switch (op) {
          case 'b64': return b64Of(bytes);
          case 'b64url': return b64UrlOf(bytes);
          case 'b32': return b32Of(bytes);
          case 'hex': return hexOf(bytes);
          case 'hexs': return hexOf(bytes, ' ');
          case 'bin': return binOf(bytes);
          case 'dec': return bigOfBytes(bytes).toString();
          case 'url': return encodeURIComponent(new TextDecoder().decode(bytes));
          case 'unb64': return bytesOfB64(String(d));
          case 'unb32': return bytesOfB32(String(d));
          case 'unhex': return bytesOfHex(String(d));
          case 'unbin': return bytesOfBin(String(d));
          case 'undec': return bytesOfBig(BigInt(String(d).trim() || '0'));
          case 'unurl': return new TextEncoder().encode(decodeURIComponent(String(d)));
          default: throw new Error('util.codec: 不认识的操作 ' + op);
        }
      }
      case 'native': return nativeCall(a[0], a[1] || []);
      case 'sys.info': return sysInfo();
      default: throw new Error('未知 RPC：' + op);
    }
  }
};

/* ---------------------------------------------------------------- 主线程包加载 */
async function loadPackageMain(spec) {
  spec = String(spec || '').trim();
  if (!spec) throw new Error('包名为空');
  const cdn = Settings.get('cdn') || 'esm.sh';
  const urls = [];
  if (/^https?:\/\//.test(spec)) urls.push(spec);
  else if (cdn === 'jsdelivr') urls.push('https://cdn.jsdelivr.net/npm/' + spec + '/+esm');
  else if (cdn === 'unpkg') urls.push('https://unpkg.com/' + spec + '?module');
  else urls.push('https://esm.sh/' + spec, 'https://cdn.jsdelivr.net/npm/' + spec + '/+esm', 'https://unpkg.com/' + spec + '?module');
  let lastErr;
  for (const url of urls) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      const name = spec.replace(/^@[^/]+\//, '').replace(/@.*$/, '').split('/').pop().replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^(\d)/, '_$1');
      Pkg.add({ spec, url, name, cdn, at:Date.now() });
      return mod;
    } catch (e) { lastErr = e; }
  }
  throw new Error('加载失败：' + (lastErr && lastErr.message || lastErr));
}

/* ---------------------------------------------------------------- 应用启动器 / 全屏 */
const AppMenu = {
  el: null,
  toggle(btn) {
    if (this.el) { this.close(); return; }
    const el = document.getElementById('launcher');
    if (!el) return;
    el.hidden = false;
    this.el = el;
    // 点空白处关闭（延迟半拍，避免与本次点击同归于尽）
    setTimeout(() => {
      document.addEventListener('pointerdown', this._outside, true);
    }, 0);
    document.addEventListener('keydown', this._esc, true);
  },
  _outside(e) {
    if (AppMenu.el && !AppMenu.el.contains(e.target) && !e.target.closest('[data-act="apps"]')) AppMenu.close();
  },
  _esc(e) { if (e.key === 'Escape') { AppMenu.close(); } },
  close() {
    if (!this.el) return;
    this.el.hidden = true;
    this.el = null;
    document.removeEventListener('pointerdown', this._outside, true);
    document.removeEventListener('keydown', this._esc, true);
    keepTermFocus();
  }
};

/* 全屏只有一个入口：顶栏 ⛶、F11、Ctrl+Shift+Enter 全走这里。
 * 这样「样式和行为联动」是结构上保证的，不是靠两边各写一遍。
 *
 * 浏览器可能拒绝 requestFullscreen（没有用户手势、iframe 未授权等）。这时退到
 * 软件级全屏：给 body 加 .fs，隐藏顶栏、桌面铺满——功能上仍然是「切全屏了」，
 * 按钮状态也照常翻转，不会出现「按了没反应」。 */
function fullscreenOn() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('fs'));
}
function syncFullscreenBtn() {
  const on = fullscreenOn();
  $$('[data-act="fullscreen"]').forEach(b => {
    b.classList.toggle('k--active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? '退出全屏（F11）' : '全屏（F11）';
  });
  setTimeout(() => { try { TerminalManager.applyAll(); } catch (e) {} }, 260);
}
function toggleFullscreen() {
  const el = document.documentElement;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  const soft = () => { document.body.classList.toggle('fs'); syncFullscreenBtn(); };

  if (isFs) {
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {}); }
    catch (e) { soft(); return; }
    if (document.body.classList.contains('fs')) document.body.classList.remove('fs');
    setTimeout(syncFullscreenBtn, 200);
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) { soft(); return; }
  let p;
  try { p = req.call(el); }
  catch (e) { soft(); return; }
  if (p && p.then) {
    p.then(() => setTimeout(syncFullscreenBtn, 120))
     .catch(() => { soft(); toast('浏览器不允许真全屏，已切换软件级全屏'); });
  } else {
    setTimeout(syncFullscreenBtn, 200);
  }
}

/* ---------------------------------------------------------------- 抽屉 */
/* 光标形态不再提供设置（固定照参考项目那一套），这个函数已删除。
 * 留个注释在这里，避免以后有人搜不到以为忘了写。 */

const Drawer = {
  opened: false,
  init() {
    // 顶栏右侧：▦ 应用启动器 / ⛶ 全屏 / ☰ 更多
    $$('#topbar [data-act]').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'more') { this.opened ? this.close() : this.open(); }
        else if (a === 'apps') AppMenu.toggle(b);
        else if (a === 'fullscreen') toggleFullscreen();
      };
    });
    // 启动器里的应用项
    /* 从按钮位置开窗：窗口会"从这个图标扩散出来"，而不是凭空出现 */
    $$('#launcher [data-app]').forEach(b => {
      b.onclick = () => {
        const r = b.getBoundingClientRect();
        AppMenu.close();
        WindowManager.open({
          type: b.dataset.app,
          from: { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        });
      };
    });
    const launcherMore = $('#launcher [data-act="more"]');
    if (launcherMore) launcherMore.onclick = () => { AppMenu.close(); this.open(); };
    // 品牌 → 关于
    const brand = $('#tbBrand');
    if (brand) brand.onclick = (e) => { e.preventDefault(); modal({ title:'关于 HTerMinaL', body:aboutHtml(), buttons:[{ label:'关闭', primary:true }] }); };
    $('#drawerClose').onclick = () => this.close();
    $('#drawer-overlay').onclick = () => this.close();
    const bindRange = (id, key, fmt) => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = document.getElementById(id + 'Val');
      el.addEventListener('input', () => {
        const v = Number(el.value);
        if (val) val.textContent = fmt ? fmt(v) : String(v);
        Settings.set(key, v);
      });
    };
    bindRange('setFont', 'font');
    bindRange('setLine', 'lineHeight', v => (v / 10).toFixed(1));
    bindRange('setRows', 'rows', v => (v ? v + ' 行' : '自动'));
    // 二选一的一律用开关
    const bindSwitch = (id, key, onVal, offVal) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => Settings.set(key, el.checked ? onVal : offVal));
    };
    if ($('#setCdn')) $('#setCdn').onchange = e => Settings.set('cdn', e.target.value);
    // 智能体：后端 / 直连 二选一 → 开关；直连时才显示密钥与模型
    bindSwitch('setAgentDirect', 'agentMode', 'direct', 'backend');
    bindSwitch('setAgentThinking', 'agentThinking', '1', '0');
    $('#setAgentDirect').addEventListener('change', () => this.syncAgentMode());
    $('#setAgentDirectUrl').onchange = e => Settings.set('agentDirectUrl', e.target.value.trim());
    $('#setAgentKey').onchange = e => { Settings.set('agentKey', e.target.value.trim()); this.refreshAgentLabel(); };
    $('#setAgentUrl').onchange = e => { Settings.set('agentUrl', e.target.value.trim()); this.refreshAgentLabel(); };
    $('#setAgentProvider').onchange = e => { Settings.set('agentProvider', e.target.value); this.refreshAgentLabel(); };
    $('#setAgentModel').onchange = e => { Settings.set('agentModel', e.target.value.trim()); this.refreshAgentLabel(); };
    $('#setAgentSteps').onchange = e => Settings.set('agentSteps', clamp(Number(e.target.value) || 120, 1, 120));

    $('#btnClearHist').onclick = () => { saveHistoryList([]); toast('终端历史已清空'); this.refresh(); };
    $('#btnRestartTerm').onclick = () => { TerminalManager.bootDesktop(); toast('底层终端已重启'); };
    $('#btnOpenFiles').onclick = () => WindowManager.open({ type:'files' });
    $('#btnExportFs').onclick = () => this.exportFs();
    $('#btnImportFs').onclick = () => this.importFs();
    $('#btnSaveLs').onclick = () => this.exportLs();
    $('#btnPkgInstall').onclick = () => this.installPkg();
    $('#pkgInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.installPkg(); });
    $('#btnAgentOpen').onclick = () => WindowManager.open({ type:'agent' });
    $('#btnAgentExport').onclick = () => this.agentExport();
    $('#btnAgentImport').onclick = () => this.agentImport();
    $('#btnAgentClear').onclick = () => this.agentClear();
    $('#btnNuke').onclick = () => nuke();
    if ($('#btnClearDeps')) $('#btnClearDeps').onclick = async () => {
      await DepCache.clear();
      toast('依赖缓存已清空，下次打开会重新下载');
      try { this.refresh(); } catch (e) {}
    };
    $('#btnAbout').onclick = () => modal({ title:'关于 HTerMinaL', body:aboutHtml(), buttons:[{ label:'关闭', primary:true }] });

    this.syncControls();
    this.refreshPkgList();
  },
  syncControls() {
    $('#setFont').value = Settings.get('font');
    $('#setFontVal').textContent = String(Settings.get('font'));
    $('#setLine').value = Settings.get('lineHeight');
    $('#setLineVal').textContent = (Number(Settings.get('lineHeight')) / 10).toFixed(1);
    if ($('#setRows')) { $('#setRows').value = String(Settings.get('rows') || 0); }
    if ($('#setRowsVal')) { const r = Number(Settings.get('rows')) || 0; $('#setRowsVal').textContent = r ? r + ' 行' : '自动'; }
    if ($('#setCdn')) $('#setCdn').value = Settings.get('cdn');
    $('#setAgentDirect').checked = Settings.get('agentMode') === 'direct';
    $('#setAgentUrl').value = Settings.get('agentUrl');
    $('#setAgentDirectUrl').value = Settings.get('agentDirectUrl');
    $('#setAgentKey').value = Settings.get('agentKey');
    if ($('#setAgentThinking')) $('#setAgentThinking').checked = Settings.get('agentThinking') === '1';
    $('#setAgentProvider').value = Settings.get('agentProvider');
    $('#setAgentModel').value = Settings.get('agentModel');
    $('#setAgentSteps').value = Settings.get('agentSteps');
    this.syncAgentMode();
    applyTheme();   // 顺带把「主题」那行的取值刷新成当前系统主题
    $('#stVersion').textContent = 'v' + HT_VERSION;
    ['#tbVer', '#drVersion', '#bootVer'].forEach(sel => { const el = $(sel); if (el) el.textContent = HT_VERSION; });
    if (this.opened) this.refresh();
  },
  /* 后端 / 直连 两种模式互斥：直连才展开密钥与端点，并始终显示风险提示 */
  syncAgentMode() {
    const direct = $('#setAgentDirect') && $('#setAgentDirect').checked;
    $$('[data-when="direct"]').forEach(el => { el.hidden = !direct; });
    $$('[data-when="backend"]').forEach(el => { el.hidden = !!direct; });
    this.refreshAgentLabel();
  },
  open(section) {
    this.opened = true;
    $('#drawer').classList.add('on');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawer-overlay').classList.add('on');
    this.syncControls();
    this.refresh();
    this.checkBackend();
    if (section) {
      setTimeout(() => {
        const secs = $$('.drawer__section', $('#drawer'));
        const map = { agent:'智能体', fs:'文件系统', pkg:'软件包', term:'终端', ui:'外观' };
        const key = map[section] || section;
        const el = secs.find(s => s.textContent.includes(key));
        if (el) el.scrollIntoView({ block:'start', behavior:'smooth' });
      }, 80);
    }
  },
  close() {
    this.opened = false;
    $('#drawer').classList.remove('on');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#drawer-overlay').classList.remove('on');
    if (TerminalManager.desktop && TerminalManager.desktop.term) TerminalManager.desktop.term.focus();
  },
  async refresh() {
    /* 页面可能已经被 document.write / body.innerHTML 整个拆掉了——那是用户
     * 明确要求的「和 F12 一样」。这时 #st* 全是 null，直接跳过，
     * 不要每 2 秒往控制台丢一堆 TypeError。
     *
     * 注意光在开头判一次不够：await 期间页面照样能被拆掉，回来时
     * `$('#stUsage')` 已经是 null（0.0.0.4 实测会冒一条
     * "Cannot set properties of null (setting 'textContent')"）。
     * 所以这里统一用 set()：拿不到元素就什么都不做。 */
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    if (!document.getElementById('stSession')) return;
    try {
      const u = await FS.usage();
      set('#stUsage', (u.usage / 1048576).toFixed(2) + ' MB / ' + (u.quota / 1048576).toFixed(0) + ' MB');
      set('#stFiles', String(FS.idx.size));
    } catch (e) {}
    set('#stSession', (TerminalManager.desktop ? 'desktop' : '—') + ' + ' + Math.max(0, Proc.map.size - 1) + ' workers');
    set('#stHist', String(loadHistory().length));
    /* 对话条数直接问 IndexedDB（ht-agent），不要问内存里的 harness——
     * 刷新之后 harness 还没建，但历史已经在库里了。
     * AgentStore 自己吞异常，库打不开就回 0。 */
    try {
      const s = await AgentStore.summary();
      set('#stAgent', s.messages ? (s.sessions + ' 段 · ' + s.messages + ' 条') : '空');
    } catch (e) { set('#stAgent', '空'); }
    try {
      const d = await DepCache.usage();
      set('#stDeps', d.count ? (d.count + ' 项 · ' + (d.bytes / 1024 / 1024).toFixed(1) + ' MB') : '空');
    } catch (e) {}
    try {
      const d = await DepCache.list();
      if ($('#depList')) {
        $('#depList').innerHTML = d.length
          ? d.map(x => `<div class="drawer__item"><b>${esc(x.url.split('/').pop().split('?')[0].slice(0, 40))}</b><span>${(x.size / 1024).toFixed(0)} KB</span></div>`).join('')
          : '<div class="drawer__item"><span>还没有缓存</span></div>';
      }
    } catch (e) {}
  },
  async checkBackend() {
    const el = $('#stBackend');
    if (!el) return;   /* 页面可能已被 document.write 拆掉 */
    /* file:// 页面的 Origin 是 null，后端一律拒（见 README「双击打开 ≠ 能用后端」）。
     * 这里不发起请求，直接说清楚状态，免得每次开抽屉都往控制台丢一条 CORS 错误。 */
    if (location.protocol === 'file:') {
      el.textContent = 'file:// 下不可用 · 请用 modelserver 打开';
      el.style.color = 'var(--fg-mute)';
      return;
    }
    const base = String(Settings.get('agentUrl') || '').replace(/\/+$/, '');
    if (!base) { el.textContent = '未配置'; return; }
    try {
      const r = await fetch(base + '/health', { cache:'no-store' });
      const j = await r.json().catch(() => ({}));
      el.textContent = r.ok ? ('在线 · ' + (j.provider || 'ready')) : ('HTTP ' + r.status);
      el.style.color = r.ok ? 'var(--green)' : 'var(--amber)';
    } catch (e) {
      el.textContent = '未连接';
      el.style.color = 'var(--fg-mute)';
    }
  },
  refreshAgentLabel() {
    const w = [...WindowManager.windows.values()].find(x => x.type === 'agent' && x.content);
    if (w && w.content.updateModelLabel) w.content.updateModelLabel();
  },
  async exportFs() {
    try {
      const obj = await FS.exportAll();
      await saveFile('HTerMinaL-fs-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(obj, null, 2), 'application/json');
    } catch (e) { toast('导出失败：' + e.message, true); }
  },
  async importFs() {
    const files = await pickFiles({ accept:'.json,application/json' });
    if (!files.length) return;
    try {
      const obj = JSON.parse(await files[0].text());
      if (!(await confirmDlg('导入文件系统', '将把导出文件里的内容合并到当前文件系统（同名覆盖）。继续？'))) return;
      await FS.importAll(obj);
      toast('已导入 ' + (obj.files ? obj.files.length : 0) + ' 个条目');
      EventBus.emit('fs', { type:'import' });
      this.refresh();
    } catch (e) { toast('导入失败：' + e.message, true); }
  },
  async exportLs() {
    const o = {};
    for (const k of lsKeys()) o[k] = localStorage.getItem('ht.ls.' + k);
    await saveFile('HTerMinaL-localstorage.json', JSON.stringify(o, null, 2), 'application/json');
  },
  async installPkg() {
    const inp = $('#pkgInput');
    const spec = inp.value.trim();
    if (!spec) return;
    const btn = $('#btnPkgInstall');
    btn.disabled = true; btn.textContent = '加载中…';
    try {
      await loadPackageMain(spec);
      toast('已安装 ' + spec);
      inp.value = '';
      this.refreshPkgList();
    } catch (e) {
      toast(e.message, true);
    } finally { btn.disabled = false; btn.textContent = '安装 / 加载'; }
  },
  refreshPkgList() {
    const list = Pkg.list();
    const el = $('#pkgList');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="drawer__note" style="padding:2px 0">还没有安装包。试试 lodash、dayjs、marked。</div>'; return; }
    el.innerHTML = list.map(p => `<div class="drawer__item">
      <span class="grow" title="${esc(p.url)}">${esc(p.spec)}</span>
      <span class="tag">${esc(p.name || '')}</span>
      <button data-pkg="${esc(p.spec)}" title="卸载">✕</button></div>`).join('');
    $$('[data-pkg]', el).forEach(b => b.onclick = () => {
      Pkg.remove(b.dataset.pkg);
      toast('已卸载 ' + b.dataset.pkg);
      this.refreshPkgList();
    });
  },
  async agentExport() {
    const w = [...WindowManager.windows.values()].find(x => x.type === 'agent' && x.content);
    if (w) return w.content.act('export');
    try {
      const r = await FS.read('.agent.session');
      await saveFile('agent-session.jsonl', String(r.content || ''), 'application/x-ndjson');
    } catch (e) { toast('会话为空', true); }
  },
  async agentImport() {
    const w = [...WindowManager.windows.values()].find(x => x.type === 'agent' && x.content);
    if (w) return w.content.act('import');
    const files = await pickFiles({ accept:'.jsonl,.json,text/plain' });
    if (!files.length) return;
    const txt = await files[0].text();
    await FS.write('.agent.session', txt, { mime:'application/x-ndjson' });
    toast('已写入 .agent.session，打开智能体即可载入');
  },
  async agentClear() {
    const w = [...WindowManager.windows.values()].find(x => x.type === 'agent' && x.content);
    if (w) return w.content.act('clear');
    await FS.write('.agent.session', '');
    toast('会话已清空');
  }
};

/* ---------------------------------------------------------------- 清理全部数据 */
/* 彻底清除：不是「清几个已知的键」，而是把浏览器给这个源的存储全部掀掉。
 *   1. 先枚举 indexedDB.databases()（Chrome/Edge/Safari 都支持），逐个删；
 *      老浏览器没有这个 API 就退回删我们自己的两个库名。
 *   2. localStorage / sessionStorage 直接 clear()。
 *   3. 所有 Cache Storage、所有 Service Worker 注册。
 *   4. 最后不 reload 而是 replace()：避免用户按后退又回到旧状态。
 * 任何一步失败都不阻断后面的步骤——目标只有一个：什么都不留。 */
async function wipeAllStorage() {
  const done = [];
  const fail = [];
  const step = async (name, fn) => { try { await fn(); done.push(name); } catch (e) { fail.push(name + ':' + (e && e.message || e)); } };

  await step('idb-close', async () => { try { IDB.db && IDB.db.close(); } catch (e) {} IDB.db = null; });
  await step('indexeddb', async () => {
    let names = [];
    if (indexedDB.databases) {
      const list = await indexedDB.databases();
      names = list.map(d => d.name).filter(Boolean);
    }
    if (!names.length) names = ['hterm-fs', 'ht-deps'];
    await Promise.all(names.map(n => new Promise((res) => {
      const r = indexedDB.deleteDatabase(n);
      r.onsuccess = r.onerror = r.onblocked = () => res();
      /* onblocked 说明还有连接没关掉；等一小会儿强制放行，不能卡死在这里 */
      setTimeout(res, 1500);
    })));
  });
  await step('localStorage', async () => { localStorage.clear(); });
  await step('sessionStorage', async () => { sessionStorage.clear(); });
  await step('caches', async () => {
    if (!window.caches) return;
    const ks = await caches.keys();
    await Promise.all(ks.map(k => caches.delete(k)));
  });
  await step('serviceWorker', async () => {
    if (!navigator.serviceWorker) return;
    const rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r => r.unregister()));
  });
  return { done, fail };
}

async function nuke() {
  if (!(await confirmDlg('清除全部数据',
    '会删掉这个页面的<b>全部</b>本地数据：IndexedDB（所有库，含文件系统、依赖缓存）、localStorage、sessionStorage、Cache Storage、Service Worker。<br><br>然后强制重新加载页面，什么都不留。<br><br><b style="color:var(--red)">不可撤销。</b>', true))) return;
  toast('正在清除…');
  const r = await wipeAllStorage();
  try { if (r.fail.length) console.warn('[nuke] 未完成的步骤：', r.fail); } catch (e) {}
  /* replace 而非 reload：后退键回不到旧页面状态 */
  location.replace(location.pathname + '?reset=' + Date.now());
}

/* ---------------------------------------------------------------- window API */
function execInDesktop(code) {
  const d = TerminalManager.desktop;
  if (!d) return false;
  d.term && d.term.focus();
  const s = String(code);
  if (s.includes('\n')) d._post({ t:'in', data:'\x1b[200~' + s + '\x1b[201~' });
  else d._post({ t:'in', data:s + '\r' });
  return true;
}
function installWindowAPI() {
  const H = {
    version: HT_VERSION,
    // 文件
    readFile: (p) => FS.read(normPath(p)),
    writeFile: (p, d, m) => FS.write(normPath(p), d, m || {}),
    listDir: (p) => FS.list(normPath(p || '.home')),
    ls: (p) => FS.list(normPath(p || '.home')),
    remove: (p, r) => FS.remove(normPath(p), !!r),
    mkdir: (p) => FS.mkdir(normPath(p)),
    stat: (p) => FS.stat(normPath(p)),
    move: (a, b) => FS.move(normPath(a), normPath(b)),
    copy: (a, b) => FS.copy(normPath(a), normPath(b)),
    resolve: (p) => normPath(p),
    fs: FS,
    // 文件交互
    saveFile,
    download: saveFile,
    askFile,
    pickFile: askFile,
    // 终端 / 线程
    exec: execInDesktop,
    shell: execInDesktop,
    python: () => { const d = TerminalManager.desktop; if (d) d.execApp('python'); },
    spawn: (code, opts) => WindowManager.open(Object.assign({ type:'shell', code:code || '' }, opts || {})),
    threads: {
      list: () => Proc.list(),
      kill: (pid) => RPC.dispatch({ op:'proc.kill', args:[pid] }),
    },
    // 窗口
    openWindow: (o) => { const w = WindowManager.open(typeof o === 'string' ? { app:o } : (o || {})); return w ? w.id : null; },
    closeWindow: (id) => WindowManager.close(id),
    listWindows: () => WindowManager.list(),
    windows: WindowManager,
    // 网络 / 系统
    fetchText: async (url, opts) => {
      const r = await fetch(url, opts || {});
      return { ok:r.ok, status:r.status, text:await r.text() };
    },
    openURL: (url) => WindowManager.open({ type:'browser', url:String(url) }),
    requestPermission,
    notify: (msg) => {
      if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('HTerMinaL', { body:String(msg) }); return; } catch (e) {} }
      toast(String(msg));
    },
    // 设置 / 包 / 智能体
    settings: { get:Settings.get.bind(Settings), set:Settings.set.bind(Settings), all:() => Settings.all() },
    pkg: { install:loadPackageMain, list:() => Pkg.list(), remove:(s) => Pkg.remove(s) },
    require: loadPackageMain,
    agent: {
      open: () => WindowManager.open({ type:'agent' }),
      get: () => { const w = [...WindowManager.windows.values()].find(x => x.type === 'agent' && x.content); return w ? w.content : null; },
      send: async (text) => { const a = H.agent.get() || (WindowManager.open({ type:'agent' }), await sleep(120), H.agent.get()); if (a) return a.send(text); },
      export: () => Drawer.agentExport(),
      clear: () => Drawer.agentClear(),
    },
    // 其它
    toast,
    modal,
    confirm: confirmDlg,
    clear: () => TerminalManager.desktop && TerminalManager.desktop.clear(),
    history: () => loadHistory(),
    clipboard: {
      write: (t) => navigator.clipboard ? navigator.clipboard.writeText(String(t)) : Promise.reject(new Error('不支持')),
      read: () => navigator.clipboard ? navigator.clipboard.readText() : Promise.reject(new Error('不支持')),
    },
    clearData: nuke,
    nuke,
    about: () => modal({ title:'关于 HTerMinaL', body:aboutHtml(), buttons:[{ label:'关闭', primary:true }] }),
    sleep,
    uuid: uid,
    storage: IDB,
    terminal: TerminalManager,
  };
  H.hterm = H;
  window.hterm = H;
  // 常用别名直接挂 window（用户明确要求“挂在 window 上”）
  Object.assign(window, {
    saveFile, askFile, openWindow: H.openWindow, openURL: H.openURL,
    spawn: H.spawn, python: H.python, exec: execInDesktop,
    requestPermission, notify: H.notify, nuke, hterm: H
  });
}

/* ---------------------------------------------------------------- 快捷键 */
function installKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (/^F\d+$/.test(e.key)) return;
    if (e.key === 'Escape') {
      if ($('#drawer').classList.contains('on')) { Drawer.close(); e.preventDefault(); }
      return;
    }
    if (!e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    const inTerm = !!e.target.closest && !!e.target.closest('.xterm');
    // 终端语义键不抢
    if (inTerm && !e.shiftKey && !e.altKey && ['c', 'd', 'l', 'a', 'e', 'u', 'k', 'w', 'z', '\\', 'r'].includes(k)) return;
    // 输入框里的编辑快捷键不抢
    if (isTypingTarget(e.target) && !e.shiftKey && ['a', 'c', 'v', 'x', 'z', 'y'].includes(k)) return;
    // 给开发者工具留门
    if (e.shiftKey && ['i', 'j', 'c'].includes(k)) return;
    if (e.shiftKey && (e.key === 'Enter')) { e.preventDefault(); toggleFullscreen(); return; }
    if (e.shiftKey) {
      const map = { t:'term', b:'browser', a:'agent', f:'files', p:'python', e:'editor', w:'close', m:'max', d:'desk' };
      if (map[k]) {
        e.preventDefault();
        if (k === 'w') WindowManager.closeFocused();
        else if (k === 'm') { const w = WindowManager.focused(); if (w) WindowManager.toggleMax(w.id); }
        else if (k === 'd') { for (const w of WindowManager.windows.values()) WindowManager.minimize(w.id); }
        else if (k === 'e') WindowManager.open({ type:'editor', path:'.home.welcome', title:'welcome' });
        else if (k === 'p') WindowManager.open({ type:'python' });
        else if (k === 't') WindowManager.open({ type:'shell' });
        else if (k === 'b') WindowManager.open({ type:'browser' });
        else if (k === 'f') WindowManager.open({ type:'files' });
        else if (k === 'a') WindowManager.open({ type:'agent' });
        return;
      }
    }
    if (e.key === ',') { e.preventDefault(); Drawer.opened ? Drawer.close() : Drawer.open(); return; }
    // 其余 Ctrl 组合一律接管（Win / F 键除外）
    e.preventDefault();
  }, true);

  // Alt 组合：不在终端里就吞掉，避免触发浏览器菜单
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('.xterm')) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
  }, true);
}

/* ---------------------------------------------------------------- 拖拽导入
 * 外部文件拖进窗口 = 导入 spotfs。落点：
 *   智能体输入框 → .queryfile（并附加到对话）
 *   文件管理器    → 它当前的目录
 *   其它任何地方  → .home
 * 拖拽过程中的遮罩与「松手导入到 X」提示也在这里管。
 * 拖出去（导出到本机）不在这里：那是文件管理器行自己的 dragstart（DownloadURL）。 */
function _hasFiles(e) {
  const dt = e && e.dataTransfer;
  if (!dt || !dt.types) return false;
  const types = Array.from(dt.types);
  return types.includes('Files') || types.includes('application/x-moz-file');
}
function _dropTarget(el) {
  const ag = el && el.closest && el.closest('.ag-input');
  if (ag) return { label:'.queryfile（并附加到对话）', dir:'.queryfile' };
  const fm = el && el.closest && el.closest('.fm');
  if (fm && fm.__app && fm.__app.path) return { label:fm.__app.path, dir:fm.__app.path };
  /* 拖到终端上：落到它当前目录，并把路径粘到命令行——比丢进 .home 有用得多 */
  const term = _termAt(el);
  if (term && term.cwd) return { label:term.cwd + '（并粘贴路径）', dir:term.cwd, term };
  return { label:'.home', dir:'.home' };
}
/* 从 DOM 往上找终端会话：拖到终端上 = 把路径粘进命令行 */
function _termAt(el) {
  let n = el;
  while (n && n.nodeType === 1) { if (n.__term) return n.__term; n = n.parentElement; }
  return null;
}
function initDropImport() {
  const veil = document.getElementById('dropVeil');
  const label = document.getElementById('dropTargetLabel');
  let depth = 0;
  const hide = () => { depth = 0; if (veil) veil.classList.remove('on'); };

  /* 窗口间拖拽的悬停高亮。文件管理器与智能体输入框自己也会画，
   * 这里只管它们之外的两个落点：终端（粘路径）、浏览器（打开文件）。 */
  let lastZone = null;
  const clearZone = () => {
    if (!lastZone) return;
    lastZone.classList.remove('drop');
    lastZone.removeAttribute('data-drop');
    lastZone = null;
  };
  const zoneOf = (el) => {
    if (!el || !el.closest) return null;
    const t = _termAt(el);
    if (t && t.container) return t.container;
    const br = el.closest('.br-frame');
    if (br) return br;
    return null;
  };
  const paintZone = (el) => {
    const z = zoneOf(el);
    if (z !== lastZone) { clearZone(); lastZone = z; }
    if (!z) return;
    z.dataset.drop = z.__term ? '粘贴路径' : '在浏览器里打开';
    z.classList.add('drop');
  };

  window.addEventListener('dragenter', (e) => {
    if (_hasFiles(e)) {
      e.preventDefault();
      depth++;
      if (label) label.textContent = _dropTarget(e.target).label;
      if (veil) veil.classList.add('on');
      return;
    }
    if (hasInternalDrag(e)) paintZone(e.target);
  }, true);
  window.addEventListener('dragover', (e) => {
    if (_hasFiles(e)) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
      if (label) label.textContent = _dropTarget(e.target).label;
      return;
    }
    if (hasInternalDrag(e)) {
      /* 不 preventDefault 就没有 drop 事件——这是 HTML5 拖拽最坑的一条规则 */
      e.preventDefault();
      try { e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'; } catch (err) {}
      paintZone(e.target);
    }
  }, true);
  window.addEventListener('dragleave', (e) => {
    if (_hasFiles(e)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && veil) veil.classList.remove('on');
      return;
    }
    if (hasInternalDrag(e)) {
      const z = zoneOf(e.target);
      if (z && !z.contains(e.relatedTarget)) clearZone();
    }
  }, true);
  window.addEventListener('drop', async (e) => {
    if (_hasFiles(e)) {
      e.preventDefault();
      hide();
      if (e.__htDropHandled) return;   // 某个应用已经自己收下了
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      if (!files.length) return;
      const t = _dropTarget(e.target);
      try {
        const paths = await importFiles(files, t.dir);
        toast('已导入 ' + paths.length + ' 个文件到 ' + t.dir);
        /* 落在终端上：紧接着把路径粘进命令行，省得用户再去文件管理器里找 */
        if (t.term && paths.length) t.term.insert(paths.join(' '));
      } catch (err) { toast('导入失败：' + (err && err.message || err), true); }
      return;
    }
    if (!hasInternalDrag(e)) return;
    const z = zoneOf(e.target);
    clearZone();
    if (!z || e.__htDropHandled) return;
    const items = DragBus.read(e.dataTransfer);
    if (!items || !items.length) return;
    e.preventDefault();
    e.__htDropHandled = true;
    if (z.__term) {
      /* 终端落点：粘贴路径（不是复制文件）。多个就空格分开，方便一条 rm 全删。 */
      const text = items.map(it => it.kind === 'page' ? (it.url || it.name) : it.path).filter(Boolean).join(' ');
      if (z.__term.insert(text)) toast(items.length > 1 ? '已粘贴 ' + items.length + ' 个路径' : '已粘贴路径');
    }
    DragBus.clear();
  }, false);
  window.addEventListener('dragend', () => { clearZone(); setTimeout(() => DragBus.clear(), 0); }, true);

  /* 兜底：拖拽被系统打断（切窗口、Esc、拖出页面）时 dragend 不一定来。
   * 不收尾的话 body 会一直挂着 drag-internal，浏览器窗口的遮板就一直盖着 iframe，
   * 小浏览器会变得点不动——这种「拖一次就坏」的状态必须自己兜住。 */
  const sweep = () => { if (!DragBus.items) return; setTimeout(() => DragBus.clear(), 0); };
  window.addEventListener('blur', sweep);
  document.addEventListener('visibilitychange', () => { if (document.hidden) DragBus.clear(); });
}

/* ---------------------------------------------------------------- 引导 */
async function boot() {
  const bootEl = document.getElementById('boot');
  const bar = document.getElementById('bootBar');
  const logEl = document.getElementById('bootLog');
  const errEl = document.getElementById('bootErr');
  const sub = document.getElementById('bootSub');
  let p = 0;
  const step = (msg, inc) => {
    p = Math.min(100, p + (inc || 8));
    if (bar) bar.style.width = p + '%';
    if (logEl) logEl.textContent = msg;
  };

  /* 版本号先写：启动屏在第一帧就该显示对的号，而不是 HTML 里的占位符。
   * 只有 30-core.js 的 HT_VERSION 是唯一来源，这里不重复定义。 */
  ['#tbVer', '#drVersion', '#bootVer'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.textContent = HT_VERSION;
  });

  try {
    step('读取设置', 5);
    Settings.load();
    // 主题不读设置，直接跟随系统；watchSystemTheme 之后系统切换会实时生效。
    applyTheme();
    watchSystemTheme();
    applyGrid(Settings.get('grid'));

    step('装载 xterm.js', 15);
    await loadXterm((m) => step(m, 6));
    step('xterm.js 就绪', 10);

    step('打开 IndexedDB', 10);
    await FS.init();
    step('文件系统就绪 · ' + FS.idx.size + ' 个条目', 12);

    step('初始化窗口管理器', 6);
    WindowManager.init();
    Drawer.init();
    installWindowAPI();
    initTopbarKeys();
    installKeys();
    initDropImport();

    step('启动底层终端', 12);
    TerminalManager.bootDesktop();

    step('完成', 10);
    if (sub) sub.textContent = '就绪 · 输入 help 开始';
    await sleep(240);
    bootEl.classList.add('gone');
    setTimeout(() => { bootEl.style.display = 'none'; }, 500);

    // 后台检查后端
    setTimeout(() => Drawer.checkBackend(), 800);

    // URL 里带 ?code=... 时自动执行
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('code')) setTimeout(() => execInDesktop(q.get('code')), 600);
    } catch (e) {}
  } catch (e) {
    console.error(e);
    if (sub) sub.textContent = '启动失败';
    if (errEl) { errEl.hidden = false; errEl.textContent = '启动失败：' + (e && e.stack || e) + '\n\n请检查网络（xterm 从 CDN 加载）。'; }
    step('失败：' + (e.message || e), 0);
  }
}

window.addEventListener('error', (e) => {
  if (e.message && !/ResizeObserver/.test(e.message)) console.error('[HTerMinaL]', e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  if (r && r.name === 'AbortError') return;
  console.warn('[HTerMinaL] unhandled', r);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
