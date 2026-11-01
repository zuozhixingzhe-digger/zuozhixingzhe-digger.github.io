/* ============================================================================
 * hterminal · boot / RPC / window API / drawer
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * ==========================================================================*/

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
      case 'history.get': return loadHistory();
      case 'history.set': saveHistoryList(a[0] || []); return true;
      case 'settings.get': return Settings.get(a[0]);
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
      case 'notify': {
        const msg = String(a[0] || '');
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('hterminal', { body:msg }); return true; } catch (e) {}
        }
        toast(msg);
        return true;
      }
      case 'drawer.open': Drawer.open(); return true;
      case 'agent.open': { const w = WindowManager.open({ type:'agent' }); return w ? w.id : null; }
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

function toggleFullscreen() {
  const el = document.documentElement;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    if (isFs) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const p = req.call(el);
        if (p && p.catch) p.catch(() => toast('当前环境不允许全屏', true));
      } else { toast('当前环境不支持全屏', true); }
    }
  } catch (e) { toast('全屏切换失败：' + (e.message || e), true); }
  setTimeout(() => {
    const btn = document.querySelector('[data-act="fullscreen"]');
    if (btn) btn.classList.toggle('k--active', !!(document.fullscreenElement || document.webkitFullscreenElement));
    TerminalManager.applyAll();
  }, 320);
}

/* ---------------------------------------------------------------- 抽屉 */
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
    $$('#launcher [data-app]').forEach(b => {
      b.onclick = () => { AppMenu.close(); WindowManager.open({ type:b.dataset.app }); };
    });
    const launcherMore = $('#launcher [data-act="more"]');
    if (launcherMore) launcherMore.onclick = () => { AppMenu.close(); this.open(); };
    // 品牌 → 关于
    const brand = $('#tbBrand');
    if (brand) brand.onclick = (e) => { e.preventDefault(); modal({ title:'关于 hterminal', body:aboutHtml(), buttons:[{ label:'关闭', primary:true }] }); };
    $('#drawerClose').onclick = () => this.close();
    $('#drawer-overlay').onclick = () => this.close();
    const bindRange = (id, key, fmt) => {
      const el = document.getElementById(id);
      const val = document.getElementById(id + 'Val');
      el.addEventListener('input', () => {
        const v = Number(el.value);
        if (val) val.textContent = fmt ? fmt(v) : String(v);
        Settings.set(key, v);
      });
    };
    $('#setTheme').onchange = e => Settings.set('theme', e.target.value);
    bindRange('setFont', 'font');
    bindRange('setLine', 'lineHeight', v => (v / 10).toFixed(1));
    $('#setCursor').onchange = e => Settings.set('cursorBlink', e.target.value);
    $('#setGrid').onchange = e => Settings.set('grid', e.target.value);
    $('#setPrompt').onchange = e => Settings.set('prompt', e.target.value || '> ');
    $('#setCdn').onchange = e => Settings.set('cdn', e.target.value);
    $('#setAgentUrl').onchange = e => { Settings.set('agentUrl', e.target.value.trim()); this.refreshAgentLabel(); };
    $('#setAgentProvider').onchange = e => { Settings.set('agentProvider', e.target.value); this.refreshAgentLabel(); };
    $('#setAgentModel').onchange = e => { Settings.set('agentModel', e.target.value.trim()); this.refreshAgentLabel(); };
    $('#setAgentSteps').onchange = e => Settings.set('agentSteps', clamp(Number(e.target.value) || 16, 1, 60));

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
    $('#btnAbout').onclick = () => modal({ title:'关于 hterminal', body:aboutHtml(), buttons:[{ label:'关闭', primary:true }] });

    this.syncControls();
    this.refreshPkgList();
  },
  syncControls() {
    $('#setTheme').value = Settings.get('theme');
    $('#setFont').value = Settings.get('font');
    $('#setFontVal').textContent = String(Settings.get('font'));
    $('#setLine').value = Settings.get('lineHeight');
    $('#setLineVal').textContent = (Number(Settings.get('lineHeight')) / 10).toFixed(1);
    $('#setCursor').value = Settings.get('cursorBlink');
    $('#setGrid').value = Settings.get('grid');
    $('#setPrompt').value = Settings.get('prompt');
    $('#setCdn').value = Settings.get('cdn');
    $('#setAgentUrl').value = Settings.get('agentUrl');
    $('#setAgentProvider').value = Settings.get('agentProvider');
    $('#setAgentModel').value = Settings.get('agentModel');
    $('#setAgentSteps').value = Settings.get('agentSteps');
    $('#stVersion').textContent = 'v' + HT_VERSION;
    ['#tbVer', '#drVersion', '#bootVer'].forEach(sel => { const el = $(sel); if (el) el.textContent = HT_VERSION; });
    if (this.opened) this.refresh();
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
    try {
      const u = await FS.usage();
      $('#stUsage').textContent = (u.usage / 1048576).toFixed(2) + ' MB / ' + (u.quota / 1048576).toFixed(0) + ' MB';
      $('#stFiles').textContent = String(FS.idx.size);
    } catch (e) {}
    $('#stSession').textContent = (TerminalManager.desktop ? 'desktop' : '—') + ' + ' + Math.max(0, Proc.map.size - 1) + ' workers';
    $('#stHist').textContent = String(loadHistory().length);
  },
  async checkBackend() {
    const el = $('#stBackend');
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
      await saveFile('hterminal-fs-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(obj, null, 2), 'application/json');
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
    await saveFile('hterminal-localstorage.json', JSON.stringify(o, null, 2), 'application/json');
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
async function nuke() {
  if (!(await confirmDlg('清除全部数据', '将删除 IndexedDB、localStorage、Cache Storage 中的本页数据，然后重新加载。<br><br><b style="color:var(--red)">不可撤销。</b>', true))) return;
  try { IDB.db && IDB.db.close(); } catch (e) {}
  try { await new Promise((res) => { const r = indexedDB.deleteDatabase('hterm-fs'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } catch (e) {}
  try { localStorage.clear(); } catch (e) {}
  try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) {}
  location.reload();
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
      if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('hterminal', { body:String(msg) }); return; } catch (e) {} }
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
    about: () => modal({ title:'关于 hterminal', body:aboutHtml(), buttons:[{ label:'关闭', primary:true }] }),
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

  try {
    step('读取设置', 5);
    Settings.load();
    applyTheme(Settings.get('theme'));
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
  if (e.message && !/ResizeObserver/.test(e.message)) console.error('[hterminal]', e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  if (r && r.name === 'AbortError') return;
  console.warn('[hterminal] unhandled', r);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
