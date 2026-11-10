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
      await Spot.write(p, cross ? this._fallbackHtml() : html, { mime:'text/html;charset=utf-8', type:'page', hint:name, origin:'browser' });
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

/* ---------------------------------------------------------------- 文件管理器
 * 这一版把「能不能做」这件事交给 spotfs 的能力表（`Spot.caps`）：
 *   按钮会置灰、右键菜单会置灰，理由写在 title 里；
 *   双击不再靠后缀猜，先看元数据、再看魔数（`Spot.openSmart`）。
 * 所有文件操作走 `Spot.*`（也就是 spt*），不直接 FS.write ——
 * queryfile 读一次就没了、savefile 写完就落盘，这些语义只有 spt* 认。
 */
class FilesApp {
  constructor(container, opts) {
    this.el = container;
    this.path = normPath((opts && opts.path) || '.home');
    this.sel = null;
    this.clip = null;            // { path, cut:false }
    this.preview = true;
    this._blobs = new Map();
    this.el.innerHTML = `<div class="fm">
      <div class="fm-bar">
        <button class="btn" data-a="up" title="上级">↑</button>
        <button class="btn" data-a="home" title="家目录">⌂</button>
        <div class="fm-path"></div>
        <button class="btn" data-a="refresh" title="刷新">⟳</button>
        <button class="btn" data-a="newfile" title="新建文件（只建，不写）">＋</button>
        <button class="btn" data-a="newdir" title="新建目录">+dir</button>
        <button class="btn" data-a="newwin" title="同一个目录再开一个窗口">⧉</button>
        <button class="btn" data-a="paste" title="粘贴" disabled>粘贴</button>
        <button class="btn" data-a="edit" title="编辑（r/w）">编辑</button>
        <button class="btn" data-a="run" title="执行（x）">执行</button>
        <button class="btn" data-a="upload" title="上传">⇧</button>
        <button class="btn danger" data-a="del" title="删除（d）">✕</button>
        <button class="btn" data-a="preview" title="显示 / 隐藏预览栏">▤</button>
      </div>
      <div class="fm-list"></div>
      <div class="fm-prev">选择文件查看内容</div>
    </div>`;
    this.pathEl = $('.fm-path', this.el);
    this.listEl = $('.fm-list', this.el);
    this.prevEl = $('.fm-prev', this.el);
    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this._off = EventBus.on('fs', () => { if (document.contains(this.el)) this.load(); });
    /* 菜单的「点外面关」必须绑定到实例：document 上的监听里 this 是 document */
    this._ctxOutB = (e) => { if (this._ctx && !this._ctx.contains(e.target)) this._ctxClose(); };
    this._ctxEscB = (e) => { if (e.key === 'Escape') this._ctxClose(); };
    this._bindList();
    this._bindDrop();
    this.load();
  }

  /* ---------------------------------------------------------------- 列表交互
   * 一个 pointerdown 决定三件事：短按 = 选中、长按 = 上下文菜单、拖过 8px = 拖拽。
   * 用指针事件而不是 dblclick：列表每次 fs 变化都会重建，绑在行上的 dblclick
   * 很容易在「第一下点击之后的一次刷新」里丢掉——这就是「双击很难打开」。
   */
  _bindList() {
    this._lastClick = { p:'', t:0 };
    let press = null;

    const rowOf = (e) => e.target.closest && e.target.closest('.fm-row');

    this.listEl.addEventListener('pointerdown', (e) => {
      const row = rowOf(e);
      if (!row) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press = { p:row.dataset.p, x:e.clientX, y:e.clientY, t:Date.now(), moved:false, timer:0 };
      press.timer = setTimeout(() => {
        if (!press || press.moved) return;
        press.fired = true;
        this.select(press.p);
        if (press.p) this.select(press.p);
        this.ctxMenu(press.p, e.clientX, e.clientY);
      }, 520);
      this._prefetchBlob(row.dataset.p);
    });

    this.listEl.addEventListener('pointermove', (e) => {
      if (!press) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
        press.moved = true;
        clearTimeout(press.timer);
      }
    });

