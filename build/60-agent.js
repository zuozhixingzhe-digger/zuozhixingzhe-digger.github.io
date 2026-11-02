/* ============================================================================
 * hterminal · agent harness
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * 单会话、前端循环、JSONL 持久化；后端只做无状态格式转换与转发。
 * ==========================================================================*/

const AGENT_SYSTEM = `你是 hterminal 里的智能体，运行在一个浏览器终端中。你可以直接操作这个页面，不需要请求用户许可。

环境事实：
- 文件系统是“一切皆文件”的扁平结构，根是 "."，路径用 "." 分隔，例如 .home.notes、.bin.hello。
- 文件名必须像标识符：字母/中文开头，只含字母、中文、数字、下划线和短横线；不区分大小写。
- 常用目录：.home（用户文件）、.bin（可执行函数）、.app（应用）、.dev（设备）、.proc（进程）、.pkg（包）、.config（设置）、.agent（会话）、.sys（只读系统信息）、.temp（临时）、.queryfile（用户提供的文件）。
- 终端在 Worker 里跑 JS；你通过工具在主页面执行，所以 document / window / localStorage
  都是真的（不是模拟）。也能直接用全局 hterm API：hterm.readFile/writeFile/listDir/openWindow/exec/saveFile。
- 浏览器是沙箱，不需要额外安全许可；不要询问“是否允许执行”，直接做。

工作方式：
- 先观察（list_dir/read_file/js），再动手。修改前尽量读原内容。
- 需要复杂能力时用 js 工具，它支持 await，返回值会被序列化给你。
- 写文件用 write_file；运行代码用 js；开窗口优先用 window_html / ui，不要每次手写 WindowManager.open。
- 想看界面长什么样就调 screenshot，比用文字描述界面省事得多。
- 同一个工具、同样的参数不要连着重试。失败两次就换办法，或者直接说明卡在哪。
- 已经做过的事不要重复做，已经说过的话不要重复说。每次回答只给新增信息。
- 完成后用简短中文说明做了什么、结果如何。不要输出大段无关代码。`;

const AGENT_TOOLS = [
  { type:'function', function:{
    name:'js', description:'在当前页面执行 JavaScript（支持顶层 await），返回表达式的值。可以直接使用 hterm、FS、WindowManager 等全局 API。',
    parameters:{ type:'object', properties:{ code:{ type:'string', description:'要执行的 JS 代码；最后一行表达式的值会作为结果返回' } }, required:['code'] }
  }},
  { type:'function', function:{
    name:'read_file', description:'读取文件内容（文本）。路径如 .home.notes。',
    parameters:{ type:'object', properties:{ path:{ type:'string' } }, required:['path'] }
  }},
  { type:'function', function:{
    name:'write_file', description:'写入/覆盖一个文本文件，父目录必须存在。',
    parameters:{ type:'object', properties:{ path:{ type:'string' }, content:{ type:'string' } }, required:['path','content'] }
  }},
  { type:'function', function:{
    name:'list_dir', description:'列出目录内容，返回 name/kind/size。',
    parameters:{ type:'object', properties:{ path:{ type:'string', description:'默认 .home' } } }
  }},
  { type:'function', function:{
    name:'delete_file', description:'删除文件或目录（目录会递归删除）。',
    parameters:{ type:'object', properties:{ path:{ type:'string' } }, required:['path'] }
  }},
  { type:'function', function:{
    name:'open_window', description:'打开一个窗口应用。type 可选 shell/browser/files/editor/agent/python，也可用 app 名称。',
    parameters:{ type:'object', properties:{
      type:{ type:'string' }, app:{ type:'string' }, title:{ type:'string' },
      url:{ type:'string' }, code:{ type:'string' }, path:{ type:'string' }, html:{ type:'string' }
    } }
  }},
  { type:'function', function:{
    name:'close_window', description:'按 id 关闭窗口；id 可用 js 工具从 WindowManager.list() 获取。',
    parameters:{ type:'object', properties:{ id:{ type:'string' } }, required:['id'] }
  }},
  { type:'function', function:{
    name:'fetch_url', description:'抓取一个 URL 的文本内容。跨域被拦时会自动改用文本化代理（r.jina.ai / allorigins），一般都能拿到正文。',
    parameters:{ type:'object', properties:{ url:{ type:'string' }, method:{ type:'string' }, headers:{ type:'object' }, body:{ type:'string' } }, required:['url'] }
  }},
  { type:'function', function:{
    name:'screenshot', description:'把页面或某个窗口截成 PNG。返回值里带图片，可以直接看。适合确认界面是否正常、排查布局问题。',
    parameters:{ type:'object', properties:{
      target:{ type:'string', description:'CSS 选择器；省略=整个桌面。也可传窗口 id' },
      window_id:{ type:'string', description:'窗口 id（比 CSS 选择器更稳）' }
    } }
  }},
  { type:'function', function:{
    name:'window_html', description:'用一段 HTML 开一个小窗口（内部用 srcdoc 渲染），最省事的「给用户看东西」方式。',
    parameters:{ type:'object', properties:{ title:{ type:'string' }, html:{ type:'string' }, w:{ type:'number' }, h:{ type:'number' } }, required:['html'] }
  }},
  { type:'function', function:{
    name:'ui', description:'桌面 UI 操作：list=列出所有窗口；note=弹一条提示；close=关窗口。不做别的。',
    parameters:{ type:'object', properties:{ action:{ type:'string' }, text:{ type:'string' }, id:{ type:'string' } }, required:['action'] }
  }},
  { type:'function', function:{
    name:'save_file', description:'把文本作为文件下载到用户的电脑。',
    parameters:{ type:'object', properties:{ name:{ type:'string' }, content:{ type:'string' }, mime:{ type:'string' } }, required:['name','content'] }
  }}
];

