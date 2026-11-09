/* ============================================================================
 * HTerMinaL · agent harness
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * 单会话、前端循环、JSONL 持久化；后端只做无状态格式转换与转发。
 * ==========================================================================*/

/* 系统提示词由两段拼成：
 *
 *   环境说明（AGENT_ENV）——由程序写死。文件系统长什么样、有哪些 API、沙箱边界在哪，
 *     这些是事实，不是口味。让用户改，只会得到一段与真实环境不符的说明，
 *     智能体照着做就会撞墙，而且很难查。
 *
 *   人格（.config.persona）——用户可改。人设、语气、做事习惯都属于这一类。
 *     默认值写在 AGENT_PERSONA_DEFAULT 里，首次打开智能体时落成文件，之后以文件为准。
 *
 * 分层的好处不只是「能改」：升级换掉环境说明时，用户改过的人格不会被覆盖；
 * 反过来用户把人格改坏了，删文件就回到默认。 */
const AGENT_ENV = `你是 HarTMLes——HTerMinaL 里的智能体，运行在一个浏览器终端中。你可以直接操作这个页面，不需要请求用户许可。

环境事实：
- 文件系统是“一切皆文件”的扁平结构，根是 "."，路径用 "." 分隔，例如 .home.notes、.bin.hello。
- 文件名必须像标识符：字母/中文开头，只含字母、中文、数字、下划线和短横线；不区分大小写。
- 常用目录：.home（用户文件）、.bin（可执行函数）、.app（应用）、.dev（设备）、.proc（进程）、.pkg（包）、.config（设置）、.agent（会话）、.sys（只读系统信息）、.temp（临时）、.queryfile（用户提供的文件）。
- 终端在 Worker 里跑 JS；你通过工具在主页面执行，所以 document / window / localStorage
  都是真的（不是模拟）。也能直接用全局 hterm API：hterm.readFile/writeFile/listDir/openWindow/exec/saveFile。
- 抓网页用 fetch_url（有后端时由本机后端代抓，不受跨域限制；返回的是正文，不是原始 HTML）。
  要新闻/热搜直接用 news 工具，不要自己猜新闻站首页，更不要抓 .js 地址。
- 浏览器是沙箱，不需要额外安全许可；不要询问“是否允许执行”，直接做。`;

const AGENT_PERSONA_PATH = '.config.persona';

const AGENT_PERSONA_DEFAULT = `# HarTMLes 人格提示词（改这个文件即可，下一条消息生效）
# 以 # 开头的行不会发给模型。删掉本文件、或执行 persona reset，就回到这份默认。
# 环境说明（文件系统、API、沙箱边界）不在这个文件里：那部分由程序按真实环境生成。

角色：
- 你是 HarTMLes，用户在这台「终端桌面」里的搭子，不是客服。语气平实，少用感叹号，不谈“作为 AI”。

工作方式：
- 先观察（list_dir/read_file/js），再动手。修改前尽量读原内容。
- 需要复杂能力时用 js 工具，它支持 await，返回值会被序列化给你。
- 写文件用 write_file；运行代码用 js；开窗口优先用 window_html / ui，不要每次手写 WindowManager.open。
- 想看界面长什么样就调 screenshot，比用文字描述界面省事得多。
- 同一个工具、同样的参数不要连着重试。失败两次就换办法，或者直接说明卡在哪。
- 已经做过的事不要重复做，已经说过的话不要重复说。每次回答只给新增信息。
- 若 harness 提示你“已连续 3 次重复输出并自动追问”，说明你陷入了循环：立即停止重复，换思路、改参数或总结已完成的结果，不要再把同样的动作发出来。
- 完成后用简短中文说明做了什么、结果如何。不要输出大段无关代码。`;

let _personaCache = null, _personaAt = 0, _personaP = null;

/* 以 # 开头（允许前导空格）的整行是注释，拼提示词时剥掉。
 * 配置文件要能自己解释自己，但解释不能当成指令发给模型。 */
