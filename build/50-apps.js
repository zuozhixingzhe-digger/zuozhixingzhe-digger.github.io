/* ============================================================================
 * HTerMinaL · apps: browser / files / editor
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

/* ---------------------------------------------------------------- URL 分类
 * ERR_UNKNOWN_URL_SCHEME 的来源：把 mailto: / tel: / intent:// 之类塞进 iframe.src，
 * 或者地址栏把未知协议拼成 https://mailto:xxx。浏览器内核不会在 iframe 里处理这些协议，
 * 于是控制台刷错误、窗口一片白。解决办法不是「捕获错误」（跨域根本读不到），
 * 而是**导航前就分类**：只把 http(s)/data/blob 交给 iframe，其余走明确的出路。 */
const KNOWN_SCHEMES = new Set([
  'http','https','about','data','blob','javascript',
  'mailto','tel','sms','geo','maps','market','intent',
  'ftp','ftps','sftp','file','chrome','edge','view-source',
  'weixin','wechat','alipays','alipay','taobao','mqq',
  'itms-apps','itms-services','bitcoin','magnet','thunder'
]);
function schemeOf(s) {
  const m = /^\s*([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/)?/.exec(s || '');
  if (!m) return '';
  const name = m[1].toLowerCase();
  // 只有「显式带 ://」或「在已知协议表里」才算协议。
  // 否则 example.com:8080 会被误认成 example.com 协议。
  return (m[2] || KNOWN_SCHEMES.has(name)) ? name : '';
}
function classifyUrl(input) {
  const s = String(input || '').trim();
  if (!s) return { kind:'blank' };
  const scheme = schemeOf(s);
  if (scheme) {
    if (scheme === 'http' || scheme === 'https' || scheme === 'data' || scheme === 'blob') {
      return { kind:'web', url:s, scheme };
    }
    if (scheme === 'about') {
      return /^about:blank/i.test(s)
        ? { kind:'blank', scheme }
        : { kind:'blocked', scheme, url:s, reason:'about: 开头的浏览器内部页面不能在窗口里嵌入。' };
    }
    if (scheme === 'javascript') {
      return { kind:'blocked', scheme, url:s, reason:'javascript: 地址会执行脚本，不作为网页打开。' };
    }
    return { kind:'external', scheme, url:s };
  }
  // 无协议：localhost / IP / 域名 → 补协议；其余当搜索词
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i.test(s) && !/\s/.test(s)) {
    return { kind:'web', url:'http://' + s };
  }
  if (/^[\w-]+(\.[\w-]+)+([:\/?#].*)?$/.test(s) && !/\s/.test(s)) {
    return { kind:'web', url:'https://' + s };
  }
  return { kind:'search', q:s };
}
function normalizeUrl(input) {
  const c = classifyUrl(input);
  if (c.kind === 'web') return c.url;
  if (c.kind === 'search') return 'https://cn.bing.com/search?q=' + encodeURIComponent(c.q);
  if (c.kind === 'blank') return '';
  return c.url || '';
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
        <button class="txt" data-a="save" title="保存网页到文件系统（.home），之后可以在文件管理器里拖出去">保存</button>
        <button class="txt" data-a="download" title="直接下载这个网页到本机">下载</button>
        <button data-a="new" title="新标签">＋</button>
      </div>
      <div class="br-frame">
        <!-- sandbox 是这里的关键：它会让 mailto:/intent:// 之类的顶层式导航被内核直接拦下，
             不再产生 ERR_UNKNOWN_URL_SCHEME；allow-same-origin 只用于同源首页的链接拦截。 -->
        <iframe referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-storage-access-by-user-activation allow-pointer-lock"
          allow="clipboard-read; clipboard-write; fullscreen"></iframe>
        <!-- 拖拽遮板：iframe 会把 drag 事件吃进它自己的文档，父文档收不到。
             内有拖拽时盖上这一层，拖到浏览器窗口才能被识别成落点。 -->
        <div class="br-shield" aria-hidden="true"></div>
        <div class="br-notice" id="brNotice" hidden>
          <div class="br-notice__title" id="brNoticeTitle">这个地址不能在这里打开</div>
          <div class="br-notice__text" id="brNoticeText"></div>
          <div class="br-notice__acts">
            <button class="dbtn primary" data-n="open">用系统应用打开</button>
            <button class="dbtn" data-n="copy">复制链接</button>
            <button class="dbtn" data-n="home">返回主页</button>
          </div>
        </div>
        <div class="br-fallback"><div>这个站点拒绝被嵌入（X-Frame-Options / CSP）。<br><br>
          <button class="btn primary" data-a="ext">在新标签打开</button></div></div>
      </div>
    </div>`;
    this.tabsEl = $('.br-tabs', this.el);
    this.addr = $('.br-addr input', this.el);
    this.frame = $('iframe', this.el);
    this.frameEl = $('.br-frame', this.el);
    this.noticeEl = $('#brNotice', this.el);
    this.noticeTitle = $('#brNoticeTitle', this.el);
    this.noticeText = $('#brNoticeText', this.el);
    this.notice = null;

    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    $$('[data-n]', this.el).forEach(b => b.onclick = () => this._noticeAct(b.dataset.n));
    this.addr.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.act('go'); }
    });
    this.frame.addEventListener('load', () => {
      try {
        const t = this.frame.contentDocument && this.frame.contentDocument.title;
        if (t) this.setTab(this.active, { title:t });
      } catch (e) {}
      this._hardenFrame();
    });
    this._msg = (e) => {
      if (!e.data) return;
      if (e.data.htNav && (e.source === this.frame.contentWindow || e.data.htTok === this._tok)) this.navigate(e.data.htNav);
      // 同源注入的脚本抓到外部协议时，转成面板，而不是让 iframe 去撞 ERR_UNKNOWN_URL_SCHEME
      if (e.data.htExternal && (e.source === this.frame.contentWindow || e.data.htTok === this._tok)) {
        this.showNotice(e.data.htExternal.kind || 'external', e.data.htExternal);
      }
      /* 同源页调 window.open / target=_blank：在内部开新标签，不去碰真浏览器 */
      if (e.data.htNewTab && (e.source === this.frame.contentWindow || e.data.htTok === this._tok)) {
        this.addTab(String(e.data.htNewTab));
      }
    };
    window.addEventListener('message', this._msg);
    this._bindDrop();

    /* 智能体经常直接给一段 HTML（content），而不是 URL。
     * 以前这里只认 url，于是「打开 HTML」变成打开一个空白页，看起来像坏了。 */
    this.addTab(this.opts.url || '', this.opts.html || '');
  }

  act(a) {
    if (a === 'back') this.step(-1);
    else if (a === 'fwd') this.step(1);
    else if (a === 'reload') this.reload();
    else if (a === 'home') this.navigate('');
    else if (a === 'go') this.navigate(this.addr.value);
    else if (a === 'ext') {
      const u = this.current() && this.current().url;
      if (!u) return;
      const c = classifyUrl(u);
      if (c.kind === 'external') this.showNotice('external', c);
      else window.open(u, '_blank', 'noopener');
    }
    else if (a === 'new') this.addTab('');
    else if (a === 'save') this.saveToFs();
    else if (a === 'download') this.downloadPage();
  }

  /* ---------------------------------------------------------------- 保存网页
   * 两条出路，都是一键：
   *   保存 → 进 spotfs 的 .home（之后可以在文件管理器里拖出去，或 cat 出来看）
   *   下载 → 直接落本机磁盘
   * 跨域 iframe 的 DOM 读不到，这是浏览器安全模型，不是 bug；
   * 这种情况保存的是「跳转页」（带原地址的链接），不假装保存成功。
   */
  pageHtml() {
    try {
      const d = this.frame.contentDocument;
      if (d && d.documentElement) {
        const h = d.documentElement.outerHTML;
        if (h && h.length > 40) return '<!DOCTYPE html>\n' + h;
      }
    } catch (e) {}
    const t = this.current();
    return (t && t.html) ? String(t.html) : null;
  }
  _pageName() {
    const t = this.current() || {};
    let n = String(t.title || '').trim();
    if (!n || /^(新标签|about:blank)$/i.test(n)) {
      n = String(t.url || '').replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '') || 'page';
    }
    return n.replace(/[/\\:*?"<>|]+/g, '-').slice(0, 60) || 'page';
  }
  _fallbackHtml() {
    const t = this.current() || {};
    const u = t.url || '';
    return '<!DOCTYPE html>\n<meta charset="utf-8"><title>' + esc(this._pageName()) + '</title>\n'
      + '<p>这个页面跨域，读不到 DOM，只保存了地址：</p>\n'
      + '<p><a href="' + esc(u) + '" target="_blank">' + esc(u) + '</a></p>\n';
  }
  async saveToFs() {
    const name = this._pageName();
    const html = this.pageHtml();
    const cross = !html;
    try {
      const p = uniquePathIn('.home', spotEscape(htmlFileName(name)));
      await FS.write(p, cross ? this._fallbackHtml() : html, { mime:'text/html;charset=utf-8', hint:name, origin:'browser' });
      toast(cross ? '跨域页面读不到内容，已保存跳转页 → ' + p : '已保存到 ' + p);
    } catch (e) { toast('保存失败：' + (e && e.message || e), true); }
  }
  downloadPage() {
    const name = this._pageName();
    const html = this.pageHtml();
    if (!html) { toast('跨域页面读不到内容，下载不了；可以先「保存」成跳转页', true); return; }
    saveFileRaw(spotExportName(htmlFileName(name)), html, 'text/html;charset=utf-8');
  }

  /* 把 spotfs 里的一个节点在浏览器里打开：html/text 直接渲染，图片按图片显示，
   * 其它二进制交给编辑器窗口——比在这里显示一堆乱码有用。 */
  async openPath(p) {
    const st = await FS.stat(p);
    if (!st) { toast('文件不存在：' + p, true); return false; }
    if (st.kind === 'dir') { toast('目录不能在浏览器里打开', true); return false; }
    const r = await FS.read(p);
    const mime = (r.meta && r.meta.mime) || '';
    const nm = spotExportName(baseName(p));
    const isText = typeof r.content === 'string';
    if (isText) {
      const txt = String(r.content);
      if (/html?$/i.test(mime) || /\.html?$/i.test(nm)) { this.loadHtml(txt, nm); return true; }
      this.loadHtml('<!DOCTYPE html><meta charset="utf-8"><title>' + esc(nm) + '</title>'
        + '<pre style="font:12px/1.7 ui-monospace,monospace;padding:18px;white-space:pre-wrap;word-break:break-word">'
        + esc(txt) + '</pre>', nm);
      return true;
    }
    if (/^image\//i.test(mime)) {
      const url = await contentToDataUrl(r.content, mime);
      this.loadHtml('<!DOCTYPE html><meta charset="utf-8"><title>' + esc(nm) + '</title>'
        + '<body style="margin:0;background:#111;display:grid;place-items:center;height:100vh">'
        + '<img src="' + url + '" style="max-width:100%;max-height:100%">', nm);
      return true;
    }
    /* 其它二进制：浏览器里看不了，交给编辑器（PDF 之类浏览器其实能显示，但这里
     * 没有 blob URL 的生命周期管理，先不做）。 */
    WindowManager.open({ type:'editor', path:p, title:nm });
    toast('这个类型浏览器不能直接看，已用编辑器打开');
    return false;
  }

  /* 拖进浏览器窗口 = 打开它（文件管理器里的文件、别的浏览器标签都算） */
  _bindDrop() {
    const box = this.frameEl;
    if (!box) return;
    box.addEventListener('dragover', (e) => {
      if (!hasInternalDrag(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
      box.dataset.drop = '在浏览器里打开';
      box.classList.add('drop');
    });
    box.addEventListener('dragleave', (e) => {
      if (!box.contains(e.relatedTarget)) box.classList.remove('drop');
    });
    box.addEventListener('drop', async (e) => {
      const items = DragBus.read(e.dataTransfer);
      if (!items || !items.length) return;
      e.preventDefault();
      e.__htDropHandled = true;
      box.classList.remove('drop');
      const it = items[0];
      try {
        if (it.kind === 'page') this.loadHtml(it.html || this._fallbackHtmlFor(it), it.name || 'page');
        else await this.openPath(it.path);
      } catch (err) { toast('打开失败：' + (err && err.message || err), true); }
      DragBus.clear();
    });
  }
  _fallbackHtmlFor(it) {
    return '<!DOCTYPE html>\n<meta charset="utf-8"><title>' + esc(it.name || 'page') + '</title>\n'
      + '<p>这个标签页跨域，读不到内容。</p>\n<p><a href="' + esc(it.url || '') + '" target="_blank">' + esc(it.url || '') + '</a></p>\n';
  }

  /* —— 非网页协议：不交给 iframe，给出明确出路 —— */
  showNotice(kind, c) {
    this.notice = { kind, ...c };
    if (!this.noticeEl) return;
    const external = kind === 'external';
    this.noticeTitle.textContent = external ? '这个链接需要外部应用' : '这个地址不能在窗口里打开';
    this.noticeText.textContent = external
      ? `「${c.scheme || '未知'}」不是网页协议。浏览器内核不会在 iframe 里处理它，强行加载只会得到 ERR_UNKNOWN_URL_SCHEME。可以复制链接，或用系统里的应用打开。`
      : (c.reason || '浏览器安全策略禁止把这个地址嵌入 iframe。');
    $('[data-n="open"]', this.noticeEl).hidden = !external;
    this.noticeEl.hidden = false;
    this.frameEl.classList.add('has-notice');
  }
  hideNotice() {
    this.notice = null;
    if (this.noticeEl) this.noticeEl.hidden = true;
    this.frameEl.classList.remove('has-notice');
  }
  _noticeAct(n) {
    const c = this.notice;
    if (n === 'home') { this.hideNotice(); this.loadHome(); return; }
    if (!c) return;
    if (n === 'copy') {
      const t = c.url || '';
      try { navigator.clipboard.writeText(t); toast('链接已复制'); } catch (e) { toast('复制失败，请手动选择', true); }
      return;
    }
    if (n === 'open' && c.kind === 'external') {
      // 只允许用户手势里主动跳转，避免页面自己把用户踢到外部应用
      try { location.href = c.url; } catch (e) { toast('系统没有能打开它的应用', true); }
    }
  }

  /* —— 同源页面注入：拦住 <a href="mailto:…"> 与 window.open ——
   * 跨域 iframe 的 DOM 读不到，这是浏览器安全模型决定的；
   * 对能读到的（我们的 srcdoc 首页等）就把协议在点击阶段截下来，
   * 让用户看到面板而不是白屏。 */
  _hardenFrame() {
    let doc = null;
    try { doc = this.frame.contentDocument; } catch (e) { return; }
    if (!doc || doc.__htHardened) return;
    doc.__htHardened = true;
    /* targetOrigin 必须用 '*'：srcdoc + sandbox 的 iframe 是 opaque origin，
     * origin 字符串是 "null"，用 location.origin 当 targetOrigin 会被浏览器直接丢弃，
     * 表现就是「点了 mailto 什么都不发生」。
     * 校验也不靠 e.source —— iframe 一旦导航，contentWindow 会换成新的 WindowProxy，
     * 拿旧引用比 strict equal 永远为 false。改用每个窗口一份随机串 htTok。 */
    const tok = this._tok || (this._tok = Math.random().toString(36).slice(2, 10));
    /* 同源可控时**根本不用 postMessage**：回调就在父窗口的 realm 里跑，
     * 闭包里的 this 就是 BrowserApp，直接调方法最可靠（无异步、无丢消息）。 */
    const handle = (u) => {
      const c = classifyUrl(u);
      if (c.kind === 'external' || c.kind === 'blocked') {
        this.showNotice(c.kind === 'external' ? 'external' : c.kind, c);
        return true;
      }
      return false;
    };
    doc.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (handle(href)) { e.preventDefault(); e.stopPropagation(); return; }

      /* target=_blank：优先在**这个小浏览器里**开新标签页。
       * 只有同源页面能拦到（跨域 DOM 读不到），跨域的交给浏览器自己处理——
       * 也就是「尽量内部打开，实在不行才外部」，正是想要的行为。 */
      const target = (a.getAttribute('target') || '').toLowerCase();
      if (target === '_blank' || target === '_new') {
        e.preventDefault();
        e.stopPropagation();
        this.addTab(href.startsWith('#') ? (this.current() && this.current().url) || '' : href);
      }
    }, true);

    /* 页面自己写 window.open 的，同样先转内部新标签 */
    try {
      const w = doc.defaultView;
      if (w && !w.__htOpenPatched) {
        w.__htOpenPatched = true;
        const orig = w.open;
        const self = this;
        w.open = function (u, ...rest) {
          const target = u == null ? '' : String(u);
          if (!target) return null;
          if (handle(target)) return null;
          /* 闭包在父窗口里，self 就是那个 BrowserApp：直接开内部标签 */
          try { self.addTab(target); return null; }
          catch (e) { try { (window.parent || window).postMessage({ htNewTab: target, htTok: tok }, '*'); return null; } catch (e2) { return orig.call(w, target, ...rest); } }
        };
      }
    } catch (e) {}
  }

  current() { return this.tabs[this.active] || null; }

  addTab(url, html) {
    const t = { url:'', title:'新标签', hist:[], idx:-1, html:'' };
    this.tabs.push(t);
    this.active = this.tabs.length - 1;
    this.renderTabs();
    if (html) this.loadHtml(html, this.opts.title || '');
    else if (url) this.navigate(url, true);
    else { this.loadHome(); this.setAddr(''); }
    this.renderTabs();
  }

  /* 直接渲染一段 HTML（srcdoc）。地址栏留空，标签标题取 <title> 或传入的 title。
   * 用 srcdoc 而不是 blob:/data: —— 后者在部分内核里会触发 URL scheme 相关的拦截。 */
  loadHtml(html, title) {
    this.hideNotice();
    this.frame.removeAttribute('src');
    this.frame.srcdoc = String(html || '');
    this.frameEl.classList.remove('blocked');
    const t = this.current();
    if (t) {
      t.url = '';
      t.html = String(html || '');
      t.title = title || 'HTML';
    }
    this.setAddr('');
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
      /* 标签页可以拖出去：拖到文件管理器 = 存成 .html；拖到智能体 = 当附件；
       * 拖到终端 = 粘贴地址。只有当前标签知道自己的 DOM（其它标签的 iframe 已经不在）。 */
      const i = Number(b.dataset.tab);
      b.draggable = true;
      b.addEventListener('dragstart', (e) => {
        const t = this.tabs[i] || {};
        const html = (i === this.active) ? this.pageHtml() : null;
        DragBus.write(e.dataTransfer, [{
          kind:'page', name:t.title || 'page', url:t.url || '', html
        }], t.url || t.title || '');
      });
      b.addEventListener('dragend', () => DragBus.clear());
    });
  }
  setAddr(u) { if (this.addr && document.activeElement !== this.addr) this.addr.value = u === 'about:blank' ? '' : (u || ''); }

  loadHome() {
    this.hideNotice();
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
    const t = this.current();
    if (!t) return;
    const c = classifyUrl(input);

    if (c.kind === 'blank') { this.loadHome(); return; }
    if (c.kind === 'search') {
      return this.navigate('https://cn.bing.com/search?q=' + encodeURIComponent(c.q), push);
    }
    // 外部协议 / 被禁地址：**绝不写进 iframe.src**，这就是不再出现
    // ERR_UNKNOWN_URL_SCHEME 的根本原因。改为展示面板让用户选出路。
    if (c.kind === 'external' || c.kind === 'blocked') {
      this.showNotice(c.kind, c);
      this.setAddr(c.url || input);
      return;
    }

    const url = c.url;
    this.hideNotice();
    t.url = url;
    t.title = url.replace(/^(https?|data|blob):/, '').split('/')[0] || url;
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
    this.hideNotice();
    this.frame.removeAttribute('srcdoc');
    this.frame.src = url;
    this.setAddr(url);
    this.renderTabs();
  }
  reload() {
    const t = this.current();
    if (!t) return;
    if (!t.url) { this.loadHome(); return; }
    this.hideNotice();
    try { this.frame.contentWindow.location.reload(); }
    catch (e) {
      // 跨域读不到 contentWindow：先清空再设回，强制一次真正的重载
      this.frame.removeAttribute('srcdoc');
      this.frame.src = 'about:blank';
      setTimeout(() => { this.frame.src = t.url; }, 0);
    }
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
    this._blobs = new Map();   // path -> {url, name, mime}，拖出去时用
    this.el.innerHTML = `<div class="fm">
      <div class="fm-bar">
        <button class="btn" data-a="up" title="上级">↑</button>
        <button class="btn" data-a="home" title="家目录">⌂</button>
        <div class="fm-path"></div>
        <button class="btn" data-a="refresh" title="刷新">⟳</button>
        <button class="btn" data-a="newfile" title="新建文件">＋</button>
        <button class="btn" data-a="newdir" title="新建目录">+dir</button>
        <button class="btn" data-a="newwin" title="再开一个文件管理器（同一个目录，方便拖来拖去）">⧉</button>
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
    this._bindDrop();
    this.load();
  }

  /* 把东西拖进文件管理器 = 落进它当前目录。
   * 两种来源：
   *   外部文件（OS）   → importFiles（转义成 spotfs 名字）
   *   窗口间拖拽       → dropIntoDir（复制 / Shift 移动），支持目录整棵树
   */
  _bindDrop() {
    const root = $('.fm', this.el);
    if (!root) return;
    root.__app = this;
    const label = (move) => (move ? '移动到 ' : '复制到 ') + this.path;
    root.addEventListener('dragover', (e) => {
      const internal = hasInternalDrag(e);
      if (!internal && !_hasFiles(e)) return;
      e.preventDefault();
      const move = internal && !!e.shiftKey;
      try { e.dataTransfer.dropEffect = move ? 'move' : 'copy'; } catch (err) {}
      root.dataset.drop = label(move);
      root.classList.add('drop');
    });
    root.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget)) root.classList.remove('drop');
    });
    root.addEventListener('drop', async (e) => {
      const items = DragBus.read(e.dataTransfer);
      if (items && items.length) {
        e.preventDefault();
        e.__htDropHandled = true;
        root.classList.remove('drop');
        const move = !!e.shiftKey;
        try {
          const r = await dropIntoDir(items, this.path, { move });
          const n = r.copied.length + r.moved.length;
          if (n) toast((move ? '已移动 ' : '已复制 ') + n + ' 项到 ' + this.path);
          else if (r.skipped.length) toast('没有可放的东西（同目录或拖进了自己里面）', true);
          DragBus.clear();
          await this.load();
        } catch (err) { toast('拖拽失败：' + (err && err.message || err), true); }
        return;
      }
      if (!_hasFiles(e)) return;
      e.preventDefault();
      e.__htDropHandled = true;      // 告诉全局：这个 drop 已经有人收
      root.classList.remove('drop');
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      if (!files.length) return;
      try {
        const paths = await importFiles(files, this.path);
        toast('已导入 ' + paths.length + ' 个文件到 ' + this.path);
        await this.load();
      } catch (err) { toast('导入失败：' + (err && err.message || err), true); }
    });
  }

  /* 拖出去：dragstart 必须同步 setData，所以在 pointerdown 时就把内容读成 Blob URL 备好。
   * Chrome 认 DownloadURL=mime:filename:url —— 拖到桌面/资源管理器即落盘。 */
  async _prefetchBlob(p) {
    if (this._blobs.has(p)) return;
    try {
      const st = await FS.stat(p);
      if (!st || st.kind === 'dir') return;
      const r = await FS.read(p);
      let blob;
      if (r.content instanceof Blob) blob = r.content;
      else if (r.content instanceof ArrayBuffer) blob = new Blob([r.content], { type:(r.meta && r.meta.mime) || 'application/octet-stream' });
      else blob = new Blob([String(r.content == null ? '' : r.content)], { type:(r.meta && r.meta.mime) || 'text/plain' });
      const url = URL.createObjectURL(blob);
      this._blobs.set(p, { url, name:spotExportName(baseName(p)), mime:blob.type || 'application/octet-stream' });
    } catch (e) {}
  }
  async act(a) {
    try {
      if (a === 'up') { this.path = parentPath(this.path); await this.load(); }
      else if (a === 'home') { this.path = '.home'; await this.load(); }
      else if (a === 'refresh') await this.load();
      else if (a === 'newfile') await this.newEntry(false);
      else if (a === 'newdir') await this.newEntry(true);
      else if (a === 'newwin') {
        /* 同一个目录再开一个窗口：拖来拖去时最有用的是「两个窗口并排」。 */
        const w = WindowManager.open({ type:'files', path:this.path, title:'文件 · ' + this.path });
        return w;
      }
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
      const p = row.dataset.p;
      row.draggable = true;
      /* pointerdown 是 dragstart 之前唯一能安全预读的时机 */
      row.addEventListener('pointerdown', () => { this._prefetchBlob(p); });
      row.addEventListener('dragstart', (e) => {
        row.classList.add('dragging');
        const c = this._blobs.get(p);
        /* 同文档窗口之间靠这个 item 传递：路径 + 存储名。
         * 外部应用靠 DownloadURL（下面那行），两者互不影响。 */
        DragBus.write(e.dataTransfer, [{
          kind:'spot', path:p, name:baseName(p),
          display:spotExportName(baseName(p)),
          mime:(c && c.mime) || ''
        }], p, 'copyMove');
        if (c) {
          try { e.dataTransfer.setData('DownloadURL', c.mime + ':' + c.name + ':' + c.url); } catch (err) {}
        }
      });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); DragBus.clear(); });
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
    const paths = await importFiles(files, this.path);
    toast('已上传 ' + paths.length + ' 个文件');
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
    await saveFileRaw(spotExportName(baseName(this.sel)), r.content, r.meta && r.meta.mime);
  }
  dispose() {
    this._off && this._off();
    for (const c of this._blobs.values()) { try { URL.revokeObjectURL(c.url); } catch (e) {} }
    this._blobs.clear();
  }
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