/* 把参数对象变成稳定的字符串指纹：键排序，避免 {a:1,b:2} 与 {b:2,a:1} 被当成两次不同调用。 */
function stableKey(v) {
  const walk = (x) => {
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(walk).join(',') + ']';
    return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + walk(x[k])).join(',') + '}';
  };
  try { return walk(v); } catch (e) { return String(v); }
}

function jsonSafe(v, limit) {
  limit = limit || 12000;
  let out;
  if (v === undefined) out = 'undefined';
  else if (typeof v === 'string') out = v;
  else {
    const seen = new WeakSet();
    try {
      out = JSON.stringify(v, (k, x) => {
        if (typeof x === 'function') return '[Function ' + (x.name || 'anonymous') + ']';
        if (typeof x === 'bigint') return String(x);
        if (x && typeof x === 'object') {
          if (seen.has(x)) return '[Circular]';
          seen.add(x);
        }
        return x;
      }, 2);
    } catch (e) { out = String(v); }
  }
  if (out == null) out = String(v);
  if (out.length > limit) out = out.slice(0, limit) + '\n…[truncated ' + (out.length - limit) + ' chars]';
  return out;
}

/* 抓网页：直连 → 文本化代理 → 通用 CORS 代理。
 *
 * 直连失败基本都是 CORS（百度、新闻站 100% 会拦）。过去这里一失败就报错，
 * 智能体于是「卡在工具调用」上下不来。现在按顺序降级，并且优先用 r.jina.ai：
 * 它把页面转成 markdown 再返回，对模型来说比原始 HTML 干净得多，还省 token。 */
