/* ============================================================================
 * hterminal · apps: browser / files / editor
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 浏览器 */
const HOME_PAGE = (() => {
  const links = [
    ['Gitee', 'https://gitee.com'], ['MDN', 'https://developer.mozilla.org'],
    ['维基百科', 'https://zh.wikipedia.org'], ['Bing', 'https://cn.bing.com'],
    ['Example', 'https://example.com'], ['Can I use', 'https://caniuse.com'],
    ['Pyodide', 'https://pyodide.org'], ['xterm.js', 'https://xtermjs.org']
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{color-scheme:dark}
    body{margin:0;min-height:100vh;background:#0a0f10;color:#d6e7e3;font-family:ui-sans-serif,system-ui,"PingFang SC",sans-serif;
      display:grid;place-items:center;background-image:radial-gradient(700px 400px at 70% 0%,rgba(94,234,212,.10),transparent 60%)}
    .wrap{width:min(700px,88vw);padding:30px 0}
    h1{font-weight:500;font-size:22px;letter-spacing:.04em;margin:0 0 4px}
    p{color:#6b8b86;font-size:12px;margin:0 0 26px;line-height:1.7}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
    a{display:block;padding:11px 12px;border:1px solid #1d2b2c;border-radius:9px;color:#cfe3df;text-decoration:none;
      font-size:12px;background:rgba(255,255,255,.02);transition:.15s}
    a:hover{border-color:#2c8f83;background:rgba(94,234,212,.06);color:#5eead4}
    .hint{margin-top:22px;font-size:10.5px;color:#4c6661;line-height:1.8}
    code{font-family:ui-monospace,monospace;color:#fbbf24}
  </style></head><body><div class="wrap">
    <h1>浏览器 · 窗口里的真浏览器</h1>
    <p>这是 iframe，也就是浏览器里的浏览器。很多站点用 X-Frame-Options 拒绝被嵌入，打不开时点工具栏的 ↗ 在新标签打开。</p>
    <div class="grid">${links.map(([n, u]) => `<a href="${u}" onclick="parent.postMessage({htNav:'${u}'},'*');return false">${n}</a>`).join('')}</div>
    <div class="hint">地址栏输入网址或搜索词。想从终端打开：<code>openUrl('https://example.com')</code></div>
  </div></body></html>`;
})();

function joinPath(dir, name) {
  return (dir === '.' ? '.' : dir + '.') + name;
}
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (/^(https?|about|data|blob|file):/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(s) && !/\s/.test(s)) return 'https://' + s;
  return 'https://cn.bing.com/search?q=' + encodeURIComponent(s);
}

class BrowserApp {
  constructor(container, opts) {
    this.el = container;
    this.opts = opts || {};
    this.tabs = [];
    this.active = -1;
    this.onTitle = null;
    this.el.innerHTML = `<div class="br">
      <div class="br-tabs"></div>
      <div class="br-bar">
        <button data-a="back" title="后退">‹</button>
        <button data-a="fwd" title="前进">›</button>
        <button data-a="reload" title="刷新">⟳</button>
        <button data-a="home" title="主页">⌂</button>
        <div class="br-addr"><span class="lock">○</span><input spellcheck="false" placeholder="输入网址或搜索"></div>
        <button data-a="go" title="打开">↵</button>
        <button data-a="ext" title="在新标签打开">↗</button>
        <button data-a="new" title="新标签">＋</button>
      </div>
      <div class="br-frame">
        <iframe referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
        <div class="br-fallback"><div>这个站点拒绝被嵌入（X-Frame-Options / CSP）。<br><br>
          <button class="btn primary" data-a="ext">在新标签打开</button></div></div>
      </div>
    </div>`;
    this.tabsEl = $('.br-tabs', this.el);
    this.addr = $('.br-addr input', this.el);
    this.frame = $('iframe', this.el);
    this.frameEl = $('.br-frame', this.el);

    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this.addr.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.act('go'); }
    });
    this.frame.addEventListener('load', () => {
      try {
        const t = this.frame.contentDocument && this.frame.contentDocument.title;
        if (t) this.setTab(this.active, { title:t });
      } catch (e) {}
    });
    this._msg = (e) => {
      if (e.data && e.data.htNav && e.source === this.frame.contentWindow) this.navigate(e.data.htNav);
    };
    window.addEventListener('message', this._msg);

    this.addTab(this.opts.url || '');
  }

  act(a) {
    if (a === 'back') this.step(-1);
    else if (a === 'fwd') this.step(1);
    else if (a === 'reload') this.reload();
    else if (a === 'home') this.navigate('');
    else if (a === 'go') this.navigate(this.addr.value);
    else if (a === 'ext') { const u = this.current().url; if (u) window.open(u, '_blank', 'noopener'); }
    else if (a === 'new') this.addTab('');
  }

  current() { return this.tabs[this.active] || null; }

  addTab(url) {
    const t = { url:'', title:'新标签', hist:[], idx:-1 };
    this.tabs.push(t);
    this.active = this.tabs.length - 1;
    this.renderTabs();
    if (url) this.navigate(url, true);
    else { this.loadHome(); this.setAddr(''); }
    this.renderTabs();
  }
  closeTab(i) {
    if (this.tabs.length <= 1) { this.loadHome(); this.setAddr(''); return; }
    this.tabs.splice(i, 1);
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1;
    this.renderTabs();
    this.restore();
  }
  setTab(i, obj) {
    if (!this.tabs[i]) return;
    Object.assign(this.tabs[i], obj);
    this.renderTabs();
    if (i === this.active) this.setAddr(this.tabs[i].url);
  }
  renderTabs() {
    this.tabsEl.innerHTML = this.tabs.map((t, i) =>
      `<button class="br-tab ${i === this.active ? 'on' : ''}" data-tab="${i}">
        <span>${esc(t.title || '新标签')}</span><i data-x="${i}">✕</i></button>`).join('');
    $$('[data-tab]', this.tabsEl).forEach(b => {
      b.onclick = (e) => {
        if (e.target.dataset.x !== undefined) { this.closeTab(Number(e.target.dataset.x)); return; }
        this.active = Number(b.dataset.tab); this.renderTabs(); this.restore();
      };
    });
  }
  setAddr(u) { if (this.addr && document.activeElement !== this.addr) this.addr.value = u === 'about:blank' ? '' : (u || ''); }

  loadHome() {
    this.frame.removeAttribute('src');
    this.frame.srcdoc = HOME_PAGE;
    this.frameEl.classList.remove('blocked');
    const t = this.current();
    if (t) { t.url = ''; t.title = '新标签'; }
    this.setAddr('');
    this.renderTabs();
  }
  navigate(input, push) {
    if (push === undefined) push = true;
    const url = normalizeUrl(input);
    const t = this.current();
    if (!t) return;
    if (!url) { this.loadHome(); return; }
    t.url = url;
    t.title = url.replace(/^https?:\/\//, '').split('/')[0] || url;
    if (push) { t.hist = t.hist.slice(0, t.idx + 1); t.hist.push(url); t.idx = t.hist.length - 1; }
    this.frame.removeAttribute('srcdoc');
    this.frame.src = url;
    this.frameEl.classList.remove('blocked');
    this.setAddr(url);
    this.renderTabs();
    if (this.onTitle) this.onTitle(t.title);
  }
  step(d) {
    const t = this.current();
    if (!t || t.idx + d < 0 || t.idx + d >= t.hist.length) return;
    t.idx += d;
    const url = t.hist[t.idx];
    t.url = url;
    this.frame.removeAttribute('srcdoc');
    this.frame.src = url;
    this.setAddr(url);
    this.renderTabs();
  }
  reload() {
    const t = this.current();
    if (!t) return;
    if (!t.url) { this.loadHome(); return; }
    try { this.frame.contentWindow.location.reload(); }
    catch (e) { this.frame.src = t.url; this.frameEl.classList.remove('blocked'); }
  }
  restore() {
    const t = this.current();
    if (!t) return;
    if (!t.url) { this.loadHome(); return; }
    this.frame.removeAttribute('srcdoc');
    this.frame.src = t.url;
    this.setAddr(t.url);
  }
  dispose() {
    window.removeEventListener('message', this._msg);
    this.frame.removeAttribute('src');
    this.frame.srcdoc = '';
    this.tabs = [];
  }
}

/* ---------------------------------------------------------------- 文件管理器 */
class FilesApp {
  constructor(container, opts) {
    this.el = container;
    this.path = normPath((opts && opts.path) || '.home');
    this.sel = null;
    this.el.innerHTML = `<div class="fm">
      <div class="fm-bar">
        <button class="btn" data-a="up" title="上级">↑</button>
        <button class="btn" data-a="home" title="家目录">⌂</button>
        <div class="fm-path"></div>
        <button class="btn" data-a="refresh" title="刷新">⟳</button>
        <button class="btn" data-a="newfile" title="新建文件">＋</button>
        <button class="btn" data-a="newdir" title="新建目录">+dir</button>
        <button class="btn" data-a="upload" title="上传">⇧</button>
        <button class="btn danger" data-a="del" title="删除">✕</button>
        <button class="btn" data-a="download" title="下载">↓</button>
      </div>
      <div class="fm-list"></div>
      <div class="fm-prev">选择文件查看内容</div>
    </div>`;
    this.pathEl = $('.fm-path', this.el);
    this.listEl = $('.fm-list', this.el);
    this.prevEl = $('.fm-prev', this.el);
    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this._off = EventBus.on('fs', () => { if (document.contains(this.el)) this.load(); });
    this.load();
  }
  async act(a) {
    try {
      if (a === 'up') { this.path = parentPath(this.path); await this.load(); }
      else if (a === 'home') { this.path = '.home'; await this.load(); }
      else if (a === 'refresh') await this.load();
      else if (a === 'newfile') await this.newEntry(false);
      else if (a === 'newdir') await this.newEntry(true);
      else if (a === 'upload') await this.upload();
      else if (a === 'del') await this.del();
      else if (a === 'download') await this.download();
    } catch (e) { toast(e.message || String(e), true); }
  }
  async load() {
    this.pathEl.textContent = this.path;
    this.pathEl.title = this.path;
    const rows = await FS.list(this.path);
    if (!rows.length) { this.listEl.innerHTML = '<div class="fm-empty">空目录</div>'; return; }
    this.listEl.innerHTML = rows.map(r => `<div class="fm-row" data-p="${esc(r.path)}">
      <span class="ico" style="font-family:var(--mono);color:${r.kind === 'dir' ? 'var(--accent)' : r.kind === 'func' ? 'var(--amber)' : 'var(--fg-mute)'}">${r.kind === 'dir' ? '▸' : r.kind === 'func' ? 'λ' : r.kind === 'app' ? 'a' : r.kind === 'device' ? 'v' : r.kind === 'package' ? 'p' : r.kind === 'grant' ? '!' : r.kind === 'proc' ? '&' : '·'}</span>
      <span class="nm" style="${r.kind === 'dir' ? 'color:var(--accent)' : r.kind === 'func' ? 'color:var(--amber)' : ''}">${esc(r.name)}${r.kind === 'dir' ? '.' : ''}</span>
      <span class="kd">${esc(r.kind)}</span>
      <span class="sz">${r.kind === 'dir' ? '' : fmtBytes(r.size)}</span>
    </div>`).join('');
    $$('.fm-row', this.listEl).forEach(row => {
      row.onclick = () => this.select(row.dataset.p);
      row.ondblclick = () => this.open(row.dataset.p);
    });
  }
  async select(p) {
    this.sel = p;
    $$('.fm-row', this.listEl).forEach(r => r.style.background = r.dataset.p === p ? 'rgba(94,234,212,.08)' : '');
    try {
      const st = await FS.stat(p);
      if (!st) return;
      if (st.kind === 'dir') { this.prevEl.textContent = '目录 ' + p + '\n' + (await FS.list(p)).length + ' 项'; return; }
      if (st.kind === 'app' || st.kind === 'device' || st.kind === 'grant' || st.kind === 'proc' || st.kind === 'package') {
        this.prevEl.textContent = JSON.stringify(st.meta, null, 2);
        return;
      }
      const r = await FS.read(p);
      let c = r.content;
      if (c instanceof ArrayBuffer || c instanceof Blob) { this.prevEl.textContent = '[二进制] ' + fmtBytes(c.size || c.byteLength || 0); return; }
      c = String(c == null ? '' : c);
      this.prevEl.textContent = c.slice(0, 6000) + (c.length > 6000 ? '\n…（已截断）' : '');
    } catch (e) { this.prevEl.textContent = '读取失败：' + e.message; }
  }
  async open(p) {
    const st = await FS.stat(p);
    if (!st) return;
    if (st.kind === 'dir') { this.path = p; await this.load(); return; }
    if (st.kind === 'app') { WindowManager.open({ app:st.meta.app || st.name }); return; }
    if (st.kind === 'func') { WindowManager.open({ type:'editor', path:p, title:st.name }); return; }
    WindowManager.open({ type:'editor', path:p, title:st.name });
  }
  async newEntry(dir) {
    const name = await modal({
      title: dir ? '新建目录' : '新建文件',
      body: `<label class="lbl">名称（字母/中文开头，可含数字 _ -）</label><input class="field" id="nn" placeholder="notes">`,
      buttons: [{ label:'取消', value:null }, { label:'创建', primary:true, onClick:(w) => { const v = $('#nn', w).value.trim(); if (!v) return false; return v; } }]
    });
    if (!name) return;
    const err = checkName(name);
    if (err) { toast(err, true); return; }
    const p = joinPath(this.path, name);
    if (dir) await FS.mkdir(p); else await FS.write(p, '');
    toast((dir ? '目录 ' : '文件 ') + p + ' 已创建');
    await this.load();
    this.select(p);
  }
  async upload() {
    const files = await pickFiles({ multiple:true });
    if (!files.length) return;
    for (const f of files) {
      const name = sanitizeName(f.name, 'upload');
      let p = joinPath(this.path, name), n = 2;
      while (FS.exists(p)) { p = joinPath(this.path, name + '-' + n); n++; }
      const text = /^text\//.test(f.type) || f.size < 131072;
      await FS.write(p, text ? await f.text() : await f.arrayBuffer(), { mime:f.type || 'application/octet-stream', hint:f.name, binary:!text });
    }
    toast('已上传 ' + files.length + ' 个文件');
    await this.load();
  }
  async del() {
    if (!this.sel) { toast('先选一个文件', true); return; }
    if (!(await confirmDlg('删除', `确定删除 <span class="code">${esc(this.sel)}</span> 吗？目录会连同内容一起删除。`, true))) return;
    await FS.remove(this.sel, true);
    this.sel = null;
    this.prevEl.textContent = '选择文件查看内容';
    await this.load();
  }
  async download() {
    if (!this.sel) { toast('先选一个文件', true); return; }
    const st = await FS.stat(this.sel);
    if (!st || st.kind === 'dir') { toast('目录不能直接下载', true); return; }
    const r = await FS.read(this.sel);
    await saveFile(baseName(this.sel), r.content, r.meta && r.meta.mime);
  }
  dispose() { this._off && this._off(); }
}

/* ---------------------------------------------------------------- 编辑器 */
class EditorApp {
  constructor(container, opts) {
    this.el = container;
    this.path = normPath(opts.path || '.home.notes');
    this.mime = (opts.meta && opts.meta.mime) || 'text/plain';
    this.el.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div class="fm-bar">
        <div class="fm-path" style="color:var(--fg-dim)">${esc(this.path)}</div>
        <button class="btn primary" data-a="save" title="Ctrl+S">保存</button>
        <button class="btn" data-a="download">下载</button>
        <button class="btn" data-a="close">关闭</button>
      </div>
      <textarea class="field" spellcheck="false" style="flex:1;border:0;border-radius:0;resize:none;font-size:11.8px;line-height:1.7;background:rgba(0,0,0,.18)"></textarea>
      <div style="padding:4px 10px;font-size:10px;color:var(--fg-mute);border-top:1px solid var(--line-soft);display:flex;gap:12px">
        <span class="st-lines">0 行</span><span class="st-size">0 B</span><span class="st-msg">就绪</span>
      </div>
    </div>`;
    this.ta = $('textarea', this.el);
    this.msg = $('.st-msg', this.el);
    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this.ta.addEventListener('input', () => this.stats());
    this.ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = this.ta.selectionStart, en = this.ta.selectionEnd;
        this.ta.value = this.ta.value.slice(0, s) + '  ' + this.ta.value.slice(en);
        this.ta.selectionStart = this.ta.selectionEnd = s + 2;
      }
    });
    this.load();
  }
  async load() {
    try {
      const r = await FS.read(this.path);
      if (r.content instanceof ArrayBuffer || r.content instanceof Blob) {
        this.ta.value = ''; this.msg.textContent = '二进制文件，无法以文本编辑'; return;
      }
      this.ta.value = r.content == null ? '' : String(r.content);
      this.mime = (r.meta && r.meta.mime) || this.mime;
      this.stats();
      this.msg.textContent = '已加载';
    } catch (e) { this.msg.textContent = '读取失败：' + e.message; }
  }
  stats() {
    const v = this.ta.value;
    $('.st-lines', this.el).textContent = (v ? v.split('\n').length : 0) + ' 行';
    $('.st-size', this.el).textContent = fmtBytes(new Blob([v]).size);
  }
  async save() {
    try {
      const st = await FS.stat(this.path).catch(() => null);
      const meta = Object.assign({}, (st && st.meta) || {}, { mime:this.mime });
      if (st) meta.kind = st.kind;
      if (st && (st.kind === 'func' || st.kind === 'app')) meta.source = this.ta.value;
      await FS.write(this.path, this.ta.value, meta);
      this.msg.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN');
      toast('已保存');
    } catch (e) { this.msg.textContent = '保存失败：' + e.message; toast(e.message, true); }
  }
  async act(a) {
    if (a === 'save') await this.save();
    else if (a === 'download') await saveFile(baseName(this.path), this.ta.value, this.mime);
    else if (a === 'close') { const w = [...WindowManager.windows.values()].find(x => x.content === this); if (w) WindowManager.close(w.id); }
  }
  dispose() {}
}