    const up = (e) => {
      if (!press) return;
      clearTimeout(press.timer);
      const p = press.p, moved = press.moved, fired = press.fired;
      press = null;
      if (moved || fired) return;
      const now = Date.now();
      this.select(p);
      /* 双击判定沿用「自己数两下」，420ms 窗口；不依赖原生 dblclick */
      if (this._lastClick.p === p && now - this._lastClick.t < 420) {
        this._lastClick = { p:'', t:0 };
        this.open(p);
      } else {
        this._lastClick = { p, t: now };
      }
    };
    this.listEl.addEventListener('pointerup', up);
    this.listEl.addEventListener('pointercancel', () => { if (press) { clearTimeout(press.timer); press = null; } });

    this.listEl.addEventListener('contextmenu', (e) => {
      const row = rowOf(e);
      if (!row) return;
      e.preventDefault();
      this.select(row.dataset.p);
      /* 右键也顺手选中：不然右边预览栏空着，菜单里的「编辑 / 执行」说的是谁不明确 */
      if (row.dataset.p) this.select(row.dataset.p);
      this.ctxMenu(row.dataset.p, e.clientX, e.clientY);
    });
    /* 空白处右键 = 目录菜单（新建/粘贴/刷新） */
    this.listEl.addEventListener('contextmenu', (e) => {
      if (rowOf(e)) return;
      e.preventDefault();
      this.ctxMenu(null, e.clientX, e.clientY);
    });
    this.listEl.addEventListener('keydown', (e) => {
      if (!this.sel) return;
      if (e.key === 'Enter') { e.preventDefault(); e.ctrlKey || e.metaKey ? this.run(this.sel) : this.open(this.sel); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.del(); }
      else if (e.key === 'F2') { e.preventDefault(); this.rename(); }
    });
  }

  /* ---------------------------------------------------------------- 右键 / 长按菜单 */
  ctxMenu(p, x, y) {
    this._ctxClose();
    const m = document.createElement('div');
    m.className = 'winmenu fmctx';
    const row = p ? this._rowInfo(p) : null;
    const c = p ? Spot.caps(p) : Spot.caps(this.path);
    const item = (cmd, label, hint, ok, why) =>
      `<button class="stack${ok ? '' : ' is-off'}" data-cmd="${cmd}" ${ok ? '' : 'disabled title="' + esc(why || '这个操作对它是没有意义的') + '"'}>
        <span>${esc(label)}</span><em>${esc(hint || '')}</em></button>`;
    let html;
    if (!p) {
      html = `<div class="winmenu__title">${esc(spotExportName(baseName(this.path)))} · 目录</div>
        ${item('newfile', '新建文件', '只建空节点，内容另写', c.mk, c.why)}
        ${item('newdir', '新建目录', '', c.mk, c.why)}
        <div class="winmenu__sep"></div>
        ${item('paste', '粘贴到这里', this.clip ? spotExportName(baseName(this.clip.path)) : '剪贴板是空的', !!this.clip, '先复制一个过来')}
        ${item('refresh', '刷新', '', true)}`;
    } else {
      const type = Spot.typeOf(row.st);
      const name = spotExportName(baseName(p));
      html = `<div class="winmenu__title">${esc(name)} · ${esc(type)}</div>
        ${type === 'dir'
          ? item('open', '进入', '目录的执行就是「进去」', c.x, c.why)
          : item('edit', '编辑', '文本 / 代码 / 页面', c.r, c.why)}
        ${item('run', '执行', 'x：脚本跑起来、页面开浏览器、授权发申请', c.x, c.why)}
        <div class="winmenu__sep"></div>
        ${item('copy', '复制', 'Ctrl+C', c.r, c.why)}
        ${item('cut', '剪切', 'Ctrl+X', c.r && c.d, c.why)}
        ${item('rename', '重命名', 'F2', c.w, c.why)}
        ${item('download', '下载到本机', '', c.r && type !== 'dir', c.why)}
        <div class="winmenu__sep"></div>
        ${item('meta', '属性 / 元数据', '类型、时间、只读、扩展', true)}
        ${item('del', '删除', 'd', c.d, c.why)}`;
    }
    m.innerHTML = html;
    document.body.appendChild(m);
    m.style.left = '0px'; m.style.top = '0px';
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.round(Math.min(x, innerWidth - mw - 8)) + 'px';
    m.style.top = Math.round(Math.min(y, innerHeight - mh - 8)) + 'px';
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b || b.disabled) return;
      const cmd = b.dataset.cmd;
      this._ctxClose();
      if (cmd === 'open') this.open(p);
      else if (cmd === 'edit') this.run(p, 'edit');
      else if (cmd === 'run') this.run(p, 'exec');
      else if (cmd === 'copy') { this.clip = { path:p, cut:false }; this._syncBar(); toast('已复制 ' + spotExportName(baseName(p))); }
      else if (cmd === 'cut') { this.clip = { path:p, cut:true }; this._syncBar(); toast('已剪切 ' + spotExportName(baseName(p))); }
      else if (cmd === 'rename') this.rename(p);
      else if (cmd === 'download') { this.sel = p; this.download(); }
      else if (cmd === 'meta') this.showMeta(p);
      else if (cmd === 'del') { this.sel = p; this.del(); }
      else if (cmd === 'newfile') this.newEntry(false);
      else if (cmd === 'newdir') this.newEntry(true);
      else if (cmd === 'paste') this.paste();
      else if (cmd === 'refresh') this.load();
    });
    this._ctx = m;
    setTimeout(() => {
      document.addEventListener('pointerdown', this._ctxOutB, true);
      document.addEventListener('keydown', this._ctxEscB, true);
    }, 0);
  }
  _ctxClose() {
    if (!this._ctx) return;
    this._ctx.remove();
    this._ctx = null;
    document.removeEventListener('pointerdown', this._ctxOutB, true);
    document.removeEventListener('keydown', this._ctxEscB, true);
  }

  _rowInfo(p) {
    const row = this._rows && this._rows.find(r => r.path === p);
    return row || { path:p, name:baseName(p), kind:'file', st:{} };
  }

  /* 把东西拖进文件管理器 = 落进它当前目录。 */
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
      e.__htDropHandled = true;
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
      else if (a === 'newwin') return WindowManager.open({ type:'files', path:this.path, title:'文件 · ' + this.path });
      else if (a === 'edit') await this.editSel();
      else if (a === 'run') await this.run(this.sel);
      else if (a === 'paste') await this.paste();
      else if (a === 'upload') await this.upload();
      else if (a === 'del') await this.del();
      else if (a === 'preview') {
        this.preview = !this.preview;
        this.el.querySelector('.fm').classList.toggle('pv-off', !this.preview);
        if (this.preview && this.sel) this.select(this.sel);
      }
    } catch (e) { toast(e.message || String(e), true); }
  }

  async load() {
    this.pathEl.textContent = this.path;
    this.pathEl.title = this.path;
    if (this.sel && parentPath(this.sel) !== this.path) this.sel = '';
    let rows = [];
    try { rows = await Spot.list(this.path); } catch (e) { rows = []; }
    this._rows = rows;
    const c = Spot.caps(this.path);
    if (!rows.length) {
      /* 空目录也要能「有东西可点」：给一行说明 + 两个入口，
       * 否则用户只能靠工具栏，而工具栏那会儿还分不清自己该点哪个。 */
      this.listEl.innerHTML = `<div class="fm-empty">${c.mk ? '空目录 · 右键新建，或用上面的 ＋ / +dir' : '空目录（这里不让你新建：' + esc(c.why || '只读') + '）'}</div>`;
      this._syncBar();
      return;
    }
    const mark = (st, p) => {
      const k = Spot.caps(p);
      const dot = (on, ch) => `<i class="pdot${on ? ' on' : ''}" title="${ch}">${ch}</i>`;
      return dot(k.r, 'r') + dot(k.w, 'w') + dot(k.x, 'x') + (st.kind !== 'dir' ? dot(k.d, 'd') : '');
    };
    this.listEl.innerHTML = rows.map(r => {
      const st = { kind:r.kind, meta:r.meta, size:r.size, mtime:r.mtime };
      const type = Spot.typeOf(st);
      const icon = r.kind === 'dir' ? '▸' : type === 'code' ? 'λ' : type === 'page' ? '◫' : type === 'image' ? '▩'
        : r.kind === 'app' ? 'a' : r.kind === 'device' ? 'v' : r.kind === 'package' ? 'p'
        : r.kind === 'grant' ? '!' : r.kind === 'proc' ? '&' : '·';
      const color = r.kind === 'dir' ? 'var(--accent)' : type === 'code' ? 'var(--amber)' : type === 'image' ? 'var(--blue)' : 'var(--fg-mute)';
      return `<div class="fm-row" data-p="${esc(r.path)}" tabindex="-1" draggable="true">
        <span class="ico" style="font-family:var(--mono);color:${color}">${icon}</span>
        <span class="nm" style="${r.kind === 'dir' ? 'color:var(--accent)' : ''}" title="${esc(r.name)}">${esc(spotExportName(r.name))}${r.kind === 'dir' ? '.' : ''}</span>
        <span class="perm">${mark(st, r.path)}</span>
        <span class="kd">${esc(type)}</span>
        <span class="sz">${r.kind === 'dir' ? '' : fmtBytes(r.size)}</span>
      </div>`;
    }).join('');
    $$('.fm-row', this.listEl).forEach(row => {
      const p = row.dataset.p;
      row.addEventListener('dragstart', (e) => {
        row.classList.add('dragging');
        this._lastClick = { p:'', t:0 };
        const c2 = this._blobs.get(p);
        DragBus.write(e.dataTransfer, [{
          kind:'spot', path:p, name:baseName(p),
          display:spotExportName(baseName(p)),
          mime:(c2 && c2.mime) || ''
        }], p, 'copyMove');
        if (c2) { try { e.dataTransfer.setData('DownloadURL', c2.mime + ':' + c2.name + ':' + c2.url); } catch (err) {} }
      });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); DragBus.clear(); });
    });
    this._syncBar();
    this.paintSel();
  }

  _syncBar() {
    const sel = this.sel;
    const c = sel ? Spot.caps(sel) : null;
    const set = (a, on, why) => {
      const b = $(`[data-a="${a}"]`, this.el);
      if (!b) return;
      b.disabled = !on;
      b.title = why || b.title;
    };
    /* 「编辑」= 可写（w），不是「可读」：只读区域（.doc / .queryfile）用预览看，
     * 真要改就得先复制到 .home。见 README「能力表」。 */
    set('edit', !!sel && c.w, '编辑内容（需要 w）');
    set('run', !!sel && c.x, '执行（需要 x）');
    set('del', !!sel && c.d, '删除（需要 d）');
    set('paste', !!this.clip, '粘贴');
  }

  paintSel() {
    $$('.fm-row', this.listEl).forEach(r => {
      r.style.background = r.dataset.p && r.dataset.p === this.sel ? 'rgba(94,234,212,.08)' : '';
    });
  }

  async select(p) {
    this.sel = p;
    this.paintSel();
    this._syncBar();
    if (!this.preview) return;
    try {
      const st = await Spot.stat(p);
      if (!st) return;
      const type = Spot.typeOf(st);
      if (st.kind === 'dir') {
        const rows = await Spot.list(p);
        const c = Spot.caps(p);
        this.prevEl.textContent = '目录 ' + p + '\n' + rows.length + ' 项\n\n' +
          '能力：' + ['r','w','x','d','mk'].filter(k => c[k]).join(' ') + (c.why ? '\n原因：' + c.why : '');
        return;
      }
      if (st.kind === 'app' || st.kind === 'device' || st.kind === 'grant' || st.kind === 'proc' || st.kind === 'package') {
        this.prevEl.textContent = JSON.stringify(st.meta, null, 2);
        return;
      }
      if (parentPath(p) === '.queryfile') {
        this.prevEl.textContent = '用户交进来的文件（' + type + '，' + fmtBytes(st.size) + '）\n\n' +
          '它是**一次性的**：真正读一次之后节点就永久消失。\n双击 / 执行会消费它；这里只显示摘要，不读内容。';
        return;
      }
      /* 预览用 peek：queryfile 的「看一眼」不能算消费 */
      const r = await Spot.peek(p);
      const mime = (r.meta && r.meta.mime) || '';
      if (/^image\//i.test(mime) || type === 'image') {
        const url = await contentToDataUrl(r.content, mime);
        this.prevEl.textContent = '';
        const img = new Image();
        img.alt = spotExportName(baseName(p));
        img.style.cssText = 'display:block;margin:0 auto;max-width:100%;max-height:calc(100% - 22px);border-radius:6px';
        img.src = url;
        const cap = document.createElement('div');
        cap.className = 'fm-imgcap';
        cap.textContent = spotExportName(baseName(p)) + ' · ' + fmtBytes(st.size);
        img.onload = () => { cap.textContent = spotExportName(baseName(p)) + ' · ' + img.naturalWidth + '×' + img.naturalHeight + ' · ' + fmtBytes(st.size); };
        this.prevEl.appendChild(img);
        this.prevEl.appendChild(cap);
        return;
      }
      let cc = r.content;
      if (cc instanceof ArrayBuffer || cc instanceof Blob) { this.prevEl.textContent = '[二进制] ' + fmtBytes(cc.size || cc.byteLength || 0); return; }
      cc = String(cc == null ? '' : cc);
      this.prevEl.textContent = cc.slice(0, 6000) + (cc.length > 6000 ? '\n…（已截断）' : '');
    } catch (e) { this.prevEl.textContent = '读取失败：' + e.message; }
  }

  /* 双击：能执行就执行，否则按类型打开，最后才是属性。 */
  async open(p) {
    const now = Date.now();
    if (this._opened && this._opened.p === p && now - this._opened.t < 500) return;
    this._opened = { p, t: now };
    let st;
    try { st = await Spot.stat(p); } catch (e) { return; }
    if (!st) return;
    if (st.kind === 'dir') { this.path = p; await this.load(); return; }
    try {
      const r = await Spot.openSmart(p);
      if (r.how === 'meta') this.showMeta(p);
      else if (r.how === 'exec' && p.startsWith('.perm.')) toast('已向浏览器申请「' + baseName(p) + '」');
    } catch (e) { toast(e.message || String(e), true); }
  }
  async editSel() {
    if (!this.sel) { toast('先在列表里选一个文件'); return; }
    this.run(this.sel, 'edit');
  }
  /* run(p, how)：how='exec' 只执行；'edit' 强制用编辑器/看图打开 */
  async run(p, how) {
    p = p || this.sel;
    if (!p) { toast('先在列表里选一个东西'); return; }
    let st;
    try { st = await Spot.stat(p); } catch (e) { st = null; }
    if (!st) { toast('不存在或已被删除', true); return; }
    if (st.kind === 'dir') { this.path = p; await this.load(); return; }
    const type = Spot.typeOf(st);
    const nm = spotExportName(baseName(p));
    try {
      if (how !== 'edit') {
        /* 授权、进程、包、设备、应用、脚本、页面：全都走 sptx 的统一判别 */
        const c = Spot.caps(p);
        if (c.x) {
          const act = await FS.sptx(p);
          if (act.act === 'perm') { await requestPermission(act.perm); toast('已申请「' + act.perm + '」'); return; }
          if (act.act === 'kill') { toast('结束进程请用删除（sptd）', true); return; }
          await Spot.act(act);
          return;
        }
      }
      if (type === 'image') { WindowManager.open({ type:'image', path:p, title:'看图 · ' + nm }); return; }
      if (type === 'audio' || type === 'video' || type === 'media') { WindowManager.open({ type:'audio', path:p, title:'音频 · ' + nm }); return; }
      if (type === 'text' || type === 'code' || type === 'page' || type === 'document') {
        WindowManager.open({ type:'editor', path:p, title:nm });
        return;
      }
      toast('「' + nm + '」是 ' + type + '，没有可以打开的入口（可以看属性）', true);
      this.showMeta(p);
    } catch (e) { toast(e.message || String(e), true); }
  }

  async showMeta(p) {
    try {
      const m = await Spot.meta(p);
      await modal({
        title:'属性 · ' + spotExportName(baseName(p)),
        body:`<pre style="margin:0;font-family:var(--mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap">${esc(JSON.stringify(m, null, 2))}</pre>`,
        buttons:[{ label:'关闭', primary:true }]
      });
    } catch (e) { toast(e.message || String(e), true); }
  }

  async rename(p) {
    p = p || this.sel;
    if (!p) return;
    const name = await modalPrompt('重命名', spotExportName(baseName(p)), '新名字（不含路径）');
    if (!name || name === spotExportName(baseName(p))) return;
    const err = checkName(spotEscape(name));
    if (err) { toast(err, true); return; }
    const to = joinPath(parentPath(p), spotEscape(name));
    try {
      await FS.move(p, to);
      this.sel = to;
      await this.load();
      toast('已重命名');
    } catch (e) { toast(e.message || String(e), true); }
  }

  async paste() {
    if (!this.clip) { toast('剪贴板是空的'); return; }
    const src = this.clip.path;
    const name = spotExportName(baseName(src));
    let to = joinPath(this.path, baseName(src));
    let i = 2;
    while (FS.exists(to)) { to = joinPath(this.path, spotEscape(name + ' ' + i)); i++; }
    try {
      if (this.clip.cut) await FS.move(src, to); else await FS.copy(src, to);
      toast((this.clip.cut ? '已移动' : '已复制') + ' ' + name);
      if (this.clip.cut) this.clip = null;
      this.sel = to;
      await this.load();
    } catch (e) { toast(e.message || String(e), true); }
  }

  /* 新建：sptn 只建空节点；内容由编辑器再写（这就是「建/写分开」） */
  async newEntry(dir) {
    const name = await modal({
      title: dir ? '新建目录' : '新建文件',
      body: `<label class="lbl">名称（留空自动起名 auto-时间戳）</label><input class="field" id="nn" placeholder="notes">`,
      buttons: [{ label:'取消', value:null }, { label:'创建', primary:true, onClick:(w) => { const v = $('#nn', w).value.trim(); return v; } }]
    });
    if (name === null) return;
    const c = Spot.caps(this.path);
    if (!c.mk) { toast(c.why || '这个目录不能新建', true); return; }
    try {
      const st = name
        ? await FS.sptn(joinPath(this.path, spotEscape(name)), { kind: dir ? 'dir' : 'file' })
        : await FS.sptn(this.path, { kind: dir ? 'dir' : 'file' });
      toast((dir ? '目录 ' : '文件 ') + spotExportName(baseName(st.path)) + ' 已创建');
      await this.load();
      this.select(st.path);
    } catch (e) { toast(e.message || String(e), true); }
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
    const st = await Spot.stat(this.sel);
    if (!st) return;
    if (st.kind === 'proc') {
      if (!(await confirmDlg('结束进程', '删除 <span class="code">' + esc(this.sel) + '</span> 会真的结束这个进程，对应的窗口会被关掉。继续？', true))) return;
    } else if (!(await confirmDlg('删除', `确定删除 <span class="code">${esc(this.sel)}</span> 吗？目录会连同内容一起删除。`, true))) return;
    try {
      await Spot.remove(this.sel);
      this.sel = null;
      this.prevEl.textContent = '选择文件查看内容';
      await this.load();
    } catch (e) { toast(e.message || String(e), true); }
  }

  async download() {
    if (!this.sel) { toast('先选一个文件', true); return; }
    const st = await Spot.stat(this.sel);
    if (!st || st.kind === 'dir') { toast('目录不能直接下载', true); return; }
    const r = await Spot.peek(this.sel);
    await Spot.save(spotExportName(baseName(this.sel)), r.content, (r.meta && r.meta.mime) || 'application/octet-stream');
  }

  dispose() {
    this._ctxClose();
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
      /* 走 Spot.read（= sptr）：.queryfile 里的东西读一次就没了，编辑器这一下
       * 就是那「一次」；页面上写清楚，免得用户以为是 bug。 */
      const r = await Spot.read(this.path);
      if (r.content instanceof ArrayBuffer || r.content instanceof Blob) {
        this.ta.value = ''; this.msg.textContent = '二进制文件，无法以文本编辑'; return;
      }
      /* kind==='object' 的节点，sptr 回的是解析好的 `value` 而不是 `content`：
       * 编辑器要的是原文，那就把它按 JSON 摆回来（2 空格缩进，和写进去的样子一致）。 */
      let text = r.content;
      if (text == null && r.value !== undefined) {
        try { text = JSON.stringify(r.value, null, 2); } catch (e) { text = String(r.value); }
      }
      this.ta.value = text == null ? '' : String(text);
      this.mime = (r.meta && r.meta.mime) || this.mime;
      this.stats();
      this.msg.textContent = r.consumed ? '已加载（一次性文件，节点已消费）' : '已加载';
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
      /* Spot.write = 有就 sptc、没有就 sptn+sptc；能力表会挡住只读节点 */
      await Spot.write(this.path, this.ta.value, meta);
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