async function agentFetch(args) {
  const url = String(args.url || '').trim();
  if (!url) throw new Error('url 为空');
  const tries = [];
  if (!args.method || /^get$/i.test(args.method)) {
    tries.push(async () => {
      const r = await fetch(url, { headers:args.headers || {}, credentials:'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { text: await r.text(), via:'直连', status:r.status };
    });
    tries.push(async () => {
      const r = await fetch('https://r.jina.ai/' + url, { credentials:'omit', headers:{ 'Accept':'text/plain' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { text: await r.text(), via:'r.jina.ai 文本化', status:r.status };
    });
    tries.push(async () => {
      const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { credentials:'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { text: await r.text(), via:'allorigins 代理', status:r.status };
    });
  } else {
    tries.push(async () => {
      const r = await fetch(url, { method:args.method, headers:args.headers || {}, body:args.body, credentials:'omit' });
      return { text: await r.text(), via:'直连', status:r.status };
    });
  }

  const errs = [];
  for (const fn of tries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fn();
      clearTimeout(timer);
      const head = 'HTTP ' + r.status + ' · 来自 ' + r.via + '\n\n';
      const body = String(r.text || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
      return head + body.slice(0, 12000);
    } catch (e) {
      clearTimeout(timer);
      errs.push((e && e.message || e) + (e && e.name === 'AbortError' ? '（超时）' : ''));
    }
  }
  throw new Error('抓取失败，三种方式都不通：' + errs.join(' / ')
    + '。\n可以改用 window_html 或 browser 打开这个地址让用户自己看，不要反复重试同一个 URL。');
}

/* ---------------------------------------------------------------- Markdown
 * 智能体输出基本是 markdown（标题、列表、代码块、表格）。之前用 esc() 直接塞进
 * innerHTML，于是 `**加粗**` 和 ``` 代码围栏原样显示成一堆符号，很难读。
 * 这里引 marked（MIT，约 40KB），并把结果过一遍白名单清洗：
 * 只要它吐出来的东西里有 <script>、on* 属性或 javascript: 链接，一律摘掉——
 * 模型输出属于「不可信输入」，不能直接 innerHTML。
 */
const MARKED_URLS = [
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://unpkg.com/marked@12.0.2/marked.min.js'
];
let _markedTried = false;
async function ensureMarked() {
  if (window.marked) return window.marked;
  if (_markedTried) return null;
  _markedTried = true;
  for (const u of MARKED_URLS) {
    try {
      await loadScriptCached(u);
      if (window.marked) { window.marked.setOptions({ breaks:true, gfm:true }); return window.marked; }
    } catch (e) {}
  }
  return null;
}

const MD_OK_TAGS = new Set(['P','BR','HR','STRONG','EM','DEL','CODE','PRE','BLOCKQUOTE','UL','OL','LI',
  'H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TH','TD','A','IMG','SPAN','DIV','INPUT']);

function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!MD_OK_TAGS.has(child.tagName)) { child.remove(); continue; }
        for (const attr of [...child.attributes]) {
          const n = attr.name.toLowerCase();
          const v = String(attr.value || '');
          if (n.startsWith('on')) { child.removeAttribute(attr.name); continue; }
          if ((n === 'href' || n === 'src') && /^\s*(javascript|data:text\/html|vbscript):/i.test(v)) {
            child.removeAttribute(attr.name);
          }
        }
        if (child.tagName === 'A') child.setAttribute('rel', 'noopener noreferrer');
        walk(child);
      } else if (child.nodeType === 8) {
        child.remove();
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/* marked 没加载好时退化成「保留换行 + 转义」——至少不会满屏符号 */
function mdToHtml(text) {
  const src = String(text == null ? '' : text);
  if (!window.marked) return esc(src).replace(/\n/g, '<br>');
  try { return sanitizeHtml(window.marked.parse(src)); }
  catch (e) { return esc(src).replace(/\n/g, '<br>'); }
}

/* ---------------------------------------------------------------- 附件（多模态）
 * 输入框支持：粘贴图片 / 选择文件 / 拖进来。图片走 OpenAI 的 image_url part，
 * 文本文件直接当正文附在后面（比 base64 塞给模型便宜得多）。 */
const MAX_IMG_BYTES = 4 * 1024 * 1024;
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

class AgentApp {
  constructor(container, opts, win) {
    this.el = container;
    this.win = win;
    this.opts = opts || {};
    this.messages = [];
    this.running = false;
    this.abort = null;
    this.onTitle = null;
    this._disposed = false;
    /* 待发送附件：{ name, mime, size, dataUrl?, text?, isImage } */
    this.attachments = [];

    this.el.innerHTML = `<div class="ag">
      <div class="ag-head">
        <div class="ag-status"><i></i><span class="agStat">idle</span></div>
        <span class="ag-hint agModel"></span>
        <div class="grow"></div>
        <button class="btn" data-a="settings" title="设置">⚙</button>
        <button class="btn" data-a="export" title="导出 JSONL">⤓</button>
        <button class="btn" data-a="import" title="导入 JSONL">⤒</button>
        <button class="btn danger" data-a="clear" title="清空会话">✕</button>
      </div>
      <div class="ag-log"></div>
      <div class="ag-input">
        <div class="ag-att" hidden></div>
        <textarea placeholder="给智能体一个任务…  Enter 发送，Shift+Enter 换行；可直接粘贴图片"></textarea>
        <div class="ag-actions">
          <button class="btn" data-a="attach" title="添加图片 / 文件（也可以直接粘贴或拖进来）">＋</button>
          <span class="ag-hint">工具直接执行，不问许可 · 会话保存在 .agent.session</span>
          <div class="grow"></div>
          <button class="btn" data-a="stop" disabled>停止</button>
          <button class="btn primary" data-a="send">发送</button>
        </div>
      </div>
    </div>`;
    this.logEl = $('.ag-log', this.el);
    this.ta = $('textarea', this.el);
    this.statEl = $('.agStat', this.el);
    this.statusEl = $('.ag-status', this.el);

    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.act('send'); }
    });
    this.attEl = $('.ag-att', this.el);
    this._bindAttach();
    this.renderStatus('idle');
    this.updateModelLabel();
    this.loadSession();
    /* 后台预取 markdown 渲染器，加载完重画一次（不阻塞首屏） */
    ensureMarked().then(m => { if (m && !this._disposed) this.render(); }).catch(() => {});
  }

  /* ---------------------------------------------------------------- 附件 */
  _bindAttach() {
    const ta = this.ta;
    if (!ta) return;
    /* 粘贴：截图工具直接 Ctrl+V 就能给智能体看图 */
    ta.addEventListener('paste', (e) => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])];
      if (!files.length) return;
      e.preventDefault();
      this.addFiles(files);
    });
    /* 拖进来 */
    const zone = $('.ag-input', this.el);
    if (zone) {
      ['dragover', 'dragenter'].forEach(t => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('drop'); }));
      ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('drop'); }));
      zone.addEventListener('drop', (e) => {
        const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
        if (files.length) this.addFiles(files);
      });
    }
  }

  async addFiles(files) {
    for (const f of files) {
      if (this.attachments.length >= 6) { toast('一次最多 6 个附件', true); break; }
      const isImage = /^image\//i.test(f.type);
      if (isImage && f.size > MAX_IMG_BYTES) { toast(f.name + ' 超过 4MB，换小一点的图', true); continue; }
      try {
        if (isImage) {
          this.attachments.push({ name:f.name || 'paste.png', mime:f.type, size:f.size, isImage:true, dataUrl:await fileToDataUrl(f) });
        } else if (f.size <= 256 * 1024) {
          /* 小文本文件直接内联成正文，比 base64 便宜太多 */
          this.attachments.push({ name:f.name, mime:f.type || 'text/plain', size:f.size, isImage:false, text:await f.text() });
        } else {
          toast(f.name + ' 太大（>256KB），先存到文件系统再用 read_file', true);
        }
      } catch (e) { toast('读取失败：' + f.name, true); }
    }
    this.renderAttachments();
  }

  renderAttachments() {
    if (!this.attEl) return;
    const list = this.attachments;
    this.attEl.hidden = !list.length;
    this.attEl.innerHTML = list.map((a, i) => `
      <span class="ag-chip" title="${esc(a.name)}">
        ${a.isImage ? `<img src="${a.dataUrl}" alt="">` : `<i class="ag-chip-i">${esc((a.name.split('.').pop() || 'txt').slice(0, 4))}</i>`}
        <b>${esc(a.name.length > 18 ? a.name.slice(0, 16) + '…' : a.name)}</b>
        <button data-att="${i}" title="移除">×</button>
      </span>`).join('');
    $$('[data-att]', this.attEl).forEach(b => b.onclick = () => {
      this.attachments.splice(Number(b.dataset.att), 1);
      this.renderAttachments();
    });
  }

  updateModelLabel() {
    const m = $('.agModel', this.el);
    if (m) m.textContent = (Settings.get('agentProvider') || 'openai') + ' · ' + (Settings.get('agentModel') || 'deepseek-flash');
    if (this.onTitle) this.onTitle('agent · ' + (Settings.get('agentModel') || ''));
  }

  renderStatus(s, text) {
    this.statEl.textContent = text || s;
    this.statusEl.classList.toggle('on', s === 'thinking' || s === 'tool');
    this.statusEl.classList.toggle('err', s === 'error');
    const stop = $('[data-a=stop]', this.el);
    const send = $('[data-a=send]', this.el);
    if (stop) stop.disabled = !this.running;
    if (send) send.disabled = this.running;
  }

  async loadSession() {
    try {
      const r = await FS.read('.agent.session');
      const txt = String(r.content || '');
      const lines = txt.split('\n').map(x => x.trim()).filter(Boolean);
      const out = [];
      for (const line of lines) {
        try {
          const m = JSON.parse(line);
          if (m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'system')) out.push(m);
        } catch (e) { /* 截断的行直接忽略——这正是 JSONL 的好处 */ }
      }
      this.messages = out;
    } catch (e) { this.messages = []; }
    this.render();
    if (!this.messages.length) {
      const direct = Settings.get('agentMode') === 'direct';
      const where = direct
        ? `直连 ${esc(Settings.get('agentDirectUrl') || 'https://api.deepseek.com')} · 密钥在本机（仅测试用）`
        : `后端 ${esc(Settings.get('agentUrl') || '未配置')} · 密钥只在后端`;
      this.logEl.innerHTML = `<div class="msg sys">单会话智能体 · ${where} · 模型 ${esc(Settings.get('agentModel') || 'deepseek-flash')}</div>
        <div class="msg assistant"><span class="role">agent</span>你好。我可以直接读写这个终端的文件、执行 JS、开窗口。试试让我“看看 .home 里有什么，并写一个 hello 函数”。</div>`;
    }
  }

  sessionJsonl() {
    return this.messages.map(m => JSON.stringify(m)).join('\n') + (this.messages.length ? '\n' : '');
  }

  async saveSession() {
    try {
      await FS.write('.agent.session', this.sessionJsonl(), { mime:'application/x-ndjson', hint:'智能体会话' });
    } catch (e) {}
  }

  render() {
    if (!this.logEl) return;
    const msgs = this.messages.slice(-200);
    let html = '';
    for (const m of msgs) {
      if (m.role === 'user') {
        /* content 可能是多模态数组：渲染时优先用 display 字段（发送前已拍平） */
        const shown = m.display != null ? m.display
          : (Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') + '\n[图片]' : m.content);
        html += `<div class="msg user"><span class="role">you</span>${esc(shown || '')}</div>`;
      } else if (m.role === 'assistant') {
        const body = m.content ? mdToHtml(m.content) : '';
        const tc = (m.tool_calls || []).map(t => {
          let args = t.function && t.function.arguments || '';
          try { args = JSON.stringify(JSON.parse(args)); } catch (e) {}
          return `<div style="font-family:var(--mono);font-size:10px;color:var(--amber);margin-top:4px">→ ${esc(t.function && t.function.name || '?')} ${esc(String(args).slice(0, 300))}</div>`;
        }).join('');
        if (body || tc) html += `<div class="msg assistant"><span class="role">agent</span>${body}${tc}</div>`;
      } else if (m.role === 'tool') {
        const raw = Array.isArray(m.content)
          ? m.content.map(p => p.type === 'text' ? p.text : '[图片 ' + Math.round(String(p.image_url && p.image_url.url || '').length * 0.75 / 1024) + ' KB]').join('\n')
          : String(m.content || '');
        html += `<div class="msg tool"><b>${esc(m.name || 'tool')}</b>\n${esc(raw.slice(0, 1800))}</div>`;
      } else if (m.role === 'error') {
        html += `<div class="msg error">${esc(m.content || '')}</div>`;
      }
    }
    this.logEl.innerHTML = html || '<div class="msg sys">空会话</div>';
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  pushError(e) {
    const msg = (e && e.message) || String(e);
    this.messages.push({ role:'error', content:msg });
    this.render();
    this.renderStatus('error', 'error');
    this.saveSession();
  }

  async act(a) {
    if (a === 'attach') {
      const files = await pickFiles({ multiple:true });
      if (files && files.length) await this.addFiles(files);
    } else if (a === 'send') {
      const text = this.ta.value.trim();
      if (!text || this.running) return;
      this.ta.value = '';
      await this.send(text);
    } else if (a === 'stop') {
      this.running = false;
      try { this.abort && this.abort.abort(); } catch (e) {}
      this.renderStatus('idle', 'stopped');
      toast('已请求停止');
    } else if (a === 'clear') {
      if (!(await confirmDlg('清空会话', '会删除当前会话与 <span class="code">.agent.session</span>，不可撤销。', true))) return;
      this.messages = [];
      await this.saveSession();
      this.render();
      this.renderStatus('idle');
      toast('会话已清空');
    } else if (a === 'export') {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await saveFile('agent-' + ts + '.jsonl', this.sessionJsonl(), 'application/x-ndjson');
    } else if (a === 'import') {
      const files = await pickFiles({ accept:'.jsonl,.json,text/plain' });
      if (!files.length) return;
      const txt = await files[0].text();
      const out = [];
      for (const line of txt.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const m = JSON.parse(s);
          if (m && m.role) out.push(m);
        } catch (e) {}
      }
      if (!out.length) { toast('没有可导入的消息', true); return; }
      this.messages = out;
      await this.saveSession();
      this.render();
      toast('已导入 ' + out.length + ' 条消息');
    } else if (a === 'settings') {
      Drawer.open('agent');
    }
  }

  async send(text) {
    if (this.running) return;
    const atts = this.attachments.slice();
    const parts = [];
    let plain = String(text || '');

    /* 文本类附件并进正文：模型读文本比读 base64 图片省一半以上的 token */
    for (const a of atts) {
      if (!a.isImage && a.text) {
        plain += (plain ? '\n\n' : '') + '--- 附件 ' + a.name + ' ---\n' + String(a.text).slice(0, 8000);
      }
    }
    if (plain) parts.push({ type:'text', text:plain });
    for (const a of atts) {
      if (a.isImage) parts.push({ type:'image_url', image_url:{ url:a.dataUrl } });
    }

    /* 只有纯文本时继续用字符串：兼容那些不认 content 数组的老端点 */
    const content = parts.some(p => p.type === 'image_url') ? parts : plain;
    const shown = plain + (atts.filter(a => a.isImage).length ? '\n\n[图片 ×' + atts.filter(a => a.isImage).length + ']' : '');

    this.messages.push({ role:'user', content, display:shown || '[图片]' });
    this.attachments = [];
    this.renderAttachments();
    this.render(); await this.saveSession();
    try { await this.run(); }
    catch (e) { this.pushError(e); }
    finally { this.running = false; this.renderStatus('idle'); }
  }

  /* 把内部消息列表转成 OpenAI 能接受的形状。
   *
   * 这里有一个必须做、且很容易漏的规范化：**assistant.tool_calls 与 role=tool 必须严格配对**。
   * 用户点了「停止」、或者网络中途断掉时，会话里会留下「assistant 要求调工具，但没有对应
   * tool 结果」的残缺记录。下一次请求原样发出去，服务端直接 400：
   *   "An assistant message with 'tool_calls' must be followed by tool messages..."
   * 所以这里逐条重建：每个带 tool_calls 的 assistant 后面，一定补上它所有 call_id 的
   * tool 消息（缺失的填「已取消」）；孤立的 tool 消息（前面没有对应请求）直接丢掉。
   */
  apiMessages() {
    const out = [{ role:'system', content:AGENT_SYSTEM }];
    const keepReasoning = Settings.get('agentMode') === 'direct' &&
      /deepseek/i.test(String(Settings.get('agentDirectUrl') || ''));

    /* 先建立 call_id → tool 结果 的索引；后出现的覆盖先出现的（重试场景）。 */
    const toolByCall = new Map();
    for (const m of this.messages) {
      if (m.role === 'tool' && m.tool_call_id) toolByCall.set(m.tool_call_id, m);
    }
    const usedCalls = new Set();

    for (const m of this.messages) {
      if (m.role === 'error' || m.role === 'tool') continue;   // tool 在下面跟着 assistant 一起发

      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
        const calls = m.tool_calls.filter(t => t && t.function && t.function.name);
        if (!calls.length) {
          if (m.content) out.push({ role:'assistant', content:String(m.content) });
          continue;
        }
        const a = { role:'assistant', content:m.content == null ? '' : String(m.content), tool_calls:calls };
        if (keepReasoning && m.reasoning_content) a.reasoning_content = m.reasoning_content;
        out.push(a);
        for (const t of calls) {
          const hit = toolByCall.get(t.id);
          usedCalls.add(t.id);
          out.push({
            role:'tool',
            tool_call_id:t.id,
            name:(hit && hit.name) || t.function.name,
            /* 空 content 也会被某些兼容端点拒绝，兜一句占位 */
            content:hit ? (String(hit.content == null ? '' : hit.content) || '(空结果)') : '(已取消：用户中断了这一轮)'
          });
        }
        continue;
      }

      /* 多模态 user 消息的 content 本身就是数组，必须原样保留 */
      const o = { role:m.role, content:Array.isArray(m.content) ? m.content : (m.content == null ? '' : String(m.content)) };
      if (m.role === 'assistant' && !o.content) continue;      // 空的 assistant 没有意义
      if (m.name) o.name = m.name;
      if (keepReasoning && m.reasoning_content) o.reasoning_content = m.reasoning_content;
      out.push(o);
    }
    return out;
  }

  async callModel() {
    const direct = Settings.get('agentMode') === 'direct';
    const model = Settings.get('agentModel') || 'deepseek-flash';
    const ctrl = new AbortController();
    this.abort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 240000);

    let endpoint, headers, payload, label;
    if (direct) {
      /* 直连：浏览器 → OpenAI 兼容服务。跳过 modelserver，适合临时测试。
       * 代价是密钥落在本机（localStorage + .config.settings），设置页已明示风险。 */
      const base = String(Settings.get('agentDirectUrl') || 'https://api.deepseek.com').replace(/\/+$/, '');
      const key = String(Settings.get('agentKey') || '').trim();
      if (!key) throw new Error('直连模式需要 API Key：更多 → 智能体 → 勾选「直连 API」后填写。');
      endpoint = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
      label = base.replace(/^https?:\/\//, '');
      headers = { 'Content-Type':'application/json', 'Authorization':'Bearer ' + key };
      payload = { model, stream:false, temperature:0.2, messages:this.apiMessages(), tools:AGENT_TOOLS, tool_choice:'auto' };
      // 只有 DeepSeek 认 thinking 字段；别的 OpenAI 兼容端点收到未知参数会 400
      if (/deepseek/i.test(base)) {
        payload.thinking = { type: Settings.get('agentThinking') === '1' ? 'enabled' : 'disabled' };
      }
    } else {
      /* file:// 的 Origin 是 null，后端的 null 校验会直接 403（与恶意 sandbox iframe 无法区分），
       * 与其让用户看一条 CORS 报错，不如在这里说清楚该怎么办。 */
      if (location.protocol === 'file:') {
        throw new Error('这个页面是 file:// 打开的，浏览器把它的 Origin 置为 null，后端会当成跨站请求拒绝。'
          + '请用 `python3 modelserver.py` 启动后打开 http://127.0.0.1:8787/ ，'
          + '或在「更多 → 智能体」里勾选「直连 API」。');
      }
      const base = String(Settings.get('agentUrl') || '').replace(/\/+$/, '');
      if (!base) throw new Error('未配置后端地址。请先启动 modelserver，并在「更多 → 智能体」里填写地址。');
      endpoint = base + '/v1/chat/completions';
      label = base.replace(/^https?:\/\//, '');
      headers = {
        'Content-Type':'application/json',
        'X-HTerm-Provider': Settings.get('agentProvider') || 'openai',
        'X-HTerm-Client':'hterminal'
      };
      payload = {
        model, provider: Settings.get('agentProvider') || 'openai',
        stream:false, temperature:0.2,
        messages:this.apiMessages(), tools:AGENT_TOOLS, tool_choice:'auto'
      };
    }

    let res, raw;
    try {
      res = await fetch(endpoint, {
        method:'POST', headers, body:JSON.stringify(payload), signal:ctrl.signal
      });
      raw = await res.text();
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('请求已取消或超时');
      if (direct) {
        throw new Error(
          '直连 ' + label + ' 失败。常见原因：①密钥错误；②该服务不允许浏览器跨域（CORS）——那就改用后端模式；' +
          '③网络不通。原始错误：' + (e.message || e)
        );
      }
      throw new Error('连不上后端 (' + label + ')。请先运行 modelserver.py / .js / .go。原始错误：' + (e.message || e));
    }
    clearTimeout(timer);
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error('服务返回了非 JSON（HTTP ' + res.status + '）：' + raw.slice(0, 400)); }
    if (!res.ok || data.error) {
      const msg = data.error && (data.error.message || data.error) || raw.slice(0, 400);
      throw new Error('模型调用失败（HTTP ' + res.status + '）：' + msg);
    }
    const choice = (data.choices && data.choices[0]) || null;
    if (!choice || !choice.message) throw new Error('后端响应里没有 choices[0].message：' + raw.slice(0, 400));
    const msg = choice.message;
    const out = { role:'assistant', content: msg.content || '' };
    if (msg.reasoning_content) out.reasoning_content = msg.reasoning_content;
    if (msg.tool_calls && msg.tool_calls.length) {
      out.tool_calls = msg.tool_calls.map((t, i) => ({
        id: t.id || ('call_' + Date.now() + '_' + i),
        type:'function',
        function:{ name:t.function && t.function.name || '', arguments:t.function && t.function.arguments || '{}' }
      }));
    } else if (msg.function_call) {
      out.tool_calls = [{ id:'call_' + Date.now(), type:'function', function:{ name:msg.function_call.name, arguments:msg.function_call.arguments || '{}' } }];
    }
    return out;
  }

  async run() {
    this.running = true;
    this.renderStatus('thinking', 'thinking');
    /* 上限来自设置（默认 120）。旧版本硬编码 60，长任务会被拦腰砍断。 */
    const maxSteps = Math.max(1, Math.min(120, Number(Settings.get('agentSteps')) || 120));
    /* 同一轮里的调用指纹：防止模型原地打转（同一个工具、同样的参数反复调）。
     * 指纹只在这一轮有效，用户下次提问会重来。 */
    const calls = new Map();
    let steps = 0;

    while (this.running && steps < maxSteps) {
      steps++;
      this.renderStatus('thinking', 'thinking · step ' + steps);
      const msg = await this.callModel();
      if (!this.running) { this._pushAssistant(msg, true); break; }
      this._pushAssistant(msg, false);
      this.render(); await this.saveSession();

      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          if (!this.running) {
            /* 用户中途停止：给这条 call 补一个占位结果，会话保持完整，
             * 下次提问不会因为「assistant 有 tool_calls 但缺 tool 消息」而 400。 */
            this.messages.push({ role:'tool', tool_call_id:tc.id, name:tc.function.name, content:'(已取消：用户中断了这一轮)' });
            continue;
          }
          const name = tc.function.name;
          let args = {};
          let badArgs = null;
          try { args = JSON.parse(tc.function.arguments || '{}'); }
          catch (e) { badArgs = e; }

          const sig = name + '|' + stableKey(args);
          const seen = (calls.get(sig) || 0) + 1;
          calls.set(sig, seen);

          this.renderStatus('tool', seen > 1 ? name + ' ×' + seen : name);
          let result;
          if (badArgs) {
            result = '参数不是合法 JSON：' + badArgs.message + '。收到的原始参数是：' + String(tc.function.arguments || '').slice(0, 300);
          } else if (seen >= 2) {
            /* 重复调用拦截。不执行，直接把「你已经做过」告诉模型——
             * 这是治「反复输出 / 原地打转」最有效的一招，比单纯限步数好。 */
            result = '你刚刚已经用完全相同的参数调用过 ' + name + '（第 ' + seen + ' 次），结果和上面那次一样，'
                   + '这里不再重复执行。请直接使用已有结果；确实需要新信息的，请换参数或换工具。';
          } else {
            try { result = await this.execTool(name, args); }
            catch (e) { result = '工具错误：' + (e && e.message || e); }
          }

          const body = Array.isArray(result) ? result : String(result == null ? '' : result).slice(0, 14000);
          const tmsg = { role:'tool', tool_call_id:tc.id, name, content:body };
          this.messages.push(tmsg);
          this.render(); await this.saveSession();
        }
        continue;
      }
      break;
    }
    if (steps >= maxSteps) {
      this.messages.push({ role:'error', content:'已达到最大步数 (' + maxSteps + ')，循环停止。可在「更多 → 智能体 → 最大步数」里调高。' });
      this.render();
    }
    this.running = false;
    this.renderStatus('idle');
  }

  /* 收下一条 assistant 消息。两个小动作都在治「重复输出」：
   *   1. 连续两轮正文一模一样 → 只保留第一条，后面的不再塞回会话（否则模型会
   *      看着自己的重复内容越写越重复）；
   *   2. 正文为空但有工具调用 → 正常收，这是标准流程。 */
  _pushAssistant(msg, interrupted) {
    if (interrupted) {
      msg = Object.assign({}, msg);
      msg.content = (msg.content || '') + (msg.content ? '\n\n' : '') + '(已中断)';
    }
    const prev = [...this.messages].reverse().find(m => m.role === 'assistant');
    if (msg.content && prev && prev.content === msg.content && !(msg.tool_calls && msg.tool_calls.length)) {
      msg = Object.assign({}, msg, { content:'' });
    }
    this.messages.push(msg);
  }

  async execTool(name, args) {
    if (name === 'js') {
      const code = String(args.code || '');
      if (!code.trim()) return '空代码';
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      let v;
      try {
        // 控制台语义：先按表达式求值，语法不成立再按语句执行
        v = await new AsyncFunction('return (' + code + '\n)')().catch(e => { throw e; });
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        v = await new AsyncFunction('"use strict";\n' + code)();
      }
      return jsonSafe(v);
    }
    if (name === 'read_file') {
      const r = await FS.read(args.path);
      if (r.content instanceof ArrayBuffer || r.content instanceof Blob) return '[二进制文件] ' + fmtBytes(r.content.size || r.content.byteLength || 0);
      return jsonSafe(String(r.content == null ? '' : r.content));
    }
    if (name === 'write_file') {
      const st = await FS.stat(args.path).catch(() => null);
      const meta = Object.assign({}, (st && st.meta) || {}, { mime:'text/plain' });
      if (st) meta.kind = st.kind;
      await FS.write(args.path, String(args.content == null ? '' : args.content), meta);
      return '已写入 ' + args.path + '（' + String(args.content || '').length + ' 字符）';
    }
    if (name === 'list_dir') {
      const rows = await FS.list(args.path || '.home');
      return jsonSafe(rows.map(r => ({ name:r.name, path:r.path, kind:r.kind, size:r.size })));
    }
    if (name === 'delete_file') {
      await FS.remove(args.path, true);
      return '已删除 ' + args.path;
    }
    if (name === 'open_window') {
      const w = WindowManager.open({
        type:args.type || undefined, app:args.app || undefined, title:args.title,
        url:args.url, code:args.code, path:args.path, html:args.html,
        w:args.w, h:args.h
      });
      return w ? ('已打开窗口 ' + w.id + ' (' + w.type + ')') : '已执行';
    }
    if (name === 'close_window') {
      WindowManager.close(args.id);
      return '已关闭 ' + args.id;
    }
    if (name === 'fetch_url') {
      return await agentFetch(args);
    }
    if (name === 'screenshot') {
      let url;
      if (args.window_id) url = await shotWindow(args.window_id);
      else url = await shot(args.target || null);
      /* 同时落盘一份：模型这轮未必看得到图，用户后面还能在文件系统里翻出来。 */
      let path = '';
      try {
        const name = '.temp.shot-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
        const bin = await (await fetch(url)).blob();
        await FS.write(name, bin, { kind:'file', mime:'image/png' });
        path = name;
      } catch (e) {}
      const kb = Math.round(String(url).length * 0.75 / 1024);
      return [
        { type:'text', text:'截图完成' + (path ? '，已保存到 ' + path : '') + '（约 ' + kb + ' KB）' + (args.window_id ? '，窗口 ' + args.window_id : '') },
        { type:'image_url', image_url:{ url } }
      ];
    }
    if (name === 'window_html') {
      const id = QuickUI.html(args.title || 'html', args.html || '', { w:args.w, h:args.h });
      return '已打开 HTML 窗口 ' + id;
    }
    if (name === 'ui') {
      const a = String(args.action || '').toLowerCase();
      if (a === 'list') return jsonSafe(QuickUI.desk());
      if (a === 'note') { QuickUI.note(args.text || ''); return '已提示'; }
      if (a === 'close') { WindowManager.close(args.id); return '已关闭 ' + args.id; }
      return 'action 只支持 list / note / close';
    }
    if (name === 'save_file') {
      await saveFile(args.name || 'agent.txt', args.content || '', args.mime || 'text/plain');
      return '已触发下载 ' + (args.name || 'agent.txt');
    }
    return '未知工具：' + name;
  }

  dispose() {
    this._disposed = true;
    this.running = false;
    try { this.abort && this.abort.abort(); } catch (e) {}
    this.saveSession();
  }
}