function stripPersonaComments(s) {
  return String(s == null ? '' : s)
    .split(/\r?\n/)
    .filter(l => !/^\s*#/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function agentSystemPrompt(persona) {
  const p = stripPersonaComments(persona);
  return p ? AGENT_ENV + '\n\n' + p : AGENT_ENV;
}

/* 读人格配置。TTL 1.2 秒：一轮 run 里的多次模型调用共用一份，
 * 用户刚在终端改完，下一次提问就能用上，不用重启。 */
async function loadAgentPersona(force) {
  if (!force && _personaCache && Date.now() - _personaAt < 1200) return _personaCache;
  if (_personaP) return _personaP;
  _personaP = (async () => {
    let text = '', custom = false;
    try {
      const r = await FS.read(AGENT_PERSONA_PATH);
      if (r && typeof r.content === 'string' && r.content.trim()) { text = r.content; custom = true; }
    } catch (e) { /* 还没有这个文件 → 用默认 */ }
    if (!text.trim()) text = AGENT_PERSONA_DEFAULT;
    _personaCache = { text, custom };
    _personaAt = Date.now();
    return _personaCache;
  })();
  try { return await _personaP; } finally { _personaP = null; }
}

function invalidateAgentPersona() { _personaCache = null; _personaAt = 0; }

/* 第一次打开智能体时把默认人格落成文件：
 * 「配置在 .config 里」比「藏在代码里的一个常量」更像一个用户能维护的东西。 */
async function ensureAgentPersonaFile() {
  try {
    const st = await FS.stat(AGENT_PERSONA_PATH);
    if (st) return false;
  } catch (e) { /* 不存在 → 下面写 */ }
  try {
    await FS.write(AGENT_PERSONA_PATH, AGENT_PERSONA_DEFAULT, { kind:'file', mime:'text/plain' });
    invalidateAgentPersona();
    return true;
  } catch (e) { return false; }
}

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
    name:'fetch_url', description:'抓取一个 URL 的正文（HTML 会转成纯文本，RSS/Atom 会拆成条目，JSON 会格式化）。有后端时由本机后端代抓，不受跨域限制。要新闻/热搜请直接用 news，不要猜首页地址。',
    parameters:{ type:'object', properties:{ url:{ type:'string' }, method:{ type:'string' }, headers:{ type:'object' }, body:{ type:'string' } }, required:['url'] }
  }},
  { type:'function', function:{
    name:'news', description:'取最近的新闻/热搜标题（不需要 URL）。source=auto（默认，热榜+滚动新闻）/ hot（热搜榜）/ roll（最新滚动新闻）。用户说「抓几条新闻」「今天有什么热搜」时用它。',
    parameters:{ type:'object', properties:{ count:{ type:'number', description:'条数，默认 10，最多 30' }, source:{ type:'string', description:'auto | hot | roll' } } }
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

/* 抓网页：本机后端 → 直连 → 文本化代理 → 通用 CORS 代理。
 *
 * 为什么把「本机后端」放在第一位：浏览器 fetch 受同源策略管，新闻站、政务站
 * 一律不带 Access-Control-Allow-Origin，直连 100% 失败；r.jina.ai 和 allorigins
 * 在国内经常连不上。智能体明明有 fetch_url 却抓不到任何网页，工具就成了摆设。
 * modelserver 是本机进程，不受同源策略限制，由它代抓最稳（/v1/fetch，带 SSRF 防护）。
 *
 * 拿到的不再是原始 HTML：HTML 抽正文、RSS/Atom 抽条目、JSON 格式化。
 * 直接把 200 KB 标签塞给模型，既费 token 又读不出内容——「抓到了但看不懂」
 * 和「抓不到」对用户是一回事。 */
async function rawFetch(url) {
  const useBackend = String(Settings.get('agentMode') || 'backend') !== 'direct';
  const base = useBackend ? String(Settings.get('agentUrl') || '').replace(/\/+$/, '') : '';
  const tries = [];
  /* file:// 页面没有令牌的话，这一档必然 403，先问一次；用户放弃就直接落到直连/代理。 */
  if (base && await ensureFileToken('抓网页要走后端，需要一个访问令牌。')) {
    tries.push(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(base + '/v1/fetch', {
          method:'POST', signal:ctrl.signal, credentials:'omit',
          headers:{ 'Content-Type':'application/json', 'X-HTerm-Client':'HTerMinaL', ...FileToken.header() },
          body:JSON.stringify({ url })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        return { text:j.text, status:j.status, contentType:j.contentType || '', via:'本机后端', finalUrl:j.finalUrl || url };
      } finally { clearTimeout(timer); }
    });
  }
  tries.push(async () => {
    const r = await fetch(url, { credentials:'omit' });
    return { text: await r.text(), status:r.status, contentType:r.headers.get('content-type') || '', via:'直连', finalUrl:url };
  });
  tries.push(async () => {
    const r = await fetch('https://r.jina.ai/' + url, { credentials:'omit', headers:{ 'Accept':'text/plain' } });
    return { text: await r.text(), status:r.status, contentType:'text/plain', via:'r.jina.ai 文本化', finalUrl:url };
  });
  tries.push(async () => {
    const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { credentials:'omit' });
    return { text: await r.text(), status:r.status, contentType:r.headers.get('content-type') || '', via:'allorigins 代理', finalUrl:url };
  });

  const errs = [];
  for (const fn of tries) {
    try {
      const r = await fn();
      /* 4xx/5xx 也把正文带回去：新闻站的 403 页面、API 的错误 JSON 都是线索，
       * 模型看到「403 + 原因」比看到一句「失败」更容易换策略。 */
      if (r.status >= 400) {
        const brief = String(r.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
        throw new Error('HTTP ' + r.status + (brief ? '：' + brief : ''));
      }
      return r;
    } catch (e) {
      errs.push((e && e.message || e) + (e && e.name === 'AbortError' ? '（超时）' : ''));
    }
  }
  throw new Error('抓取失败，四种方式都不通：' + errs.join(' / ')
    + '。\n不要反复重试同一个 URL：换一个来源，或用 news 工具直接取新闻标题。');
}

/* RSS / Atom → 一行一条，带时间与链接。新闻站大多还留着 RSS，它比 HTML 干净得多。 */
function rssToText(xml) {
  let doc;
  try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch (e) { return ''; }
  if (!doc || doc.querySelector('parsererror')) return '';
  const items = [...doc.querySelectorAll('item, entry')].slice(0, 30);
  if (!items.length) return '';
  const pick = (el, sels) => {
    for (const s of sels) { const n = el.querySelector(s); if (n && n.textContent.trim()) return n.textContent.trim(); }
    return '';
  };
  return items.map((it, i) => {
    const title = pick(it, ['title']);
    const link = pick(it, ['link']) || (it.querySelector('link') && it.querySelector('link').getAttribute('href')) || '';
    const date = pick(it, ['pubDate', 'updated', 'published', 'dc\\:date']);
    const desc = pick(it, ['description', 'summary']).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
    return (i + 1) + '. ' + title + (date ? ' · ' + date : '') + (link ? '\n   ' + link : '') + (desc ? '\n   ' + desc : '');
  }).join('\n');
}

/* HTML → 正文。用 DOMParser 而不是正则：正文里带 `<` 的代码、注释掉的标签，
 * 正则一剪就乱。块级元素补换行，保证列表/段落不会粘成一整行。 */
function htmlToText(html) {
  let doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return html; }
  if (!doc || !doc.body) return html;
  doc.querySelectorAll('script,style,noscript,svg,iframe,template').forEach(n => n.remove());
  doc.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,header,footer,dd,dt,pre,blockquote,table')
    .forEach(n => { n.append('\n'); });
  let text = doc.body.textContent || '';
  text = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  const title = (doc.title || '').trim();
  return (title && text.indexOf(title) < 0 ? title + '\n\n' : '') + text;
}

function readable(text, contentType, url) {
  const s = String(text || '');
  const ct = String(contentType || '').toLowerCase();
  const head = s.slice(0, 400).trim();
  if (/rss|atom|xml/.test(ct) || /^<\?xml|^<rss|^<feed/i.test(head)) {
    const r = rssToText(s);
    if (r) return r;
  }
  if (/json/.test(ct) || /^[\[{]/.test(head)) {
    try {
      const o = JSON.parse(s);
      return JSON.stringify(o, null, 1);
    } catch (e) {}
  }
  if (/html|xml/.test(ct) || /^<!doctype|^<html|^<head|^<body/i.test(head)) return htmlToText(s);
  return s;
}

async function agentFetch(args) {
  const url = String(args.url || '').trim();
  if (!url) throw new Error('url 为空');
  const r = await rawFetch(url);
  const body = readable(r.text, r.contentType, url);
  const head = 'HTTP ' + r.status + ' · 来自 ' + r.via
    + (r.finalUrl && r.finalUrl !== url ? ' · 最终地址 ' + r.finalUrl : '')
    + '\n\n';
  return head + String(body || '').slice(0, 12000);
}

/* ---------------------------------------------------------------- 新闻
 * 「给我抓几条新闻」是最高频的一类请求，但它恰恰最容易被当成「随便 fetch 一个
 * 首页」。模型猜出来的 URL 经常是 JS 渲染的榜单（163 的 rank_whole.js、知乎 hot），
 * 抓回来只有一坨脚本，最后交不出东西。这里把两个稳定、结构化、无需登录的源
 * 固化下来：今日头条热榜（JSON）、新浪滚动新闻（JSON）。都走 rawFetch，
 * 所以有后端时由后端代抓，没有后端才可能被 CORS 拦。 */
const NEWS_SOURCES = [
  { id:'hot', label:'今日头条热榜', url:'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    pick:(j) => ((j && j.data) || []).map(x => ({ title:x.Title, hot:x.HotValue, url:x.Url })) },
  { id:'hot', label:'百度热搜', url:'https://top.baidu.com/api/board?platform=wise&tab=realtime',
    pick:(j) => {
      const card = j && j.data && j.data.cards && j.data.cards[0];
      const rows = (card && card.content) || [];
      return rows.map(r => {
        const c = (r.content && r.content[0]) || r;
        return { title:c.word || c.query || r.word, hot:r.hotScore, url:c.url };
      });
    } },
  { id:'roll', label:'新浪最新新闻', url:'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=20&page=1',
    pick:(j) => (((j || {}).result || {}).data || []).map(x => ({ title:x.title, url:x.url, hot:x.intro })) }
];

async function agentNews(args) {
  const count = Math.max(1, Math.min(30, parseInt(args.count, 10) || 10));
  const only = String(args.source || 'auto').toLowerCase();
  const list = NEWS_SOURCES.filter(s => only === 'auto' || s.id === only);
  const rows = [], errs = [];
  for (const src of list) {
    if (rows.length >= count) break;
    try {
      const r = await rawFetch(src.url);
      let j;
      try { j = JSON.parse(readable(r.text, r.contentType, src.url)); } catch (e) { throw new Error('返回的不是 JSON'); }
      const got = src.pick(j).filter(x => x && x.title).slice(0, count - rows.length);
      if (!got.length) throw new Error('JSON 里没有条目');
      for (const x of got) rows.push({ ...x, from: src.label });
    } catch (e) {
      errs.push(src.label + '：' + (e && e.message || e));
    }
  }
  if (!rows.length) {
    const direct = String(Settings.get('agentMode') || 'backend') === 'direct';
    throw new Error('新闻源都没取到：' + errs.join(' / ')
      + (direct ? '\n直连模式下浏览器跨域会挡住这两个源。启动 modelserver、切到「后端」模式再试（后端会代抓）。' : '')
      + '\n请如实告诉用户抓取失败，不要继续硬试。');
  }
  const fmt = (t) => {
    const d = new Date(Number(t) * (String(t).length <= 10 ? 1000 : 1));
    return isNaN(d) ? '' : d.toLocaleString('zh-CN', { hour12:false });
  };
  const out = rows.map((x, i) => {
    const hot = x.hot && !/^https?:/.test(String(x.hot)) && String(x.hot).length < 24 ? ' · 热度 ' + x.hot : '';
    /* 头条热榜的链接带一长串 log_pb 埋点参数（几百字符），对模型和用户都没用，
     * 直接砍掉查询串；短链仍然能打开同一条内容。 */
    const link = x.url ? String(x.url).split('?')[0].slice(0, 140) : '';
    return (i + 1) + '. ' + x.title + hot + (x.from ? ' — ' + x.from : '')
      + (link ? '\n   ' + link : '');
  }).join('\n');
  return '共 ' + rows.length + ' 条（' + new Date().toLocaleString('zh-CN', { hour12:false }) + '）：\n' + out;
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

/* ---------------------------------------------------------------- 会话持久化
 *
 * 独立数据库 `ht-agent`，**不**塞进 DepCache：清依赖缓存是常规操作，
 * 顺手把用户几十轮对话删掉就是事故。
 *
 *   sessions  { id, title, createdAt, updatedAt, model, mode, msgCount }
 *   messages  { sid, seq, role, content, tool_calls, tool_call_id, name, display, ts }
 *
 * 顺序一律用 seq，不靠时间戳——时钟会跳。
 * 图片附件不存 dataURL：超过 40 KB 的转成 Blob 存（IDB 原生支持），读回来再转回 dataURL。
 * 一张截图几百 KB，几十轮就顶到配额，这是唯一撑得住的做法。
 */
const AgentStore = {
  DB: 'ht-agent',
  VER: 1,
  _db: null,
  _p: null,

  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('没有 IndexedDB'));
      const r = indexedDB.open(this.DB, this.VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath:'id' });
        if (!db.objectStoreNames.contains('messages')) {
          const ms = db.createObjectStore('messages', { keyPath:['sid', 'seq'] });
          ms.createIndex('sid', 'sid', { unique:false });
        }
      };
      r.onsuccess = () => { this._db = r.result; res(this._db); };
      r.onerror = () => rej(r.error || new Error('打不开 ht-agent'));
    });
    return this._p;
  },

  _done(tx) {
    return new Promise((res, rej) => { tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  },

  async load(sid) {
    const db = await this.open();
    const tx = db.transaction(['sessions', 'messages'], 'readonly');
    const sreq = tx.objectStore('sessions').get(sid);
    const mreq = tx.objectStore('messages').index('sid').getAll(IDBKeyRange.only(sid));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    const sess = sreq.result || null;
    const rows = (mreq.result || []).sort((a, b) => a.seq - b.seq);
    const messages = [];
    for (const r of rows) messages.push(await unpackMsg(r));
    return { session: sess, messages };
  },

  async save(sid, messages, meta) {
    /* 两条 IDB 的硬规矩，踩过一次就不会再踩：
     * ①事务一旦没有挂起的请求就会自动提交，中间 await 一下（比如 packMsg 转图片）
     *   事务就关了，后面的 put/delete 全部 TransactionInactiveError；
     * ②所以：**先把数据准备好，再开事务，事务里只做同步调用**。 */
    const packed = [];
    for (const m of messages) packed.push(await packMsg(m));
    const db = await this.open();
    const oldKeys = await new Promise((res, rej) => {
      const tx = db.transaction('messages', 'readonly');
      const req = tx.objectStore('messages').index('sid').getAllKeys(IDBKeyRange.only(sid));
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction(['sessions', 'messages'], 'readwrite');
    const ms = tx.objectStore('messages');
    packed.forEach((m, i) => ms.put(Object.assign({}, m, { sid, seq:i, ts:m.ts || Date.now() })));
    for (const k of oldKeys) if (k[1] >= packed.length) ms.delete(k);
    const first = packed.find(m => m.role === 'user' && typeof m.content === 'string');
    tx.objectStore('sessions').put({
      id: sid,
      title: (meta && meta.title) || (first ? String(first.content).slice(0, 40) : '（空会话）'),
      createdAt: (meta && meta.createdAt) || Date.now(),
      updatedAt: Date.now(),
      model: (meta && meta.model) || '',
      mode: (meta && meta.mode) || 'main',
      msgCount: packed.length
    });
    await this._done(tx);
    return packed.length;
  },

  async list() {
    const db = await this.open();
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').getAll();
    await this._done(tx);
    return (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async remove(sid) {
    const db = await this.open();
    const oldKeys = await new Promise((res, rej) => {
      const tx = db.transaction('messages', 'readonly');
      const req = tx.objectStore('messages').index('sid').getAllKeys(IDBKeyRange.only(sid));
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction(['sessions', 'messages'], 'readwrite');
    tx.objectStore('sessions').delete(sid);
    const ms = tx.objectStore('messages');
    for (const k of oldKeys) ms.delete(k);
    await this._done(tx);
    return true;
  },

  async summary() {
    try {
      const rows = await this.list();
      const total = rows.reduce((n, r) => n + (r.msgCount || 0), 0);
      return { sessions: rows.length, messages: total, last: rows[0] || null };
    } catch (e) { return { sessions:0, messages:0, last:null }; }
  }
};

const dataUrlToBlob = (u) => fetch(u).then(r => r.blob());
function blobToDataUrl(b) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  });
}

/* 存之前：把大 dataURL 换成 Blob（结构化克隆可以直接存 Blob） */
async function packMsg(m) {
  const c = m && m.content;
  if (!Array.isArray(c)) return m;
  const parts = [];
  for (const p of c) {
    if (p && p.type === 'image_url' && p.image_url && /^data:/.test(String(p.image_url.url)) && String(p.image_url.url).length > 40000) {
      try { parts.push({ type:'image_url', image_url:{ blob: await dataUrlToBlob(p.image_url.url) }, __blob:true }); continue; }
      catch (e) { /* 转不了就照原样存，宁大勿丢 */ }
    }
    parts.push(p);
  }
  return Object.assign({}, m, { content: parts });
}

/* 读回来：Blob → dataURL。不认识的形状原样返回。 */
async function unpackMsg(m) {
  const c = m && m.content;
  if (!Array.isArray(c)) return m;
  const parts = [];
  for (const p of c) {
    if (p && p.__blob && p.image_url && p.image_url.blob instanceof Blob) {
      try {
        parts.push({ type:'image_url', image_url:{ url: await blobToDataUrl(p.image_url.blob) } });
        continue;
      } catch (e) {}
    }
    const q = Object.assign({}, p);
    delete q.__blob;
    parts.push(q);
  }
  return Object.assign({}, m, { content: parts });
}

/* 人格文件不通过工具改：它是用户的配置，不是智能体可以自己调参的地方。
 * 一次网页注入就能让它长期改掉自己的人设——这比一次写错文件危险得多。
 * 这只是软边界（js 工具仍能写），挡的是「顺手改」和「被诱导改」。 */
function isPersonaPath(p) {
  try { return normPath(String(p || '')) === AGENT_PERSONA_PATH; } catch (e) { return false; }
}

class AgentApp {
  constructor(container, opts, win) {
    this.el = container;
    this.win = win;
    this.opts = opts || {};
    this.messages = [];
    this.sid = this.sid || 'main';
    this.createdAt = Date.now();
    this._saveT = null;
    this.running = false;
    this.abort = null;
    this.onTitle = null;
    this._disposed = false;
    /* 生效中的人格文本（含注释）。callModel 每次请求前刷新，
     * 拼装时再剥注释——这里存原文是为了让调试时能看到「用户到底写了什么」。 */
    this._persona = AGENT_PERSONA_DEFAULT;
    /* 首次打开时把默认人格落盘；失败不影响对话（内存里还有默认） */
    ensureAgentPersonaFile();
    /* 待发送附件：{ name, mime, size, dataUrl?, text?, isImage } */
    this.attachments = [];
    /* 折叠卡的展开状态：key → 是否展开。重画（每步工具调用都会 render）后按它还原，
     * 否则用户刚点开的长结果，下一步回答一来就又合上了。 */
    this._foldState = new Map();

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
          <span class="ag-hint">工具直接执行，不问许可 · 对话存在 IndexedDB（ht-agent），刷新不丢</span>
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

    /* 折叠卡自己管开合，不依赖原生 <toggle>（它不冒泡、且重画时会乱），
     * 复制按钮直接取同一张卡里的 <pre> 原文。 */
    this.logEl.addEventListener('click', (e) => {
      const tgt = e.target;
      if (!tgt || !tgt.closest) return;
      const copyBtn = tgt.closest('.tb-copy');
      if (copyBtn) {
        const card = copyBtn.closest('details');
        const pre = card && card.querySelector('pre');
        ToolKit.copy(pre ? pre.textContent : '', '已复制全文');
        return;
      }
      const sum = tgt.closest('summary');
      if (!sum) return;
      const d = sum.parentElement;
      if (!d || d.tagName !== 'DETAILS') return;
      e.preventDefault();
      d.open = !d.open;
      if (d.dataset.k) this._foldState.set(d.dataset.k, d.open);
    });

    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.act('send'); }
    });
    this.attEl = $('.ag-att', this.el);
    this._bindAttach();
    this.renderStatus('idle');
    this.updateModelLabel();
    /* 记住这个 promise：send() 要等它，否则刚 push 的用户消息会被
     * 随后完成的 loadSession 覆盖掉（TUI 的 agent("…") 必踩这个坑）。 */
    this._loading = this.loadSession().catch(() => {});
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
      const paint = (e) => {
        const internal = hasInternalDrag(e);
        if (!internal && !_hasFiles(e)) return;
        e.preventDefault();
        zone.dataset.drop = internal ? '附加到对话' : '.queryfile（并附加到对话）';
        zone.classList.add('drop');
      };
      ['dragover', 'dragenter'].forEach(t => zone.addEventListener(t, paint));
      ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('drop'); }));
      zone.addEventListener('drop', async (e) => {
        /* 窗口之间拖过来的东西：文件管理器里的节点 / 浏览器标签。
         * 它们不是 File 对象，走不了 dataTransfer.files，得先从 spotfs 读出来。 */
        const items = DragBus.read(e.dataTransfer);
        if (items && items.length) {
          e.preventDefault();
          e.__htDropHandled = true;
          zone.classList.remove('drop');
          await this.addItems(items);
          DragBus.clear();
          return;
        }
        const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
        if (!files.length) return;
        e.__htDropHandled = true;      // 全局遮罩只管收，不再重复导入
        e.preventDefault();
        /* 先落盘到 .queryfile（这样 read_file 能读到、刷新不丢），再挂到对话上 */
        try {
          const paths = await importFiles(files, '.queryfile');
          if (paths.length) toast('已存入 ' + paths.length + ' 个文件到 .queryfile');
        } catch (err) { toast('存入失败：' + (err && err.message || err), true); }
        this.addFiles(files);
      });
    }
  }

  /* 窗口间拖拽进来的项（来自文件管理器或浏览器标签）。
   * 和 addFiles 的区别只有一个：内容不在 File 里，要先去 spotfs 读。 */
  async addItems(items) {
    for (const it of items || []) {
      if (this.attachments.length >= 6) { toast('一次最多 6 个附件', true); break; }
      try {
        if (it.kind === 'page') {
          const name = htmlFileName(it.name || 'page');
          const text = it.html ? String(it.html) : ('链接：' + (it.url || ''));
          if (text.length > 256 * 1024) { toast(name + ' 太大，先「保存」到文件系统再 read_file', true); continue; }
          this.attachments.push({ name, mime:'text/html', size:text.length, isImage:false, text });
          continue;
        }
        const st = await FS.stat(it.path);
        if (!st) { toast('文件不存在：' + it.path, true); continue; }
        if (st.kind === 'dir') { toast('目录不能当附件：' + it.path, true); continue; }
        const r = await FS.read(it.path);
        const mime = (r.meta && r.meta.mime) || '';
        const nm = spotExportName(baseName(it.path));
        if (/^image\//i.test(mime)) {
          const dataUrl = await contentToDataUrl(r.content, mime);
          if (!dataUrl || dataUrl.length > 5.6 * 1024 * 1024) { toast(nm + ' 超过 4MB，换小一点的图', true); continue; }
          this.attachments.push({ name:nm, mime, size:(dataUrl.length * 0.75) | 0, isImage:true, dataUrl });
        } else if (typeof r.content === 'string') {
          if (r.content.length > 256 * 1024) { toast(nm + ' 太大（>256KB），用 read_file 读它', true); continue; }
          this.attachments.push({ name:nm, mime:mime || 'text/plain', size:r.content.length, isImage:false, text:r.content });
        } else {
          toast(nm + ' 是二进制，先存到文件系统再用 read_file', true);
        }
      } catch (e) { toast('读取失败：' + ((it && it.path) || ''), true); }
    }
    this.renderAttachments();
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
    /* 会话主存是 IndexedDB 的 ht-agent 库；`.agent.session` 只是可导出的 JSONL 镜像。
     * 老版本把数据全放在后者里，所以这里做一次单向迁移，用户不会丢历史。 */
    this.sid = this.sid || 'main';
    let out = [];
    let at = 0;
    try {
      const r = await AgentStore.load(this.sid);
      if (r && r.messages && r.messages.length) {
        out = r.messages;
        at = (r.session && r.session.updatedAt) || 0;
      }
    } catch (e) { /* 隐私模式 / 没 IDB：退回到 JSONL 镜像 */ }
    if (!out.length) {
      try {
        const r = await FS.read('.agent.session');
        const lines = String(r.content || '').split('\n').map(x => x.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const m = JSON.parse(line);
            if (m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'system')) out.push(m);
          } catch (e) { /* 截断的行直接忽略——这正是 JSONL 的好处 */ }
        }
        if (out.length) {
          at = r.mtime || Date.now();
          AgentStore.save(this.sid, out, { createdAt:at }).catch(() => {});
        }
      } catch (e) { out = []; }
    }
    /* 恢复期间可能已经有新消息进来了（用户手快，或者 TUI 直接调用 send）：
     * 把恢复出来的放在前面，别把新的冲掉。 */
    this.messages = out.length ? out.concat(this.messages) : this.messages;
    this.createdAt = at || Date.now();
    /* 空会话的问候语也要存成字段：render() 会被 markdown 加载完再调一次，
     * 直接写 innerHTML 的版本会在那一次被冲成「空会话」（和 restoreNote 同一个坑）。 */
    this.welcomeHtml = '';
    if (!this.messages.length) {
      const direct = Settings.get('agentMode') === 'direct';
      const where = direct
        ? `直连 ${esc(Settings.get('agentDirectUrl') || 'https://api.deepseek.com')} · 密钥在本机（仅测试用）`
        : `后端 ${esc(Settings.get('agentUrl') || '未配置')} · 密钥只在后端`;
      this.welcomeHtml = `<div class="msg sys">HarTMLes · 单会话智能体 · ${where} · 模型 ${esc(Settings.get('agentModel') || 'deepseek-flash')}</div>
        <div class="msg assistant"><span class="role">agent</span>你好。我是 HarTMLes。我可以直接读写这个终端的文件、执行 JS、开窗口。试试让我“看看 .home 里有什么，并写一个 hello 函数”。</div>`;
    } else {
      /* 必须明说「这是恢复的」：不然用户会以为是上一次自己刚说的话，怀疑没刷新。 */
      const when = at ? new Date(at).toLocaleString('zh-CN') : '未知时间';
      this.restoreNote = `已恢复 ${this.messages.length} 条消息（最后更新 ${when}）· 存在 IndexedDB「ht-agent」`;
    }
    this.render();
  }

  sessionJsonl() {
    return this.messages.map(m => JSON.stringify(m)).join('\n') + (this.messages.length ? '\n' : '');
  }

  /* 写盘分两种时机：
   *   流式输出/每步工具调用 → saveSession() 只排一个 800ms 的防抖
   *   一轮结束 / 清空 / 导入  → flushSession() 立即写
   * 以前每个 token 都全量重写一遍 JSONL，主线程能被拖到掉帧。 */
  saveSession() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => { this.flushSession(); }, 800);
  }

  async flushSession() {
    clearTimeout(this._saveT);
    const snapshot = this.messages.slice();
    try {
      await AgentStore.save(this.sid || 'main', snapshot, {
        createdAt: this.createdAt,
        model: Settings.get('agentModel') || ''
      });
    } catch (e) { /* 配额满 / 隐私模式：会话照常能用，只是不落盘 */ }
    try {
      await FS.write('.agent.session', this.sessionJsonl(), { mime:'application/x-ndjson', hint:'智能体会话' });
    } catch (e) {}
  }

  /* ------------------------------------------------------------- 折叠卡
   * 工具返回值和工具调用参数都可能很长。以前返回值固定塞进 180px 的框里、
   * 超出部分根本看不到，参数则被 slice(0, 300) 直接切掉——用户想核对一眼
   * 「JS 到底返回了什么」只能去翻会话 JSONL。
   * 现在统一成「一行摘要 + 点开全文」：key 用 tool_call_id（稳定、不会因为
   * 消息追加而错位），展开状态记在 _foldState 里，重画不会把它合上。 */
  _foldOpen(key, text, defOpen) {
    if (this._foldState.has(key)) return this._foldState.get(key);
    if (defOpen != null) return defOpen;
    /* 短结果默认展开：本来就是一眼看完的内容，不该因为能折叠而多点一下 */
    return text.length <= 400 && text.split('\n').length <= 8;
  }

  _foldCard(key, label, text, note) {
    const t = String(text == null ? '' : text);
    const lines = t ? t.split('\n').length : 0;
    const firstLine = (t.split('\n').find(l => l.trim()) || '').replace(/\s+/g, ' ').trim();
    const more = t.length > 0 && (lines > 1 || firstLine.length > 96);
    const preview = (firstLine.slice(0, 96) || '（空）') + (more ? ' …' : '');
    const meta = !t ? '空' : (lines > 1 ? lines + ' 行 · ' : '') + t.length + ' 字';
    const open = this._foldOpen(key, t);
    return `<details class="msg tool" data-k="${esc(key)}"${open ? ' open' : ''}>`
      + `<summary><span class="tt">${esc(label)}</span><span class="tv">${esc(preview)}</span>`
      + `<span class="tm">${esc(meta)}</span></summary>`
      + `<div class="tb"><div class="tb-bar"><span>${esc(note || '完整内容')}</span><span class="grow"></span>`
      + `<button class="tb-copy" data-copy title="复制全文">复制</button></div>`
      + `<pre>${esc(t)}</pre></div></details>`;
  }

  /* 工具调用参数：短的照旧一行显示（以前就是这样），长的才折叠 */
  _callChip(t, i) {
    const nm = (t && t.function && t.function.name) || '?';
    const raw = String((t && t.function && t.function.arguments) || '');
    let pretty = raw;
    try { pretty = JSON.stringify(JSON.parse(raw), null, 1); } catch (e) { /* 非法 JSON 原样显示 */ }
    const oneLine = pretty.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= 220) {
      return `<div class="tc-line">→ ${esc(nm)} ${esc(oneLine)}</div>`;
    }
    const key = 'a:' + ((t && t.id) || (nm + ':' + i));
    const open = this._foldOpen(key, pretty, false);
    /* 摘要里不再重复画一个「→」：前面已经有 ▸/▾ 这个开合标志，
     * 两个箭头并排只会让人分不清哪个能点。 */
    return `<details class="tc" data-k="${esc(key)}"${open ? ' open' : ''}>`
      + `<summary><span class="tc-name">${esc(nm)}</span>`
      + `<span class="tc-a">${esc(oneLine.slice(0, 160))} …</span>`
      + `<span class="tc-n">${esc(pretty.length + ' 字')}</span></summary><pre>${esc(pretty)}</pre></details>`;
  }

  render() {
    if (!this.logEl) return;
    const msgs = this.messages.slice(-200);
    /* 绝对序号：消息只追加，用它兜底生成 key，老的卡不会因为窗口滑动而换身份 */
    const base = this.messages.length - msgs.length;
    let html = this.restoreNote ? `<div class="msg sys">${esc(this.restoreNote)}</div>` : '';
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === 'user') {
        /* content 可能是多模态数组：渲染时优先用 display 字段（发送前已拍平） */
        const shown = m.display != null ? m.display
          : (Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') + '\n[图片]' : m.content);
        html += `<div class="msg user"><span class="role">you</span>${esc(shown || '')}</div>`;
      } else if (m.role === 'assistant') {
        const body = m.content ? mdToHtml(m.content) : '';
        const tc = (m.tool_calls || []).map((t, j) => this._callChip(t, j)).join('');
        if (body || tc) html += `<div class="msg assistant"><span class="role">agent</span>${body}${tc}</div>`;
      } else if (m.role === 'system') {
        html += `<div class="msg sys">${esc(m.content || '')}</div>`;
      } else if (m.role === 'tool') {
        const raw = Array.isArray(m.content)
          ? m.content.map(p => p.type === 'text' ? p.text : '[图片 ' + Math.round(String(p.image_url && p.image_url.url || '').length * 0.75 / 1024) + ' KB]').join('\n')
          : String(m.content || '');
        const key = 't:' + (m.tool_call_id || ('i' + (base + i)));
        html += this._foldCard(key, m.name || 'tool', raw, '工具返回');
      } else if (m.role === 'error') {
        html += `<div class="msg error">${esc(m.content || '')}</div>`;
      }
    }
    this.logEl.innerHTML = html || this.welcomeHtml || '<div class="msg sys">空会话</div>';
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
      if (this.running) return;
      /* 只贴了图片、一个字没写，也是一条合法消息：多模态模型完全能处理。
       * 以前这里 `!text` 就直接 return，图片被静默吞掉。 */
      if (!text && !this.attachments.length) return;
      this.ta.value = '';
      await this.send(text);
    } else if (a === 'stop') {
      this.running = false;
      try { this.abort && this.abort.abort(); } catch (e) {}
      this.renderStatus('idle', 'stopped');
      toast('已请求停止');
    } else if (a === 'clear') {
      if (!(await confirmDlg('清空会话', '会删除这个会话的全部消息（IndexedDB「ht-agent」）与 <span class="code">.agent.session</span> 镜像，不可撤销。', true))) return;
      this.messages = [];
      try { await AgentStore.remove(this.sid || 'main'); } catch (e) {}
      await this.flushSession();
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
      await this.flushSession();
      this.render();
      toast('已导入 ' + out.length + ' 条消息');
    } else if (a === 'settings') {
      Drawer.open('agent');
    }
  }

  async send(text) {
    if (this.running) return;
    /* 等会话恢复完成再 push：见构造函数里的 _loading。 */
    if (this._loading) { try { await this._loading; } catch (e) {} }
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
    this.render(); await this.flushSession();
    try { await this.run(); }
    catch (e) { this.pushError(e); }
    finally { this.running = false; this.renderStatus('idle'); await this.flushSession(); }
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
    const out = [{ role:'system', content: agentSystemPrompt(this._persona) }];
    const keepReasoning = Settings.get('agentMode') === 'direct' &&
      /deepseek/i.test(String(Settings.get('agentDirectUrl') || ''));

    /* 先建立 call_id → tool 结果 的索引；后出现的覆盖先出现的（重试场景）。 */
    const toolByCall = new Map();
    for (const m of this.messages) {
      if (m.role === 'tool' && m.tool_call_id) toolByCall.set(m.tool_call_id, m);
    }
    const usedCalls = new Set();

    for (const m of this.messages) {
      if (m.role === 'error' || m.role === 'tool' || m.role === 'system') continue;   // tool 在下面跟着 assistant 一起发；system 备注只给用户看，不进请求

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
    /* 每次请求前刷新人格（内部有 1.2 秒缓存，一轮多步不会反复读盘）。
     * 放在这里而不是 send()：会话中途用户改了人格，下一步就能生效。 */
    try { const p = await loadAgentPersona(); this._persona = p.text; } catch (e) {}
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
      /* file:// 页面要先拿到令牌：Origin 是 null，与公网页里的 sandbox iframe
       * 在后端看来完全一样，只能靠令牌自证。 */
      if (!(await ensureFileToken('发消息需要后端的访问令牌。'))) {
        throw new Error('没有访问令牌，后端不会接受 file:// 页面的请求。'
          + '令牌在启动后端的终端横幅里；也可以改用 http://127.0.0.1:8787/ 打开（同源，不需要令牌）。');
      }
      const base = String(Settings.get('agentUrl') || '').replace(/\/+$/, '');
      if (!base) throw new Error('未配置后端地址。请先启动 modelserver，并在「更多 → 智能体」里填写地址。');
      endpoint = base + '/v1/chat/completions';
      label = base.replace(/^https?:\/\//, '');
      headers = {
        'Content-Type':'application/json',
        'X-HTerm-Provider': Settings.get('agentProvider') || 'openai',
        'X-HTerm-Client':'HTerMinaL',
        ...FileToken.header()
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
    /* 重复生成防护：连续 N 次输出相同签名（工具调用或文本）→ 卡断本轮并自动追问。
     * 见 _injectRepeatNudge()。阈值取 3：前两次视为正常重试，第三次才判定“卡住”。 */
    const REPEAT_LIMIT = 3;
    let lastSig = null, repeatCount = 0;

    /* —— 收敛护栏（0.0.1.31）——
     * 参考 SWE-agent / seekHarness 的做法：光有「最大步数」不够，模型会在预算内
     * 一直 edit → run → edit。这里补三条更早的刹车：
     *   1. 观察停滞：连续两步拿到完全一样的工具结果 → 要么任务已完成，要么卡死；
     *   2. JS 连续失败 4 次 → 它在和解释器较劲，强行收手交给用户；
     *   3. 单轮时间预算 8 分钟。 */
    const startedAt = performance.now();
    const TIME_BUDGET = 8 * 60 * 1000;
    let obsKey = '', sameObs = 1, jsFails = 0, nudges = 0;
    let stopReason = '';

    while (this.running && steps < maxSteps && !stopReason) {
      if (performance.now() - startedAt > TIME_BUDGET) { stopReason = 'time'; break; }
      steps++;
      this.renderStatus('thinking', 'thinking · step ' + steps);
      const msg = await this.callModel();
      if (!this.running) { this._pushAssistant(msg, true); break; }
      this._pushAssistant(msg, false);
      this.render(); await this.saveSession();

      /* —— 重复生成防护 ——
       * 算这一轮“输出签名”：连续三次签名相同，判定智能体陷入重复循环。
       * 这时不再执行这一轮的动作，而是自动向它追问一句“是否卡住、请检查”，
       * 然后让它继续。但追问最多两次：第三次还重复，就说明追问也没用，
       * 继续跑只是烧 token —— 直接停，把现场交给用户。 */
      const sig = this._turnSig(msg);
      if (sig && sig === lastSig) repeatCount++;
      else { lastSig = sig; repeatCount = 1; }
      if (repeatCount >= REPEAT_LIMIT) {
        if (nudges >= 2) { stopReason = 'repeat'; break; }
        nudges++;
        this._injectRepeatNudge(sig);
        lastSig = null; repeatCount = 0;
        this.render(); await this.saveSession();
        continue;
      }

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

          /* 单条结果最多 14000 字符进会话（上下文保护）。截断必须说出来：
           * 静默 slice 会让模型和用户都以为「这就是全部」。 */
          const CLIP = 14000;
          const rawResult = Array.isArray(result) ? result : String(result == null ? '' : result);
          const body = Array.isArray(result) ? result
            : (rawResult.length > CLIP
                ? rawResult.slice(0, CLIP) + '\n…（结果过长已截断：原 ' + rawResult.length + ' 字符，这里保留前 ' + CLIP + ' 字符）'
                : rawResult);
          const tmsg = { role:'tool', tool_call_id:tc.id, name, content:body };
          this.messages.push(tmsg);
          this.render(); await this.saveSession();

          /* --- 刹车 1：观察停滞 --- */
          const key = name + '|' + (typeof body === 'string' ? body.slice(0, 600) : stableKey(body));
          if (key === obsKey) sameObs++;
          else { obsKey = key; sameObs = 1; }
          if (sameObs >= 2) { stopReason = 'stalled'; break; }

          /* --- 刹车 2：一直和 JS 解释器较劲 --- */
          if (name === 'js') {
            if (/^(工具错误：|错误)/.test(String(body))) jsFails++;
            else jsFails = 0;
            if (jsFails >= 4) { stopReason = 'jsfail'; break; }
          } else {
            jsFails = 0;
          }
        }
        if (stopReason) break;
        continue;
      }
      break;
    }

    const REASON = {
      time: '单轮执行超过 8 分钟，已自动停止。任务没做完可以继续发一条消息接着做。',
      stalled: '连续两步得到完全相同的工具结果，判断任务已完成或已卡住，已自动停止。',
      repeat: '连续多次输出相同内容，自动追问两次仍未改变，已停止本轮。',
      jsfail: '连续 4 次 JS 执行失败，已停止本轮——它在和解释器较劲，继续重试只会浪费 token。'
    };
    if (stopReason) {
      this.messages.push({ role:'error', content:'⏹ ' + REASON[stopReason] });
      this.render();
    } else if (steps >= maxSteps) {
      this.messages.push({ role:'error', content:'已达到最大步数 (' + maxSteps + ')，循环停止。可在「更多 → 智能体 → 最大步数」里调高。' });
      this.render();
    }
    this.running = false;
    this.renderStatus('idle');
  }

  /* 输出签名：把“这一轮智能体到底干了什么”压成一个可比较的字符串。
   * 带工具调用 → 工具名+参数指纹；纯文本 → 正文前若干字符（长输出只比前缀，
   * 末尾差异极少见，且真要判重也该比整体结构）。两次签名相同即视为“同一输出”。 */
  _turnSig(msg) {
    if (msg && msg.tool_calls && msg.tool_calls.length) {
      const tc = msg.tool_calls
        .filter(t => t && t.function && t.function.name)
        .map(t => {
          let a = '{}';
          try { a = stableKey(JSON.parse(t.function.arguments || '{}')); }
          catch (e) { a = stableKey(String(t.function.arguments || '')); }
          return t.function.name + '(' + a + ')';
        }).join('|');
      return 'TC:' + tc;
    }
    return 'TX:' + String((msg && msg.content) || '').slice(0, 400);
  }

  /* 重复循环触发：在日志里记一条系统备注，并自动以“用户”身份向智能体追问一句，
   * 让它自行检查是否卡住。追问以 user 角色进会话（apiMessages 会正常发送）；
   * system 备注只给用户看（渲染成 sys 样式，但不进发给模型的请求）。 */
  _injectRepeatNudge(sig) {
    const note = '⚠ 检测到连续 3 次输出相同内容（工具调用或文本），已自动向智能体追问以检查是否卡住。';
    this.messages.push({ role:'system', content:note });
    const prompt = '【自动检查】你已连续 3 次输出基本相同的内容（同一工具相同参数，或同一段文本），'
      + '疑似陷入重复循环。请先停下：对照已有结果，确认任务是否已完成、是否忽略了某些报错或缺失信息。'
      + '若已完成，请用简短中文总结结果；若仍需要新信息，请改用不同的参数或换一个工具，不要重复刚才完全相同的动作。';
    this.messages.push({ role:'user', content:prompt, display:'[自动追问] ' + prompt.slice(0, 60) + '…' });
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
      /* 与 JSHeL 共用同一个求值器（build/21-shared.js）：
       * 同样的代码必须得到同样的值——包括 `const a=1; a+1` 回显 2、
       * DOM 节点显示成 `<div#toast>` 而不是 `{}`。
       * 这里不复制一份「差不多」的实现，就是为了不再出现两套语义。 */
      const v = await HTScript.run(code);
      return HTScript.describe(v);
    }
    if (name === 'read_file') {
      const r = await FS.read(args.path);
      if (r.content instanceof ArrayBuffer || r.content instanceof Blob) return '[二进制文件] ' + fmtBytes(r.content.size || r.content.byteLength || 0);
      return jsonSafe(String(r.content == null ? '' : r.content));
    }
    if (name === 'write_file') {
      if (isPersonaPath(args.path)) throw new Error('这个人格配置文件只由用户改：请让用户在终端执行 persona edit，或直接编辑 ' + AGENT_PERSONA_PATH);
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
      if (isPersonaPath(args.path)) throw new Error('这个人格配置文件只由用户改：请让用户在终端执行 persona reset');
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
    if (name === 'news') {
      return await agentNews(args);
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
    /* 关窗就是「这一轮到此为止」：必须立刻落盘，不能等防抖（页面可能马上就关了） */
    this.flushSession().catch(() => {});
  }
}
