/* ============================================================================
 * HTerMinaL · core
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。设置、IndexedDB 文件系统、虚拟目录、UI 原子件。
 * ==========================================================================*/
'use strict';

const HT_VERSION = '0.0.1.36';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
const uid = (p) => (p || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
const SVG_ICONS = {
  term:'<path d="M4 6l5 5-5 5"/><path d="M12 17h8"/>',
  browser:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.6 3.6 5.4 3.6 8S14.5 17.4 12 20c-2.5-2.6-3.6-5.4-3.6-8S9.5 6.6 12 4z"/>',
  files:'<path d="M3.5 7.5h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19V7.5z"/><path d="M3.5 7.5V5.8A1.3 1.3 0 0 1 4.8 4.5h4l2 2"/>',
  agent:'<path d="M12 3.5l1.7 5.1 5.1 1.7-5.1 1.7L12 17.1l-1.7-5.1-5.1-1.7 5.1-1.7L12 3.5z"/><path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z"/>',
  more:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  python:'<path d="M12 3.5c-3 0-4 1-4 3v2h5v1H7c-2 0-3 1.2-3 3.5S5 16.5 7 16.5h1V15c0-2 1-3 3-3h4c2 0 3-1 3-3V6.5c0-2-1.5-3-6-3z"/><circle cx="9.8" cy="6.2" r=".7" fill="currentColor" stroke="none"/><path d="M12 20.5c3 0 4-1 4-3v-2h-5v-1h6c2 0 3-1.2 3-3.5" opacity=".55"/>',
  editor:'<path d="M5 19l2-6 9-9 3 3-9 9-5 3z"/><path d="M13.5 6.5l3 3"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  about:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".8" fill="currentColor" stroke="none"/>'
};
function svgIcon(name, cls) {
  return `<svg class="${cls || 'ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SVG_ICONS[name] || SVG_ICONS.term}</svg>`;
}

/* ---------------------------------------------------------------- 设置 */
const Settings = {
  DEFAULTS: {
    /* 光标形态与闪烁不提供设置：固定照参考项目那套（竖线 / 失焦椭圆 / 备用屏虚线 / 空闲呼吸）。
     * 背景网格也不提供设置，固定开着（很淡，只为看清桌面边界）。
     * rows = 固定显示行数，0 表示自动铺满。 */
    font: 14, lineHeight: 12, rows: 0,
    dockHidden: 0,
    /* dockFold = 用户手动把 Dock 折成一颗药丸（和 dockHidden 不同：
     * 折叠只是收起来，随时能点药丸展开；隐藏是彻底不要 Dock） */
    dockFold: 0,
    cdn: 'esm.sh',
    /* 智能体：backend = 经本地 modelserver 转发（密钥在服务端）；
     * direct = 浏览器直连 OpenAI 兼容服务，密钥存在本机 localStorage（有风险，见设置页警告）。 */
    agentMode: 'backend',
    agentUrl: 'http://127.0.0.1:8787',
    agentDirectUrl: 'https://api.deepseek.com',
    agentKey: '',
    agentProvider: 'openai', agentModel: 'deepseek-flash',
    /* 直连时的深度思考：默认关。DeepSeek 默认开启思考模式，
     * 响应先吐 reasoning_content 再吐 content，测试时又慢又费 token；
     * 关掉后 temperature 才有意义。需要推理时在设置里打开（会正确回传 reasoning_content）。 */
    agentThinking: '0',
    agentSteps: 120, historyLimit: 500
  },
  /* 只在内存里、永不落盘的键（API Key 属于这一类） */
  VOLATILE: ['agentKey'],
  data: {},
  load() {
    try {
      const raw = localStorage.getItem('ht.settings');
      this.data = Object.assign({}, this.DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (e) { this.data = Object.assign({}, this.DEFAULTS); }
    /* 历史遗留版本可能把密钥存进来过：加载时一律丢弃 */
    for (const x of this.VOLATILE) this.data[x] = this.DEFAULTS[x];
    /* 老版本把默认模型写成了 gpt-4o-mini 并落进 localStorage，导致用户升级后
     * 打开直连还在问 GPT。这里做一次无痛迁移：只有「从没改过」的旧默认值才替换。 */
    if (this.data.agentModel === 'gpt-4o-mini') {
      this.data.agentModel = this.DEFAULTS.agentModel;
      try { localStorage.setItem('ht.settings', JSON.stringify(this._persisted())); } catch (e) {}
    }
    return this.data;
  },
  get(k) { return this.data[k] !== undefined ? this.data[k] : this.DEFAULTS[k]; },
  set(k, v) {
    this.data[k] = v;
    /* 直连密钥只在内存：不写 localStorage，也不写 .config.settings。刷新即消失。 */
    const volatile = this.VOLATILE.includes(k);
    if (!volatile) {
      try {
        const keep = Object.assign({}, this.data);
        for (const x of this.VOLATILE) delete keep[x];
        localStorage.setItem('ht.settings', JSON.stringify(keep));
      } catch (e) {}
      FS.write('.config.settings', JSON.stringify(this._persisted(), null, 2), { kind:'object', mime:'application/json' }).catch(() => {});
    }
    if (k === 'font' || k === 'lineHeight' || k === 'rows') {
      if (typeof TerminalManager !== 'undefined') TerminalManager.applyAll();
    }
    return v;
  },
  _persisted() {
    const o = Object.assign({}, this.data);
    for (const x of this.VOLATILE) delete o[x];
    return o;
  },
  all() { return Object.assign({}, this.data); }
};

/* ---------------------------------------------------------------- 主题（跟随系统）
 * 不提供手动开关：设置里只有一行只读的「主题」，值随系统变。
 * 监听 prefers-color-scheme，系统切深浅时整页（含 xterm）一起换。 */
function systemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch (e) { return 'dark'; }
}
function applyTheme() {
  const t = systemTheme();
  const light = t === 'light';
  document.body.classList.toggle('light', light);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  const st = document.getElementById('stTheme');
  if (st) st.textContent = light ? '浅色（随系统）' : '深色（随系统）';
  if (typeof TerminalManager !== 'undefined') TerminalManager.applyTheme(t);
}
function watchSystemTheme() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const on = () => applyTheme();
  if (mq.addEventListener) mq.addEventListener('change', on);
  else if (mq.addListener) mq.addListener(on);   // Safari < 14
}
/* 背景网格固定开着：很淡的一层，只为让人看得出桌面边界，不给设置项。 */
function applyGrid() {
  document.body.classList.remove('nogrid');
}

/* ---------------------------------------------------------------- Toast */
let toastTimer = null;
function toast(msg, bad) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ---------------------------------------------------------------- Dialog
 * 全应用统一的一套对话框（见 CSS 里的设计说明）：
 *   title 居中、body 自由、底部左取消右确认；卡片下挂一个「?」把手，
 *   两端圆钮 = 取消 / 确认。文字与圆钮是同一动作的两个热区。
 *
 * 为什么要重写而不是加个新函数：项目里 11 处弹框全走 modal()，
 * 只有一套实现才能真正统一；换皮不换接口，调用点不用改。
 * 浏览器自己的 alert/confirm/prompt 不受影响，也绝不替换 —— 那不属于「应用内」。
 */
const DLG_ICON = {
  slash:'<circle cx="12" cy="12" r="8.6"/><path d="M5.9 18.1L18.1 5.9"/>',
  trash:'<path d="M4 7h16"/><path d="M9.5 6.8V4.6h5v2.2"/><path d="M6.6 7l.85 12.1h9.1L17.4 7"/><path d="M10.1 10.4v6M13.9 10.4v6"/>',
  arrow:'<path d="M3.8 12h15.4"/><path d="M13.4 6.2L19.2 12l-5.8 5.8"/>',
  check:'<path d="M4.6 12.6l4.7 4.7L19.4 7.1"/>'
};
function dlgIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round">${DLG_ICON[name] || DLG_ICON.check}</svg>`;
}
function modal(opts) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    if (!root) { resolve(null); return; }
    const buttons = opts.buttons || [{ label:'确定', primary:true, value:true }];
    const two = buttons.length > 1;
    const okB = two ? buttons[buttons.length - 1] : buttons[0];
    const cancelB = two ? buttons[0] : null;
    /* 类型决定标题颜色、圆钮图标与颜色：
     *   danger 危险操作（删除/清空）→ 红标题 + 垃圾桶
     *   ask    输入确认              → 绿色右箭头
     *   ok     普通确认              → 绿色对勾
     *   info   单按钮提醒            → 不画把手（没有「要不要」的问题） */
    const kind = opts.kind || (!two ? 'info'
      : (okB && okB.danger) ? 'danger'
      : /<(input|textarea|select)\b/i.test(opts.body || '') ? 'ask' : 'ok');
    const okIcon = kind === 'danger' ? 'trash' : kind === 'ask' ? 'arrow' : 'check';

    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="dlg-stage">
      <div class="modal dlg-card ${kind}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || '对话框')}">
        <h3 class="dlg-title">${esc(opts.title || '')}</h3>
        <div class="mbody dlg-body">${opts.body || ''}</div>
        <div class="mfoot"></div>
      </div>
      ${two ? `<div class="dlg-handle">
        <button type="button" class="dlg-orb cancel" title="取消（Esc）" aria-label="取消">${dlgIcon('slash')}</button>
        <div class="dlg-trap" aria-hidden="true"><span>?</span></div>
        <button type="button" class="dlg-orb ${kind === 'danger' ? 'danger' : 'ok'}"
          title="${esc(okB.label)}" aria-label="${esc(okB.label)}">${dlgIcon(okIcon)}</button>
      </div>` : ''}
    </div>`;

    const foot = $('.mfoot', wrap);
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(v);
    };
    /* 蒙层 = 取消。点卡片或把手不关（把手上的「?」是装饰，也不关）。 */
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) close(cancelB ? cancelB.value : null);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelB ? cancelB.value : null); }
    };
    window.addEventListener('keydown', onKey, true);

    const mkBtn = (b, isOk) => {
      const el = document.createElement('button');
      el.type = 'button';
      /* 保留 btn / primary / danger 这三个老类名：别处的 Enter 快捷键靠
       * querySelector('.mfoot .btn.primary') 找确认键。 */
      el.className = 'btn' + (isOk ? ' dlg-ok primary' : ' dlg-cancel') + (b.danger ? ' danger' : '') + (two ? '' : ' solo');
      el.textContent = b.label;
      el.onclick = async () => {
        if (b.onClick) {
          const r = await b.onClick(wrap);
          if (r === false) return;
          close(r === undefined ? b.value : r);
        } else close(b.value);
      };
      return el;
    };
    buttons.forEach((b, i) => foot.appendChild(mkBtn(b, i === buttons.length - 1)));
    const okEl = $('.dlg-ok', foot);
    const cancelEl = $('.dlg-cancel', foot);
    /* 两个圆钮直接点对应文字按钮：这样 onClick 里的校验（比如「名字不能为空」）
     * 只有一份实现，圆钮不会绕过它。 */
    const orbCancel = $('.dlg-orb.cancel', wrap);
    const orbOk = $('.dlg-orb.ok, .dlg-orb.danger', wrap);
    if (orbCancel && cancelEl) orbCancel.onclick = () => cancelEl.click();
    if (orbOk && okEl) orbOk.onclick = () => okEl.click();

    if (opts.onMount) opts.onMount(wrap, close);
    root.appendChild(wrap);
    const inp = $('input,textarea', wrap);
    if (inp) setTimeout(() => inp.focus(), 30);
  });
}
function confirmDlg(title, text, danger) {
  return modal({
    title,
    body: `<div style="line-height:1.75">${text}</div>`,
    buttons: [{ label:'取消', value:false }, { label:'确认', value:true, primary:!danger, danger }]
  });
}

/* ---------------------------------------------------------------- 本地文件模式
 * 双击 index.html 打开时，页面是 file:// 源，浏览器把它的 Origin 标成 "null"——
 * 与公网页里的 <iframe sandbox> 逐字节相同（Origin: null / Sec-Fetch-Site:
 * cross-site / 无 Referer）。后端无法在头里区分这两者，所以要求出示令牌：
 * 令牌由后端启动时随机生成，打印在终端横幅里，只有看着终端的人拿得到。
 *
 * 存 sessionStorage 而不是 localStorage：实测 file:// 的 localStorage 是
 * 所有本地文件共享的，存在那儿等于把「双击任何一个下载的 HTML」也变成有权限。
 * sessionStorage 是标签页级的，关掉就没了。 */
const FileToken = {
  KEY: 'ht.fileToken',
  get() { try { return sessionStorage.getItem(this.KEY) || ''; } catch (e) { return ''; } },
  set(v) {
    try { v ? sessionStorage.setItem(this.KEY, v) : sessionStorage.removeItem(this.KEY); } catch (e) {}
  },
  /* 只有 file:// 才需要令牌；http://127.0.0.1:8787/ 打开是同源，不需要 */
  active() { return location.protocol === 'file:'; },
  header() {
    const t = this.get();
    return (this.active() && t) ? { 'X-HTerm-Token': t } : {};
  },
};

function askFileToken(reason) {
  return modal({
    title: '本地文件模式：需要访问令牌',
    body: `<div style="line-height:1.75">
      <p>${esc(reason || '这个页面是双击 index.html 打开的（file://）。')}</p>
      <p>浏览器的安全模型把它和「公网页里的沙箱 iframe」当成同一种东西——后端在请求头里
         看不到任何区别，所以只能请你出示令牌。</p>
      <p>在<b>启动后端的终端</b>里找 <code>file://</code> 开头那一行，把后面的字符串粘进来。
         每次重启后端会换一个新的。</p>
      <input id="fileTokInp" placeholder="粘贴令牌" autocomplete="off" spellcheck="false"
             style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--line);
                    background:var(--bg);color:var(--fg);font:inherit">
      <p style="margin-top:10px;color:var(--fg-mute);font-size:12px">
         不想每次粘贴的话，改用 <code>http://127.0.0.1:8787/</code> 打开——同源，不需要令牌。</p>
    </div>`,
    buttons: [
      { label:'取消', value:null },
      { label:'保存', primary:true, onClick: (w) => {
          const v = (($('#fileTokInp', w) || {}).value || '').trim();
          if (!v) return false;
          FileToken.set(v);
          return true;
        } }
    ],
  });
}

/* 需要时弹一次输入框。返回 false 表示用户放弃——调用方据此走「说清楚为什么不行」。 */
async function ensureFileToken(reason) {
  if (!FileToken.active() || FileToken.get()) return true;
  return (await askFileToken(reason)) === true;
}

/* ---------------------------------------------------------------- 路径规则
 * 分隔符是 `.`，根是 `.`；每一段必须像标识符：字母/中文开头，后续字母数字 _ -。
 * 不区分大小写 —— 内部一律小写存储。 */
const SEG_RE = /^[\p{L}][\p{L}\p{N}_-]{0,63}$/u;
/* spot 转义名：-xx 打头，后面是「字面字母数字」或「-HH」的重复。
 * 它本来就不像标识符，必须放行，否则拖进来的文件根本写不进去。 */
const SPOT_NAME_RE = /^-[xX]{2}(?:[A-Za-z0-9]|-[0-9A-Fa-f]{2})+$/;
const RESERVED = new Set(['', '.', '..']);
function normPath(p, cwd) {
  cwd = cwd || '.home';
  if (p === undefined || p === null || String(p).trim() === '') return cwd;
  let s = String(p).trim().replace(/\\/g, '/');
  if (!s) return cwd;
  if (s === '/' || s === '.') return '.';

  /* 路径方言（模仿 Linux 终端，底层仍是点分扁平结构）：
   *   /            根                 /home/notes = .home.notes
   *   ~            .home
   *   @            当前目录           @、@/notes、@.notes
   *   ..           上一级             ../x
   *   "/" 与 "." 都是分隔符，反斜杠也当分隔符。
   */
  const cwdSegs = cwd === '.' ? [] : cwd.slice(1).split('.');
  let base, rest;
  if (s === '~' || s.startsWith('~/') || s.startsWith('~.')) {
    base = []; rest = 'home/' + s.replace(/^~[\/.]?/, '');
  } else if (s.startsWith('@')) {
    /* @ 方言（JSHeL 路径简写，用户要求）：
     *   开头连续 @ 的个数决定「上溯几层」：1 个=当前目录，2 个=父目录，3 个=祖父目录……
     *   其余部分按 / 或 . 当作分隔符接在后面。
     *   @        = 当前目录          @a      = 当前目录下的 a
     *   @@       = 父目录            @a.b    = 当前目录/a/b
     *   @@@      = 祖父目录          @@a     = 父目录下的 a
     * 旧实现把第二个 @ 当成“路径中间的 @=当前目录锚点”，导致 @@ 被解析成当前目录，不符预期。 */
    let n = 0;
    while (s[n] === '@') n++;
    const tail = s.slice(n);
    const segs = cwdSegs.slice();
    for (let i = 0; i < n - 1; i++) segs.pop();
    base = segs;
    rest = tail;
  } else if (s.startsWith('/')) {
    base = []; rest = s.slice(1);
  } else if (s.startsWith('..')) {
    base = cwdSegs.slice(); rest = s;
  } else if (s.startsWith('.')) {
    base = []; rest = s.replace(/^\.+/, '');
  } else {
    base = cwdSegs.slice(); rest = s;
  }

  const out = base.slice();
  /* ".." 里含点，直接 split 会被当成分隔符吃掉，先换成占位符 */
  rest = rest.replace(/\.\./g, '\u0001');
  for (const seg of rest.split(/[\/.]+/)) {
    if (!seg) continue;
    if (seg === '\u0001') { out.pop(); continue; }
    if (seg === '~') { out.length = 0; out.push('home'); continue; }
    /* 路径中间出现的 @ 代表「当前目录」这个绝对位置 */
    if (seg === '@') { out.length = 0; out.push(...cwdSegs); continue; }
    out.push(seg);
  }
  return (out.length ? '.' + out.join('.') : '.').toLowerCase();
}
function pathSegs(p) { return p === '.' ? [] : p.slice(1).split('.'); }
function parentPath(p) {
  const s = pathSegs(p);
  s.pop();
  return s.length ? '.' + s.join('.') : '.';
}
function baseName(p) {
  const s = pathSegs(p);
  return s.length ? s[s.length - 1] : '.';
}
function checkName(name) {
  const n = String(name || '').trim();
  if (SPOT_NAME_RE.test(n)) return n.length > 240 ? '名称太长（转义名最多 240）' : null;
  if (!SEG_RE.test(n)) return '名称必须以字母或中文开头，只能包含字母、中文、数字、下划线、短横线';
  if (n.length > 64) return '名称太长（最多 64）';
  return null;
}
function sanitizeName(name, fallback) {
  let n = String(name || '').trim();
  n = n.replace(/^\.+/, '').replace(/\.[^.]*$/, '');
  n = n.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!n || !/^[\p{L}]/u.test(n)) n = (fallback || 'file') + (n ? '-' + n : '');
  return n.slice(0, 48);
}

/* ---------------------------------------------------------------- spotfs 名字转义
 * spotfs 是「节点对象图」，不是 ext4：节点名必须能塞进点分路径（"." 是分隔符）。
 * 外部文件（拖进来、导入的 ext4 镜像）名字五花八门，规则是：
 *   - ASCII 字母/数字 → 原样；其余（短横线、下划线、点、斜线、空格、中文、控制符……）
 *     逐个 UTF-8 字节写成 -HH（大写十六进制）；
 *   - 名字首位是数字也算「要转义」——首位那一位写成 -HH；
 *   - 只要发生过任何转义（或首位数字），整个名字加前缀 -XX 当哨兵，表示「我转义过」。
 * -XX 里的 X 不是十六进制，所以永远不会和 -HH 撞车。
 * 如果原名本来就全是字母数字且不以数字开头，就原样带进来，不加前缀。
 * 导出（拖出去 / 另存）时反向解析；遇到目标文件系统不允许的字符（/ \ : * ? " < > | 控制符），
 * 在对应位置保留 -HH 写法即可。
 */
/* 哨兵写成小写 -xx：spotfs 大小写不敏感、内部一律小写存储（normPath 会 toLowerCase），
 * 大写 -XX 经过路径规范化也会变成 -xx，索性统一成小写，避免「写的和存的对不上」。
 * 解析时两种大小写都接受。 */
const SPOT_SENTINEL = '-xx';
function spotEscape(raw) {
  const bytes = new TextEncoder().encode(String(raw == null ? '' : raw));
  let out = '', escaped = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i], ch = String.fromCharCode(b);
    const alnum = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
    const leadingDigit = (i === 0 && b >= 48 && b <= 57);
    if (alnum && !leadingDigit) out += ch;
    else { out += '-' + b.toString(16).padStart(2, '0'); escaped = true; }
  }
  if (!out) return 'empty';
  return escaped ? SPOT_SENTINEL + out : out;
}
function spotUnescape(stored) {
  let s = String(stored == null ? '' : stored);
  if (!/^-[xX]{2}/.test(s)) return s;   // 没转义过，原样
  s = s.slice(3);
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '-' && /^-[0-9A-Fa-f]{2}$/.test(s.slice(i, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; continue;
    }
    const ch = s[i];
    for (const b of new TextEncoder().encode(ch)) bytes.push(b); i++;
  }
  try { return new TextDecoder().decode(new Uint8Array(bytes)); } catch (e) { return s; }
}
/* 目标文件系统（NTFS / ext4）不接受的字符：导出时保留 -HH。
 * 其余已转义的字符尽可能还原成人类可读的原名。 */
const SPOT_EXPORT_BAD = /[\\/:*?"<>|\x00-\x1F]/;
function spotExportName(stored) {
  const raw = spotUnescape(stored);
  let out = '';
  for (const ch of raw) {
    if (SPOT_EXPORT_BAD.test(ch)) {
      for (const b of new TextEncoder().encode(ch)) out += '-' + b.toString(16).toUpperCase().padStart(2, '0');
    } else out += ch;
  }
  return out || 'file';
}

/* ---------------------------------------------------------------- 内置文件系统内容 */
const DIRS = ['.home', '.app', '.dev', '.proc', '.pkg', '.config', '.agent', '.doc', '.perm', '.temp', '.queryfile', '.savefile', '.localstorage'];
const APP_DEFS = [
  { name:'shell', title:'终端', desc:'新的 JS shell 窗口', type:'shell', icon:'▣' },
  { name:'browser', title:'浏览器', desc:'窗口里的真浏览器（iframe）', type:'browser', icon:'◎' },
  { name:'python', title:'Python', desc:'Pyodide 交互式环境', type:'python', icon:'🐍' },
  { name:'agent', title:'HarTMLes', desc:'AI 智能体框架（需要后端）', type:'agent', icon:'✦' },
  { name:'files', title:'文件', desc:'浏览一切皆文件的世界', type:'files', icon:'▤' },
  { name:'editor', title:'编辑器', desc:'查看/编辑文本文件', type:'editor', icon:'✎' },
  /* 工具：沙箱的「日常用得上」那一面。全部自研，不引第三方库。 */
  { name:'calc', title:'计算器', desc:'科学计算器（表达式、角度、记忆）', type:'calc', icon:'∑' },
  { name:'data', title:'数据', desc:'编码 / 时间戳 / 哈希 / 随机', type:'data', icon:'⇄' },
  { name:'color', title:'调色', desc:'色相环与六种颜色表示', type:'color', icon:'◐' },
  { name:'markdown', title:'Markdown', desc:'编辑并实时渲染 Markdown', type:'markdown', icon:'¶' },
  { name:'htmlapp', title:'HTML 编辑器', desc:'写 HTML，右边实时渲染（canvas 代码区）', type:'htmlapp', icon:'</>' },
  { name:'bezier', title:'贝塞尔动效', desc:'拖控制点设计缓动曲线，即时看小球', type:'bezier', icon:'∿' },
  { name:'shot', title:'截图', desc:'把桌面或某个窗口拍成图片', type:'shot', icon:'⬚' },
  { name:'timer', title:'计时器', desc:'秒表与倒计时，到点响铃', type:'timer', icon:'◷' },
  { name:'image', title:'看图修图', desc:'查看图片、裁剪标注打码（截图搭档）', type:'image', icon:'▩' },
  { name:'urlhash', title:'链接即状态', desc:'把文本/JS 压进 URL 片段', type:'urlhash', icon:'⌗' },
  { name:'recorder', title:'录音机', desc:'麦克风录音，落进 .home', type:'recorder', icon:'◎' },
  { name:'geo', title:'定位', desc:'坐标、精度、海拔，可存成 JSON', type:'geo', icon:'⌖' },
  { name:'view3d', title:'3D 视图', desc:'自写 WebGL 场景，可拖动旋转', type:'view3d', icon:'◫' },
  { name:'audio', title:'音频播放', desc:'波形、进度、速度，可拖入文件', type:'audio', icon:'♫' },
  { name:'settings', title:'设置', desc:'打开“更多”抽屉', type:'drawer', icon:'≥' },
  { name:'about', title:'关于', desc:'版本、许可与第三方声明', type:'about', icon:'ⓘ' },
];
const DEV_DEFS = [
  { name:'tty', device:'tty', hint:'当前终端' },
  { name:'null', device:'null', hint:'黑洞，写入即丢弃' },
  { name:'zero', device:'zero', hint:'永远读到 0' },
  { name:'random', device:'random', hint:'随机数' },
  { name:'time', device:'time', hint:'当前时间戳' },
  { name:'console', device:'console', hint:'控制台输出' },
];
const PERM_DEFS = [
  { name:'clipboard', hint:'剪贴板读写' },
  { name:'notification', hint:'桌面通知' },
  { name:'camera', hint:'摄像头' },
  { name:'microphone', hint:'麦克风' },
  { name:'geolocation', hint:'地理位置' },
  { name:'fullscreen', hint:'全屏' },
  { name:'persistent', hint:'持久化存储' },
];
const SEED_FILES = {
  '.home.welcome': {
    kind:'file', mime:'text/plain',
    content:`欢迎来到 HTerMinaL。

这是一个跑在浏览器里的 JS 终端。你看到的每一行都是 JavaScript：

  > 1 + 2
  > await ls()
  > const x = await fs.read('.home.welcome')
  > python()          // 在当前终端开一个 Python
  > winOpen({type:'browser', url:'https://example.com'})
  > agentOpen()       // 轻量智能体（需要本地后端）
  > hsb1()            // 进 hsb1：Linux 风格的交互 shell

这一层是纯 JS 控制台（提示符固定为 JSHeL> ，没有「当前目录」），不是 shell：
函数名只是普通 JS 标识符，裸敲 ls 求值为函数对象，ls() 才是调用；ls -la 会报语法错误。
要敲 Linux 命令，用 hsb1() 进去，或者 hsb1('ls -la') 跑一行。
两边是彻底分开的：JSHeL 只认 JS，hsb1 只认命令。

路径用点分隔，根是 "."。例如：
  .home.notes       根下的 home 目录里的 notes
  .app.hello        一个可执行函数
  .localstorage.x   浏览器 localStorage 里的 x

输入 help() 看 JS 侧的 API；进 hsb1 之后 help 看命令表。`
  },
  '.home.readme': {
    kind:'file', mime:'text/plain',
    content:`HTerMinaL 的几条“世界观”：

1. 一切皆文件。文件可以是文本、函数、应用、设备、权限、包、线程、会话。
2. 文件系统叫 spotfs：它是一张「节点对象图」，不是 ext4。没有 inode、没有权限位、没有属主。
   节点分 dir / file / func / app / device / grant / package / proc / link 这些种类。
3. 路径用 "." 分隔，根是 "."。节点名必须能塞进点分路径，所以外部文件名会转义：
   字母数字原样；其余（短横线、下划线、点、斜杠、空格、中文……）按 UTF-8 字节写成 -HH，
   整个名字前加 -XX 哨兵；导出时再解析回去（目标系统不接受的字符保留 -HH）。
4. 浏览器就是沙箱。这里不再套一层安全沙箱，执行 JS 不需要许可。
5. 多线程。每个终端、每个 Python、每个窗口应用都跑在独立的 Worker 里。
6. 数据都在你本地。IndexedDB + localStorage，没有云端。

spotfs 只有六个原子操作（其余命令都是它们的组合）：
  c  sptc(p, data)   覆盖写入（只覆盖已有节点，不新建）
  n  sptn(p, opts)   新建；.queryfile 下 = 向你要文件；.savefile 下 = 关闭时保存到本机
  a  spta(p, data)   末尾追加
  x  sptx(p)         执行：JS 脚本 / HTML 页面 / 对象 / 目录 / 权限，自动判别
  r  sptr(p)         读内容（文件）或索引（目录、对象）
  d  sptd(p)         删除：文件删、目录递归删、进程结束、链接解除

常用目录：
  .home         你的文件
  .app          可执行函数
  .app          应用
  .dev          设备
  .proc         进程/线程
  .pkg          已安装的包
  .config       设置
  .agent        智能体会话
  .doc          文档与系统信息（只读）
  .perm         授权（摄像头 / 通知等）
  .temp         临时文件（刷新即失）
  .queryfile    你通过“询问文件”/拖拽交进来的文件
  .savefile     在这里新建并写入，关闭时保存到本机，然后节点消失
  .localstorage localStorage 的镜像

试试：
  > await ls('.app')
  > await exec('.app.hello')
  > await exec('.app.audit')      // 能力自检：25 项原生 JS / DOM / 加密
  > open('.app.html-particles')   // Canvas 粒子
  > open('.app.html-lisp')        // 页面里的 Lisp 解释器
  > cat('.home.readme')
  > hsb1()                然后   ls -la | head      或者   fastfetch

hsb1 可以嵌套：再敲一次 hsb1 就是下一层，exit 回到上一层，
每一层的当前目录互不影响（和真的子 shell 一样）。`
  },
  '.app.hello': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'示例可执行文件', interpreter:'js' },
    content:`print('hello from .app.hello');
print('cwd =', await pwd());
print('现在时间是', new Date().toLocaleString('zh-CN'));
return 'done';`
  },
  '.app.sysinfo': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'打印环境信息', interpreter:'js' },
    content:`const u = await navigator.storage.estimate().catch(()=>({}));
print('HTerMinaL', '${HT_VERSION}');
print('UA       ', navigator.userAgent);
print('CPU      ', navigator.hardwareConcurrency, 'threads');
print('内存     ', navigator.deviceMemory || '?', 'GB');
print('存储用量 ', ((u.usage||0)/1048576).toFixed(2), 'MB /', ((u.quota||0)/1048576).toFixed(0), 'MB');
print('cwd      ', await pwd());`
  },
  '.app.expr': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"手写解释器：词法 + 递归下降 + 变量 + 函数", interpreter:'js' },
    content:"\n/* .app.expr —— 一个真的表达式语言：tokenizer + 递归下降 + 求值。\n * 支持 + - * / % ^、括号、一元负号、变量、赋值、函数调用。\n * 优先级：赋值 < 加减 < 乘除模 < 幂(右结合) < 一元 < 原子 */\nconst TOK = [];\nfunction lex(src) {\n  const out = [];\n  let i = 0;\n  while (i < src.length) {\n    const c = src[i];\n    if (/\\s/.test(c)) { i++; continue; }\n    if (/[0-9.]/.test(c)) {\n      let j = i;\n      while (j < src.length && /[0-9._]/.test(src[j])) j++;\n      out.push({ t: 'num', v: parseFloat(src.slice(i, j).replace(/_/g, '')) });\n      i = j; continue;\n    }\n    if (/[A-Za-z_\\u4e00-\\u9fa5]/.test(c)) {\n      let j = i;\n      while (j < src.length && /[A-Za-z0-9_\\u4e00-\\u9fa5]/.test(src[j])) j++;\n      out.push({ t: 'id', v: src.slice(i, j) });\n      i = j; continue;\n    }\n    if ('+-*/%^(),=;'.includes(c)) { out.push({ t: c }); i++; continue; }\n    throw new Error('无法识别的字符: ' + c);\n  }\n  out.push({ t: 'eof' });\n  return out;\n}\n\nconst FUNCS = {\n  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs,\n  log: Math.log, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,\n  max: Math.max, min: Math.min, pow: Math.pow,\n  round: Math.round, sign: Math.sign\n};\nconst CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };\n\nfunction evaluate(src, vars) {\n  const ts = lex(src);\n  let p = 0;\n  const peek = () => ts[p];\n  const eat = (t) => { if (ts[p].t !== t) throw new Error('期望 ' + t + '，得到 ' + ts[p].t); return ts[p++]; };\n\n  function primary() {\n    const tk = peek();\n    if (tk.t === 'num') { p++; return tk.v; }\n    if (tk.t === 'id') {\n      p++;\n      const name = tk.v;\n      if (peek().t === '(') {\n        p++;\n        const args = [];\n        if (peek().t !== ')') {\n          args.push(expr());\n          while (peek().t === ',') { p++; args.push(expr()); }\n        }\n        eat(')');\n        if (!FUNCS[name]) throw new Error('没有函数 ' + name);\n        return FUNCS[name](...args);\n      }\n      if (name in vars) return vars[name];\n      if (name in CONSTS) return CONSTS[name];\n      throw new Error('未定义变量 ' + name);\n    }\n    if (tk.t === '(') { p++; const v = expr(); eat(')'); return v; }\n    if (tk.t === '-') { p++; return -unary(); }\n    if (tk.t === '+') { p++; return unary(); }\n    throw new Error('意外的记号 ' + tk.t);\n  }\n  function power() {\n    const base = primary();\n    if (peek().t === '^') { p++; return Math.pow(base, power()); }   // 右结合\n    return base;\n  }\n  function unary() { return power(); }\n  function term() {\n    let v = unary();\n    while (peek().t === '*' || peek().t === '/' || peek().t === '%') {\n      const op = ts[p++].t;\n      const r = unary();\n      v = op === '*' ? v * r : op === '/' ? v / r : v % r;\n    }\n    return v;\n  }\n  function expr() {\n    let v = term();\n    while (peek().t === '+' || peek().t === '-') {\n      const op = ts[p++].t;\n      const r = term();\n      v = op === '+' ? v + r : v - r;\n    }\n    return v;\n  }\n  function statement() {\n    /* 赋值：ident = expr */\n    if (peek().t === 'id' && ts[p + 1] && ts[p + 1].t === '=') {\n      const name = ts[p].v;\n      p += 2;\n      const v = expr();\n      vars[name] = v;\n      return v;\n    }\n    return expr();\n  }\n\n  let last;\n  while (peek().t !== 'eof') {\n    last = statement();\n    if (peek().t === ';') p++;\n    else if (peek().t !== 'eof') throw new Error('多余的内容: ' + peek().t);\n  }\n  return last;\n}\n\nconst vars = {};\nconst cases = [\n  '2 + 3 * 4',\n  '(1 + 2) ^ 3',\n  '2 ^ 3 ^ 2',\n  'sin(pi / 2)',\n  'x = 5; x ^ 2 + 1',\n  'y = max(3, 7) * 2 - sqrt(81)',\n  '1_000_000 / 7',\n  'abs(-3) + round(2.6)',\n  '-2 ^ 2',\n  '0.1 + 0.2',\n  'z = x * y; z / 2'\n];\n\nconsole.log('源码'.padEnd(24) + '结果');\nconsole.log('─'.repeat(46));\nfor (const c of cases) {\n  try {\n    const v = evaluate(c, vars);\n    console.log(c.padEnd(24) + (Number.isInteger(v) ? v : v.toFixed(10).replace(/0+$/, '').replace(/\\.$/, '')));\n  } catch (e) {\n    console.log(c.padEnd(24) + '错误: ' + e.message);\n  }\n}\nconsole.log('\\n最终变量表：' + JSON.stringify(vars));\nreturn Object.keys(vars).length;\n"
  },
  '.app.crypto': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"WebCrypto：SHA / HMAC / PBKDF2 / AES-GCM / 随机", interpreter:'js' },
    content:"\n/* .app.crypto —— 全部走 crypto.subtle（浏览器原生实现），不是 JS 自己搓的。 */\nconst enc = new TextEncoder();\nconst hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');\nconst b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));\n\nconsole.log('SHA-256(\"abc\") = ' + hex(await crypto.subtle.digest('SHA-256', enc.encode('abc'))));\nconsole.log('SHA-512(\"abc\") = ' + hex(await crypto.subtle.digest('SHA-512', enc.encode('abc'))).slice(0, 32) + '…');\n\nconst hk = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);\nconst sig = await crypto.subtle.sign('HMAC', hk, enc.encode('message'));\nconsole.log('HMAC-SHA256    = ' + hex(sig).slice(0, 32) + '…');\nconsole.log('HMAC 验证      = ' + await crypto.subtle.verify('HMAC', hk, sig, enc.encode('message')));\n\nlet t0 = performance.now();\nconst pk = await crypto.subtle.importKey('raw', enc.encode('password'), 'PBKDF2', false, ['deriveBits']);\nconst bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('salt'), iterations: 100000, hash: 'SHA-256' }, pk, 256);\nconsole.log('PBKDF2 10 万次 = ' + hex(bits).slice(0, 32) + '… (' + (performance.now() - t0).toFixed(0) + 'ms)');\n\nconst key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);\nconst iv = crypto.getRandomValues(new Uint8Array(12));\nt0 = performance.now();\nconst ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('机密：汉字编码测试'));\nconst pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);\nconsole.log('AES-GCM 密文   = ' + b64(ct).slice(0, 40) + '… (' + (performance.now() - t0).toFixed(1) + 'ms)');\nconsole.log('AES-GCM 解密   = ' + new TextDecoder().decode(pt));\n\nconst raw = crypto.getRandomValues(new Uint8Array(16));\nconsole.log('随机 16 字节   = ' + hex(raw));\nconsole.log('randomUUID     = ' + crypto.randomUUID());\nreturn 'ok';\n"
  },
  '.app.async': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"异步编排：并发池 / allSettled / 超时 / 异步生成器", interpreter:'js' },
    content:"\n/* .app.async —— 事件循环是真的，所以这些才有意义。 */\nconst sleep2 = (ms) => new Promise(r => setTimeout(r, ms));\nconst t0 = performance.now();\nconst ts = () => (performance.now() - t0).toFixed(0).padStart(4) + 'ms';\n\n/* 1. 并发池：20 个任务，最多同时 3 个 */\nconst tasks = Array.from({ length: 20 }, (_, i) => ({\n  id: i,\n  cost: 20 + ((i * 37) % 90)\n}));\nconst results = [];\nlet running = 0, peak = 0;\nasync function workerPool(items, limit, fn) {\n  const queue = items.slice();\n  const workers = Array.from({ length: limit }, async () => {\n    while (queue.length) {\n      const item = queue.shift();\n      running++; peak = Math.max(peak, running);\n      results.push(await fn(item));\n      running--;\n    }\n  });\n  await Promise.all(workers);\n}\nconst start = performance.now();\nawait workerPool(tasks, 3, async (t) => {\n  await sleep2(t.cost);\n  return t.id;\n});\nconsole.log('并发池：20 个任务 / 限 3 / 峰值 ' + peak + ' / 用时 ' + (performance.now() - start).toFixed(0) + 'ms');\nconsole.log('  完成顺序：' + results.join(' '));\n\n/* 2. allSettled：有失败也要拿到全部结果 */\nconst settled = await Promise.allSettled([\n  sleep2(30).then(() => 'A'),\n  sleep2(10).then(() => { throw new Error('B 故意失败'); }),\n  sleep2(50).then(() => 'C')\n]);\nconsole.log('\\nallSettled：' + settled.map(s => s.status === 'fulfilled' ? '✓' + s.value : '✗' + s.reason.message).join('  '));\n\n/* 3. AbortController：给慢任务 60ms 预算 */\nasync function withTimeout(fn, ms) {\n  const ac = new AbortController();\n  const timer = setTimeout(() => ac.abort(new Error('超时 ' + ms + 'ms')), ms);\n  try { return await fn(ac.signal); }\n  finally { clearTimeout(timer); }\n}\ntry {\n  await withTimeout(async (signal) => {\n    for (let i = 0; i < 10; i++) {\n      if (signal.aborted) throw signal.reason;\n      await sleep2(20);\n    }\n    return '不应该到这里';\n  }, 60);\n} catch (e) {\n  console.log('超时控制：' + e.message + '（第 3 次循环时中止）');\n}\n\n/* 4. 异步生成器做流水线：生产者 -> 过滤 -> 取前 3 个 */\nasync function* numbers() { for (let i = 1; ; i++) { await sleep2(1); yield i; } }\nasync function* filter(src, pred) { for await (const v of src) if (pred(v)) yield v; }\nasync function* take(src, n) { let k = 0; for await (const v of src) { yield v; if (++k >= n) return; } }\nconst out = [];\nfor await (const v of take(filter(numbers(), v => v % 7 === 0), 3)) out.push(v);\nconsole.log('异步流水线：前 3 个 7 的倍数 = ' + out.join(', '));\nreturn out.length;\n"
  },
  '.app.reactive': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"Proxy 响应式：依赖收集 + 自动更新 DOM", interpreter:'js' },
    content:"\n/* .app.reactive —— 40 行实现一个 mini Vue：Proxy 拦截读写，effect 收集依赖。 */\nlet activeEffect = null;\nconst targetMap = new WeakMap();\n\nfunction track(target, key) {\n  if (!activeEffect) return;\n  let deps = targetMap.get(target);\n  if (!deps) targetMap.set(target, deps = new Map());\n  let dep = deps.get(key);\n  if (!dep) deps.set(key, dep = new Set());\n  dep.add(activeEffect);\n}\nfunction trigger(target, key) {\n  const dep = targetMap.get(target) && targetMap.get(target).get(key);\n  if (dep) for (const fn of [...dep]) fn();\n}\nfunction reactive(obj) {\n  return new Proxy(obj, {\n    get(t, k, r) { track(t, k); return typeof t[k] === 'object' && t[k] ? reactive(t[k]) : t[k]; },\n    set(t, k, v) { const old = t[k]; t[k] = v; if (old !== v) trigger(t, k); return true; }\n  });\n}\nfunction effect(fn) { activeEffect = fn; fn(); activeEffect = null; }\nfunction computed(getter) {\n  let value, dirty = true;\n  const obj = { get value() { if (dirty) { value = getter(); dirty = false; } return value; } };\n  return obj;\n}\n\nconst state = reactive({ count: 0, name: 'HTerMinaL', nested: { n: 1 } });\n\n/* 把状态绑到一个真实 DOM 节点上 */\nconst card = document.createElement('div');\ncard.id = '__reactive_card';\ncard.style.padding = '10px';\ncard.textContent = '...';\ndocument.body.appendChild(card);\nawait sleep(60);\n\nconst label = document.createElement('span');\nconst twice = document.createElement('b');\nlet renders = 0;\n\neffect(() => {\n  renders++;\n  card.textContent = state.name + ' · count=' + state.count + ' · 双倍=' + state.count * 2 + ' · 嵌套=' + state.nested.n;\n});\n\nconsole.log('初始渲染：' + card.textContent);\nstate.count++;\nconsole.log('count++ 后：' + card.textContent);\nstate.count += 9;\nconsole.log('count+=9 后：' + card.textContent);\nstate.nested.n = 42;\nconsole.log('嵌套属性改后：' + card.textContent);\nstate.name = '一切皆文件';\nconsole.log('改名后：' + card.textContent);\nconsole.log('共触发渲染 ' + renders + ' 次（嵌套对象也被追踪到了）');\n\n/* 批量更新：默认每次 set 都触发；Vue 的 nextTick 是同一思路 */\nlet batch = 0;\neffect(() => { state.count; batch++; });\nfor (let i = 0; i < 100; i++) state.count++;\nconsole.log('连续 100 次 set：effect 被调 ' + batch + ' 次（每次 set 同步触发）');\n\nawait sleep(60);\nconst live = document.getElementById('__reactive_card');\nconsole.log('DOM 回读：' + (live ? live.textContent : '没找到'));\ncard.remove();\nreturn renders;\n"
  },
  '.app.gen': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"生成器与惰性管道：无限流 / take / zip / 素数", interpreter:'js' },
    content:"\n/* .app.gen —— 惰性求值：无限序列也能安全地取前 n 个。 */\nfunction* nat() { let i = 1; while (true) yield i++; }\nfunction* fib() { let a = 0, b = 1; while (true) { yield a; [a, b] = [b, a + b]; } }\nfunction* primes() {\n  const seen = [];\n  for (let n = 2; ; n++) {\n    if (seen.every(p => n % p !== 0)) { seen.push(n); yield n; }\n  }\n}\nfunction* map(src, fn) { let i = 0; for (const v of src) yield fn(v, i++); }\nfunction* filter(src, fn) { for (const v of src) if (fn(v)) yield v; }\nfunction* take(src, n) { let k = 0; for (const v of src) { yield v; if (++k >= n) return; } }\nfunction* zip(a, b) { const ia = a[Symbol.iterator](), ib = b[Symbol.iterator](); while (true) { const x = ia.next(), y = ib.next(); if (x.done || y.done) return; yield [x.value, y.value]; } }\nconst toArray = (it) => [...it];\n\nconsole.log('自然数前 10：' + toArray(take(nat(), 10)).join(' '));\nconsole.log('斐波那契前 15：' + toArray(take(fib(), 15)).join(' '));\nconsole.log('素数前 20：' + toArray(take(primes(), 20)).join(' '));\n\n/* 管道：自然数 -> 平方 -> 只要奇数 -> 前 8 个 */\nconst pipe = take(filter(map(nat(), n => n * n), n => n % 2 === 1), 8);\nconsole.log('平方中的奇数前 8：' + toArray(pipe).join(' '));\n\n/* zip：斐波那契与素数配对 */\nconsole.log('斐波那契 × 素数：' + toArray(take(zip(fib(), primes()), 8)).map(([a, b]) => a + ':' + b).join('  '));\n\n/* 惰性 vs 急切：算 1e7 个数里第一个满足条件的，惰性只走到满足处 */\nconst t0 = performance.now();\nconst first = take(filter(nat(), n => n > 5 && n % 997 === 0), 1);\nconsole.log('\\n第一个 >5 且能被 997 整除的数：' + toArray(first)[0] + '（' + (performance.now() - t0).toFixed(2) + 'ms，没算到 1e7）');\n\n/* 自定义迭代器协议 + for...of 解构 */\nconst range = { from: 1, to: 5, [Symbol.iterator]() { let i = this.from; return { next: () => i <= this.to ? { value: i++, done: false } : { value: undefined, done: true } }; } };\nconsole.log('自定义 range 求和：' + [...range].reduce((a, b) => a + b, 0));\nreturn 5;\n"
  },
  '.app.life': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"生命游戏：ANSI 动画 + 环形边界", interpreter:'js' },
    content:"\n/* .app.life —— 康威生命游戏。终端里 60 代，看清楚再退。 */\nconst W = 46, H = 20;\nlet grid = Array.from({ length: H }, () => Array(W).fill(0));\n\nconst seed = (x, y, cells) => { for (const [dx, dy] of cells) grid[(y + dy + H) % H][(x + dx + W) % W] = 1; };\nseed(6, 6, [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]);                 // 滑翔机\nseed(24, 8, [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]);\nseed(34, 12, [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]);\nseed(10, 14, [[0, 0], [1, 0], [0, 1], [1, 1]]);                       // 方块\n\nconst step = () => {\n  const next = Array.from({ length: H }, () => Array(W).fill(0));\n  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {\n    let n = 0;\n    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {\n      if (!dx && !dy) continue;\n      n += grid[(y + dy + H) % H][(x + dx + W) % W];\n    }\n    next[y][x] = grid[y][x] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);\n  }\n  grid = next;\n};\n\nconst paint = () => {\n  let s = '\\x1b[H';\n  for (let y = 0; y < H; y++) {\n    for (let x = 0; x < W; x++) s += grid[y][x] ? '\\x1b[36m█\\x1b[0m' : '\\x1b[90m·\\x1b[0m';\n    s += '\\x1b[K\\n';\n  }\n  console.log(s.replace(/\\n$/, ''));\n};\n\nconsole.log('\\x1b[2J\\x1b[H生命游戏 ' + W + 'x' + H + ' · 环形边界 · 60 代');\nfor (let i = 0; i < 60; i++) {\n  paint();\n  console.log('第 ' + String(i + 1).padStart(2) + ' 代 · 活细胞 ' + grid.flat().reduce((a, b) => a + b, 0) + ' ｜ Ctrl+C 可中断');\n  await sleep(70);\n  step();\n}\nconsole.log('\\n结束。');\nreturn 60;\n"
  },
  '.app.html-lisp': {
    kind:'file', mime:'text/html',
    meta:{ hint:"HTML · 页面里的迷你 Lisp 解释器（读入 / 求值 / 环境）" },
    content:"<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>迷你 Lisp</title>\n<style>\n  :root{--bg:#080b0f;--fg:#cfe;--accent:#5eead4;--dim:#6b8b89;--line:#1b2b33;--red:#f87171}\n  *{box-sizing:border-box}\n  html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);\n    font:13px/1.65 ui-monospace,SFMono-Regular,monospace}\n  body{display:flex;flex-direction:column;padding:16px;gap:12px}\n  h1{margin:0;font-size:14px;font-weight:500;letter-spacing:.12em;color:var(--accent)}\n  h1 span{color:var(--dim);letter-spacing:0;font-size:11px;margin-left:10px}\n  #log{flex:1;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:12px;\n    background:#0b1015;scrollbar-width:thin}\n  .in{color:#8fb6b3}.in::before{content:'λ ';color:var(--accent)}\n  .out{color:var(--fg);padding-left:16px;white-space:pre-wrap}\n  .err{color:var(--red);padding-left:16px}\n  form{display:flex;gap:8px}\n  input{flex:1;background:#0b1015;border:1px solid var(--line);border-radius:8px;color:var(--fg);\n    padding:10px 12px;font:inherit;outline:none}\n  input:focus{border-color:#2d5a56;box-shadow:0 0 0 3px #5eead410}\n  button{background:#122023;border:1px solid var(--line);color:var(--accent);border-radius:8px;\n    padding:0 14px;font:inherit;cursor:pointer}\n  button:hover{background:#172b2e}\n  #tips{font-size:11px;color:var(--dim);display:flex;gap:8px;flex-wrap:wrap}\n  #tips b{color:#9ecfca;font-weight:400}\n  #tips span{cursor:pointer;border:1px solid var(--line);border-radius:6px;padding:2px 7px}\n  #tips span:hover{border-color:#2d5a56;color:var(--accent)}\n</style></head>\n<body>\n<h1>迷你 Lisp <span>读入 → 展开 → 求值，全部在这 100 行里</span></h1>\n<div id=\"log\"></div>\n<div id=\"tips\">\n  <span>(+ 1 2 3)</span><span>(define (sq x) (* x x))</span><span>(sq 12)</span>\n  <span>(define fact (lambda (n) (if (&lt; n 2) 1 (* n (fact (- n 1))))))</span><span>(fact 20)</span>\n  <span>(map (lambda (x) (* x x)) (list 1 2 3 4))</span>\n</div>\n<form id=\"f\"><input id=\"q\" autocomplete=\"off\" spellcheck=\"false\" placeholder=\"输入 S-表达式，回车求值\"><button>运行</button></form>\n<script>\n/* ---------- tokenizer ---------- */\nfunction tokenize(src) {\n  const out = [];\n  const re = /\\s*(,@|[('`)]|\"(?:\\\\.|[^\\\\\"])*\"|;.*|[^\\s('`\",;)]+)/g;\n  let m;\n  while ((m = re.exec(src)) && m[1] !== '') {\n    const t = m[1];\n    if (t[0] === ';') continue;\n    out.push(t);\n  }\n  return out;\n}\n/* ---------- reader ---------- */\nfunction read(tokens, i) {\n  if (i >= tokens.length) throw new Error('意外的 EOF');\n  const t = tokens[i];\n  if (t === '(') {\n    const list = [];\n    i++;\n    while (tokens[i] !== ')') {\n      if (tokens[i] === undefined) throw new Error('缺少 )');\n      const r = read(tokens, i);\n      list.push(r[0]); i = r[1];\n    }\n    return [list, i + 1];\n  }\n  if (t === ')') throw new Error('多余的 )');\n  if (t[0] === '\"') return [t.slice(1, -1).replace(/\\\\n/g, '\\n'), i + 1];\n  if (/^-?\\d+(\\.\\d+)?$/.test(t)) return [Number(t), i + 1];\n  return [t, i + 1];\n}\nfunction parse(src) {\n  const ts = tokenize(src);\n  const out = [];\n  let i = 0;\n  while (i < ts.length) { const r = read(ts, i); out.push(r[0]); i = r[1]; }\n  return out;\n}\n\n/* ---------- 环境 ---------- */\nclass Env {\n  constructor(parms, args, outer) {\n    this.vars = new Map();\n    if (parms) parms.forEach((p, i) => this.vars.set(p, args[i]));\n    this.outer = outer || null;\n  }\n  get(k) {\n    if (this.vars.has(k)) return this.vars.get(k);\n    if (this.outer) return this.outer.get(k);\n    throw new Error('未定义: ' + k);\n  }\n  set(k, v) { this.vars.set(k, v); return v; }\n}\nconst num = (x) => { if (typeof x !== 'number') throw new Error('需要数字，得到 ' + typeof x); return x; };\nconst truthy = (x) => x !== false && x !== null && x !== undefined && x !== 0 && x !== '';\nconst fmt = (x) => Array.isArray(x) ? '(' + x.map(fmt).join(' ') + ')' : (x && x.__closure) ? '<lambda>' : typeof x === 'string' ? x : String(x);\n\nconst globalEnv = new Env();\nconst B = globalEnv.vars;\nB.set('+', (...a) => a.reduce((x, y) => x + num(y), 0));\nB.set('*', (...a) => a.reduce((x, y) => x * num(y), 1));\nB.set('-', (...a) => a.length === 1 ? -num(a[0]) : a.reduce((x, y) => x - num(y)));\nB.set('/', (...a) => a.length === 1 ? 1 / num(a[0]) : a.reduce((x, y) => x / num(y)));\nB.set('%', (a, b) => num(a) % num(b));\nB.set('<', (a, b) => a < b);\nB.set('>', (a, b) => a > b);\nB.set('<=', (a, b) => a <= b);\nB.set('>=', (a, b) => a >= b);\nB.set('=', (a, b) => a === b);\nB.set('equal?', (a, b) => JSON.stringify(a) === JSON.stringify(b));\nB.set('not', (a) => !truthy(a));\nB.set('list', (...a) => a);\nB.set('car', (a) => a[0]);\nB.set('cdr', (a) => a.slice(1));\nB.set('cons', (a, b) => [a, ...b]);\nB.set('length', (a) => a.length);\nB.set('null?', (a) => Array.isArray(a) && a.length === 0);\nB.set('number?', (a) => typeof a === 'number');\nB.set('symbol?', (a) => typeof a === 'string');\nB.set('pi', Math.PI);\nB.set('apply', (fn, args) => callProc(fn, args));\nB.set('map', (fn, arr) => arr.map(x => callProc(fn, [x])));\nB.set('filter', (fn, arr) => arr.filter(x => truthy(callProc(fn, [x]))));\nB.set('reduce', (fn, init, arr) => arr.reduce((a, b) => callProc(fn, [a, b]), init));\nB.set('range', (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return r; });\n\nfunction callProc(fn, args) {\n  if (typeof fn === 'function') return fn(...args);\n  if (fn && fn.__closure) return evalSeq(fn.body, new Env(fn.params, args, fn.env));\n  throw new Error('不是函数: ' + fmt(fn));\n}\n\n/* ---------- 求值 ---------- */\nfunction evalSeq(x, env) {\n  if (x === undefined) return null;\n  if (typeof x === 'number' || typeof x === 'string' && x[0] !== '(') {\n    if (typeof x === 'string') { try { return env.get(x); } catch (e) { return x; } }\n    return x;\n  }\n  if (!Array.isArray(x)) return x;\n  if (x.length === 0) return [];\n  const [op, ...args] = x;\n  if (op === 'quote') return args[0];\n  if (op === 'if') return truthy(evalSeq(args[0], env)) ? evalSeq(args[1], env) : (args[2] !== undefined ? evalSeq(args[2], env) : null);\n  if (op === 'define') {\n    if (Array.isArray(args[0])) {\n      const [name, ...params] = args[0];\n      return env.set(name, { __closure: 1, params, body: args[1], env });\n    }\n    return env.set(args[0], evalSeq(args[1], env));\n  }\n  if (op === 'lambda') return { __closure: 1, params: args[0], body: args[1], env };\n  if (op === 'begin') { let v = null; for (const a of args) v = evalSeq(a, env); return v; }\n  const fn = evalSeq(op, env);\n  return callProc(fn, args.map(a => evalSeq(a, env)));\n}\n\n/* ---------- UI ---------- */\nconst log = document.getElementById('log');\nconst input = document.getElementById('q');\nfunction line(cls, text) {\n  const d = document.createElement('div');\n  d.className = cls; d.textContent = text;\n  log.appendChild(d); log.scrollTop = log.scrollHeight;\n  return d;\n}\nfunction run(src) {\n  line('in', src);\n  try {\n    const forms = parse(src);\n    let v = null;\n    for (const f of forms) v = evalSeq(f, globalEnv);\n    line('out', '⇒ ' + fmt(v));\n    return v;\n  } catch (e) {\n    line('err', '✗ ' + e.message);\n  }\n}\ndocument.getElementById('f').addEventListener('submit', (e) => {\n  e.preventDefault();\n  const v = input.value.trim();\n  if (!v) return;\n  run(v); input.value = '';\n});\ndocument.querySelectorAll('#tips span').forEach(el => {\n  el.addEventListener('click', () => { input.value = el.textContent; input.focus(); });\n});\nline('out', '欢迎。试试下面的例子，或直接输入 (+ 1 2)。');\nrun('(define (fact n) (if (< n 2) 1 (* n (fact (- n 1)))))');\nrun('(fact 20)');\ninput.focus();\n<\/script>\n</body></html>"
  },
  '.app.html-webgl': {
    kind:'file', mime:'text/html',
    meta:{ hint:"HTML · 手写 WebGL：着色器 + 旋转立方体 + 鼠标拖动" },
    content:"<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>WebGL 立方体</title>\n<style>\n  html,body{margin:0;height:100%;background:#05070a;overflow:hidden;font:12px ui-monospace,monospace;color:#8fb6b3}\n  canvas{display:block;width:100%;height:100%}\n  #hud{position:fixed;left:12px;top:10px;padding:6px 10px;border-radius:8px;\n    background:#0b1218cc;border:1px solid #1b2b33;backdrop-filter:blur(8px);line-height:1.6;pointer-events:none}\n  #hud b{color:#5eead4;font-weight:500}\n</style></head>\n<body>\n<canvas id=\"c\"></canvas>\n<div id=\"hud\">WebGL 1.0 · 手写顶点/片元着色器 · <b id=\"fps\">0</b> FPS<br>鼠标拖动旋转 · 滚轮缩放</div>\n<script>\nconst c = document.getElementById('c');\nconst gl = c.getContext('webgl', { antialias: true, alpha: false });\nif (!gl) {\n  document.body.innerHTML = '<p style=\"color:#f87171;padding:20px\">这个环境不支持 WebGL。</p>';\n  throw new Error('no webgl');\n}\n\n/* 顶点：位置 + 法线 + 面颜色 */\nfunction cube() {\n  const faces = [\n    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, -1, 1], [1, 1, 1], [-1, 1, 1]], c: [0.37, 0.91, 0.83] },\n    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1]], c: [0.16, 0.55, 0.52] },\n    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]], c: [0.24, 0.72, 0.68] },\n    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, -1, -1], [-1, 1, 1], [-1, 1, -1]], c: [0.10, 0.40, 0.39] },\n    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1]], c: [0.52, 0.98, 0.90] },\n    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, -1], [1, -1, 1], [-1, -1, 1]], c: [0.08, 0.30, 0.30] }\n  ];\n  const pos = [], nor = [], col = [];\n  for (const f of faces) {\n    for (const p of f.v) { pos.push(...p); nor.push(...f.n); col.push(...f.c); }\n  }\n  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(col) };\n}\n\nconst VS = `\nattribute vec3 aPos;\nattribute vec3 aNor;\nattribute vec3 aCol;\nuniform mat4 uMVP;\nuniform mat4 uModel;\nvarying vec3 vNor;\nvarying vec3 vCol;\nvarying vec3 vPos;\nvoid main() {\n  vNor = mat3(uModel) * aNor;\n  vCol = aCol;\n  vPos = (uModel * vec4(aPos, 1.0)).xyz;\n  gl_Position = uMVP * vec4(aPos, 1.0);\n}`;\n\nconst FS = `\nprecision mediump float;\nvarying vec3 vNor;\nvarying vec3 vCol;\nvarying vec3 vPos;\nvoid main() {\n  vec3 n = normalize(vNor);\n  vec3 l1 = normalize(vec3(0.6, 0.9, 0.7));\n  vec3 l2 = normalize(vec3(-0.7, -0.3, 0.5));\n  float d1 = max(dot(n, l1), 0.0);\n  float d2 = max(dot(n, l2), 0.0) * 0.35;\n  vec3 view = normalize(-vPos);\n  vec3 h = normalize(l1 + view);\n  float spec = pow(max(dot(n, h), 0.0), 42.0) * 0.55;\n  vec3 col = vCol * (0.16 + d1 * 0.95 + d2) + vec3(spec);\n  gl_FragColor = vec4(pow(col, vec3(0.85)), 1.0);\n}`;\n\nfunction sh(type, src) {\n  const s = gl.createShader(type);\n  gl.shaderSource(s, src); gl.compileShader(s);\n  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));\n  return s;\n}\nconst prog = gl.createProgram();\ngl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));\ngl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));\ngl.linkProgram(prog);\nif (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));\ngl.useProgram(prog);\n\nconst M = cube();\nfunction buf(data) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }\nfunction attrib(name, data, size) {\n  const loc = gl.getAttribLocation(prog, name);\n  gl.bindBuffer(gl.ARRAY_BUFFER, buf(data));\n  gl.enableVertexAttribArray(loc);\n  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);\n}\nattrib('aPos', M.pos, 3);\nattrib('aNor', M.nor, 3);\nattrib('aCol', M.col, 3);\nconst uMVP = gl.getUniformLocation(prog, 'uMVP');\nconst uModel = gl.getUniformLocation(prog, 'uModel');\n\n/* 矩阵：列主序 */\nfunction mul(a, b) {\n  const o = new Float32Array(16);\n  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {\n    let s2 = 0; for (let k = 0; k < 4; k++) s2 += a[k * 4 + j] * b[i * 4 + k];\n    o[i * 4 + j] = s2;\n  }\n  return o;\n}\nfunction perspective(fovy, aspect, near, far) {\n  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);\n  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);\n}\nfunction rotX(a) { const c2 = Math.cos(a), s2 = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c2, s2, 0, 0, -s2, c2, 0, 0, 0, 0, 1]); }\nfunction rotY(a) { const c2 = Math.cos(a), s2 = Math.sin(a); return new Float32Array([c2, 0, -s2, 0, 0, 1, 0, 0, s2, 0, c2, 0, 0, 0, 0, 1]); }\nfunction trans(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }\n\nlet rx = -0.5, ry = 0.7, dist = 5.2;\nlet drag = false, lx = 0, ly = 0, spin = 0.004;\nc.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; c.setPointerCapture(e.pointerId); });\nc.addEventListener('pointermove', e => {\n  if (!drag) return;\n  ry += (e.clientX - lx) * 0.008; rx += (e.clientY - ly) * 0.008;\n  rx = Math.max(-1.5, Math.min(1.5, rx));\n  lx = e.clientX; ly = e.clientY;\n});\nc.addEventListener('pointerup', () => drag = false);\nc.addEventListener('wheel', e => { dist = Math.max(2.6, Math.min(12, dist + e.deltaY * 0.003)); e.preventDefault(); }, { passive: false });\n\nfunction resize() {\n  const dpr = Math.min(2, devicePixelRatio || 1);\n  c.width = innerWidth * dpr; c.height = innerHeight * dpr;\n  gl.viewport(0, 0, c.width, c.height);\n}\naddEventListener('resize', resize); resize();\n\ngl.enable(gl.DEPTH_TEST);\nlet frames = 0, ft = performance.now();\nfunction frame(now) {\n  if (!drag) ry += spin;\n  const aspect = c.width / c.height;\n  const model = mul(rotY(ry), rotX(rx));\n  const mvp = mul(perspective(0.9, aspect, 0.1, 100), mul(trans(0, 0, -dist), model));\n  gl.uniformMatrix4fv(uMVP, false, mvp);\n  gl.uniformMatrix4fv(uModel, false, model);\n  gl.clearColor(0.02, 0.03, 0.04, 1);\n  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);\n  gl.drawArrays(gl.TRIANGLES, 0, 36);\n  frames++;\n  if (now - ft > 500) { document.getElementById('fps').textContent = Math.round(frames * 1000 / (now - ft)); frames = 0; ft = now; }\n  requestAnimationFrame(frame);\n}\nrequestAnimationFrame(frame);\n<\/script>\n</body></html>"
  },
  '.app.html-audio': {
    kind:'file', mime:'text/html',
    meta:{ hint:"HTML · Web Audio 合成器（键盘发声 + 频谱可视化）" },
    content:"<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Web Audio 合成器</title>\n<style>\n  html,body{margin:0;height:100%;background:#07090c;overflow:hidden;\n    font:12px/1.6 ui-monospace,monospace;color:#8fb6b3;user-select:none;-webkit-user-select:none}\n  canvas{display:block}\n  #ui{position:fixed;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:14px 16px;pointer-events:none}\n  #title{letter-spacing:.14em;color:#5eead4;font-size:12px}\n  #title span{color:#4b6a68;letter-spacing:0;margin-left:10px}\n  #keys{display:flex;gap:5px;justify-content:center;pointer-events:auto;flex-wrap:wrap}\n  .k{width:46px;height:64px;border-radius:8px;border:1px solid #1e3238;background:#0d1519;\n    display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;color:#7ba7a4;\n    font-size:11px;cursor:pointer;transition:.08s;position:relative}\n  .k.black{background:#070b0e;color:#5a7a78;border-color:#152329}\n  .k.on{background:#123b3a;border-color:#5eead4;color:#5eead4;box-shadow:0 0 18px #5eead433;transform:translateY(1px)}\n  .k b{position:absolute;top:5px;font-weight:400;opacity:.55;font-size:9px}\n  #hint{color:#6f918e;font-size:11px;text-align:center;margin-top:8px}\n</style></head>\n<body>\n<canvas id=\"c\"></canvas>\n<div id=\"ui\">\n  <div id=\"title\">WEB AUDIO 合成器 <span>点击/按键发声 · 三个振荡器 + 滤波 + 延迟</span></div>\n  <div>\n    <div id=\"keys\"></div>\n    <div id=\"hint\">按 A S D F G H J K 弹奏 · 空格切换波形 · 声音要点击一次页面才会解锁</div>\n  </div>\n</div>\n<script>\nconst c = document.getElementById('c');\nconst g = c.getContext('2d');\nlet W, H, DPR = Math.min(2, devicePixelRatio || 1);\nfunction resize() {\n  W = innerWidth; H = innerHeight;\n  c.width = W * DPR; c.height = H * DPR;\n  c.style.width = W + 'px'; c.style.height = H + 'px';\n  g.setTransform(DPR, 0, 0, DPR, 0, 0);\n}\naddEventListener('resize', resize); resize();\n\n/* ---------- 音频图：osc -> filter -> gain -> analyser -> destination\n * 另有一路 delay 反馈，声音不会干巴巴 */\nlet ctx = null, analyser = null, master = null, filter = null, delay = null;\nlet started = false;\nconst waves = ['sawtooth', 'square', 'triangle', 'sine'];\nlet waveIdx = 0;\n\nfunction ensureAudio() {\n  if (started) return;\n  ctx = new (window.AudioContext || window.webkitAudioContext)();\n  master = ctx.createGain(); master.gain.value = 0.22;\n  filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800; filter.Q.value = 6;\n  delay = ctx.createDelay(0.6); delay.delayTime.value = 0.22;\n  const fb = ctx.createGain(); fb.gain.value = 0.28;\n  const wet = ctx.createGain(); wet.gain.value = 0.35;\n  analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.82;\n\n  filter.connect(master);\n  filter.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);\n  master.connect(analyser); analyser.connect(ctx.destination);\n  started = true;\n}\n\nconst NOTES = [\n  { k: 'a', n: 'C4', f: 261.63 }, { k: 'w', n: 'C#4', f: 277.18, black: 1 },\n  { k: 's', n: 'D4', f: 293.66 }, { k: 'e', n: 'D#4', f: 311.13, black: 1 },\n  { k: 'd', n: 'E4', f: 329.63 }, { k: 'f', n: 'F4', f: 349.23 },\n  { k: 't', n: 'F#4', f: 369.99, black: 1 }, { k: 'g', n: 'G4', f: 392.00 },\n  { k: 'y', n: 'G#4', f: 415.30, black: 1 }, { k: 'h', n: 'A4', f: 440.00 },\n  { k: 'u', n: 'A#4', f: 466.16, black: 1 }, { k: 'j', n: 'B4', f: 493.88 },\n  { k: 'k', n: 'C5', f: 523.25 }\n];\nconst active = new Map();\n\nfunction noteOn(note) {\n  ensureAudio();\n  if (active.has(note.k)) return;\n  const t = ctx.currentTime;\n  const osc = ctx.createOscillator();\n  const sub = ctx.createOscillator();\n  const env = ctx.createGain();\n  osc.type = waves[waveIdx];\n  sub.type = 'sine';\n  osc.frequency.value = note.f;\n  sub.frequency.value = note.f / 2;\n  env.gain.setValueAtTime(0.0001, t);\n  env.gain.exponentialRampToValueAtTime(0.85, t + 0.012);\n  env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);\n  osc.connect(env); sub.connect(env); env.connect(filter);\n  osc.start(t); sub.start(t);\n  osc.stop(t + 1.7); sub.stop(t + 1.7);\n  active.set(note.k, { osc, sub, env });\n  const el = document.querySelector('.k[data-k=\"' + note.k + '\"]');\n  if (el) el.classList.add('on');\n}\nfunction noteOff(k) {\n  const a = active.get(k);\n  if (!a) return;\n  const t = ctx.currentTime;\n  try {\n    a.env.gain.cancelScheduledValues(t);\n    a.env.gain.setTargetAtTime(0.0001, t, 0.05);\n    a.osc.stop(t + 0.25); a.sub.stop(t + 0.25);\n  } catch (e) {}\n  active.delete(k);\n  const el = document.querySelector('.k[data-k=\"' + k + '\"]');\n  if (el) el.classList.remove('on');\n}\n\n/* 键盘 */\nconst keysBox = document.getElementById('keys');\nfor (const n of NOTES) {\n  const d = document.createElement('div');\n  d.className = 'k' + (n.black ? ' black' : '');\n  d.dataset.k = n.k;\n  d.innerHTML = '<b>' + n.n + '</b>' + n.k.toUpperCase();\n  d.addEventListener('pointerdown', e => { e.preventDefault(); noteOn(n); });\n  d.addEventListener('pointerup', () => noteOff(n.k));\n  d.addEventListener('pointerleave', () => noteOff(n.k));\n  keysBox.appendChild(d);\n}\naddEventListener('keydown', e => {\n  if (e.repeat) return;\n  if (e.key === ' ') { waveIdx = (waveIdx + 1) % waves.length; document.getElementById('title').firstChild.textContent = 'WEB AUDIO 合成器 '; return; }\n  const n = NOTES.find(x => x.k === e.key.toLowerCase());\n  if (n) { noteOn(n); e.preventDefault(); }\n});\naddEventListener('keyup', e => {\n  const n = NOTES.find(x => x.k === e.key.toLowerCase());\n  if (n) noteOff(n.k);\n});\n\n/* 频谱 + 波形 */\nconst freq = new Uint8Array(512);\nconst wave = new Uint8Array(1024);\nfunction draw() {\n  g.fillStyle = '#07090c'; g.fillRect(0, 0, W, H);\n\n  if (analyser) {\n    analyser.getByteFrequencyData(freq);\n    analyser.getByteTimeDomainData(wave);\n\n    /* 频谱柱 */\n    const bars = 72;\n    const bw = W / bars;\n    for (let i = 0; i < bars; i++) {\n      const v = freq[Math.floor(Math.pow(i / bars, 1.6) * 380)] / 255;\n      const h = v * H * 0.42;\n      const grd = g.createLinearGradient(0, H, 0, H - h);\n      grd.addColorStop(0, 'rgba(94,234,212,.10)');\n      grd.addColorStop(.6, 'rgba(94,234,212,.55)');\n      grd.addColorStop(1, 'rgba(190,255,245,.95)');\n      g.fillStyle = grd;\n      g.fillRect(i * bw + 1, H - h, bw - 2, h);\n    }\n\n    /* 波形 */\n    g.beginPath();\n    g.strokeStyle = 'rgba(125,211,252,.75)';\n    g.lineWidth = 1.6;\n    for (let i = 0; i < wave.length; i++) {\n      const x = i / (wave.length - 1) * W;\n      const y = H * 0.5 + (wave[i] - 128) / 128 * H * 0.22;\n      i ? g.lineTo(x, y) : g.moveTo(x, y);\n    }\n    g.stroke();\n  } else {\n    g.fillStyle = '#0d1519';\n    g.font = '13px ui-monospace,monospace';\n    g.textAlign = 'center';\n    g.fillText('点击页面或按 A 键启用音频', W / 2, H / 2);\n  }\n  requestAnimationFrame(draw);\n}\nrequestAnimationFrame(draw);\n<\/script>\n</body></html>"
  },
  '.app.html-particles': {
    kind:'file', mime:'text/html',
    meta:{ hint:"HTML · Canvas 粒子星云（鼠标斥力 + 连线 + FPS）" },
    content:"<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>粒子星云</title>\n<style>\n  html,body{margin:0;height:100%;background:#05070a;overflow:hidden;font:12px/1.5 ui-monospace,monospace;color:#7ff}\n  canvas{display:block}\n  #hud{position:fixed;left:12px;top:10px;opacity:.75;letter-spacing:.06em;pointer-events:none}\n  #hud b{color:#5eead4;font-weight:500}\n</style></head>\n<body>\n<canvas id=\"c\"></canvas>\n<div id=\"hud\">粒子 <b id=\"n\">0</b> · FPS <b id=\"f\">0</b> · 移动鼠标推一把</div>\n<script>\nconst c = document.getElementById('c');\nconst g = c.getContext('2d');\nlet W = 0, H = 0, DPR = Math.min(2, devicePixelRatio || 1);\nconst P = [];\nconst mouse = { x: -999, y: -999 };\nlet frames = 0, fpsT = performance.now(), fps = 0;\n\nfunction resize() {\n  W = innerWidth; H = innerHeight;\n  c.width = W * DPR; c.height = H * DPR;\n  c.style.width = W + 'px'; c.style.height = H + 'px';\n  g.setTransform(DPR, 0, 0, DPR, 0, 0);\n}\naddEventListener('resize', resize); resize();\n\nconst N = Math.min(220, Math.round(W * H / 9000));\nfor (let i = 0; i < N; i++) {\n  P.push({\n    x: Math.random() * W, y: Math.random() * H,\n    vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,\n    r: .8 + Math.random() * 1.8,\n    h: 160 + Math.random() * 80\n  });\n}\n\naddEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });\naddEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });\naddEventListener('touchmove', e => {\n  const t = e.touches[0]; if (t) { mouse.x = t.clientX; mouse.y = t.clientY; }\n  e.preventDefault();\n}, { passive: false });\n\nfunction step(now) {\n  g.fillStyle = 'rgba(5,7,10,.28)';\n  g.fillRect(0, 0, W, H);\n\n  for (let i = 0; i < P.length; i++) {\n    const a = P[i];\n    /* 鼠标斥力：距离越近推得越狠，但有上限，不然会炸 */\n    const dx = a.x - mouse.x, dy = a.y - mouse.y;\n    const d2 = dx * dx + dy * dy;\n    if (d2 < 18000 && d2 > 1) {\n      const f = (1 - d2 / 18000) * .9;\n      const d = Math.sqrt(d2);\n      a.vx += dx / d * f; a.vy += dy / d * f;\n    }\n    a.vx *= .985; a.vy *= .985;\n    a.x += a.vx; a.y += a.vy;\n\n    if (a.x < -20) a.x = W + 20; if (a.x > W + 20) a.x = -20;\n    if (a.y < -20) a.y = H + 20; if (a.y > H + 20) a.y = -20;\n\n    g.beginPath();\n    g.fillStyle = 'hsla(' + a.h + ',80%,70%,.9)';\n    g.arc(a.x, a.y, a.r, 0, 6.2832);\n    g.fill();\n  }\n\n  /* 连线：只连足够近的，用距离决定透明度 */\n  g.lineWidth = .6;\n  for (let i = 0; i < P.length; i++) {\n    for (let j = i + 1; j < P.length; j++) {\n      const a = P[i], b = P[j];\n      const dx = a.x - b.x, dy = a.y - b.y;\n      const d2 = dx * dx + dy * dy;\n      if (d2 < 8000) {\n        g.strokeStyle = 'rgba(94,234,212,' + (0.18 * (1 - d2 / 8000)).toFixed(3) + ')';\n        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();\n      }\n    }\n  }\n\n  frames++;\n  if (now - fpsT > 500) {\n    fps = Math.round(frames * 1000 / (now - fpsT));\n    frames = 0; fpsT = now;\n    document.getElementById('f').textContent = fps;\n    document.getElementById('n').textContent = P.length;\n  }\n  requestAnimationFrame(step);\n}\nrequestAnimationFrame(step);\n<\/script>\n</body></html>"
  },
  '.app.html-snake': {
    kind:'file', mime:'text/html',
    meta:{ hint:"HTML · Canvas 贪吃蛇（方向键 / WASD / 触屏滑动）" },
    content:"<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,user-scalable=no\">\n<title>贪吃蛇</title>\n<style>\n  html,body{margin:0;height:100%;background:#080b0f;color:#cfe;overflow:hidden;\n    font:14px/1.5 ui-monospace,monospace;touch-action:none;-webkit-user-select:none;user-select:none}\n  #wrap{position:fixed;inset:0;display:grid;place-items:center}\n  canvas{background:#0b1015;border:1px solid #1d2b31;border-radius:12px;box-shadow:0 20px 60px #0008}\n  #hud{position:fixed;left:0;right:0;top:14px;text-align:center;letter-spacing:.08em;font-size:13px;color:#8fb6b3}\n  #hud b{color:#5eead4}\n  #tip{position:fixed;left:0;right:0;bottom:14px;text-align:center;font-size:12px;color:#5b7a78}\n</style></head>\n<body>\n<div id=\"hud\">得分 <b id=\"sc\">0</b> · 最高 <b id=\"hi\">0</b> · <span id=\"st\">按方向键开始</span></div>\n<div id=\"wrap\"><canvas id=\"c\" width=\"440\" height=\"440\"></canvas></div>\n<div id=\"tip\">方向键 / WASD · 空格暂停 · R 重开</div>\n<script>\nconst CELL = 20, COLS = 22, ROWS = 22;\nconst c = document.getElementById('c');\nconst g = c.getContext('2d');\nconst S = { snake: [], dir: [1, 0], next: [1, 0], food: null, score: 0, best: +(localStorage.getItem('snake.best') || 0), alive: true, paused: false, started: false, tick: 0 };\n\nfunction reset() {\n  S.snake = [[5, 11], [4, 11], [3, 11]];\n  S.dir = [1, 0]; S.next = [1, 0];\n  S.score = 0; S.alive = true; S.paused = false; S.started = false; S.tick = 0;\n  placeFood();\n  document.getElementById('sc').textContent = 0;\n  document.getElementById('st').textContent = '按方向键开始';\n}\nfunction placeFood() {\n  for (let k = 0; k < 500; k++) {\n    const p = [1 + Math.floor(Math.random() * (COLS - 2)), 1 + Math.floor(Math.random() * (ROWS - 2))];\n    if (!S.snake.some(s => s[0] === p[0] && s[1] === p[1])) { S.food = p; return; }\n  }\n}\nfunction turn(dx, dy) {\n  S.started = true;\n  /* 不允许 180 度回头 */\n  if (S.dir[0] === -dx && S.dir[1] === -dy) return;\n  S.next = [dx, dy];\n}\naddEventListener('keydown', e => {\n  const k = e.key.toLowerCase();\n  if (k === 'arrowup' || k === 'w') turn(0, -1);\n  else if (k === 'arrowdown' || k === 's') turn(0, 1);\n  else if (k === 'arrowleft' || k === 'a') turn(-1, 0);\n  else if (k === 'arrowright' || k === 'd') turn(1, 0);\n  else if (k === ' ') { S.paused = !S.paused; document.getElementById('st').textContent = S.paused ? '已暂停' : '进行中'; }\n  else if (k === 'r') reset();\n  else return;\n  e.preventDefault();\n});\n/* 触屏滑动 */\nlet tx = 0, ty = 0;\naddEventListener('touchstart', e => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; e.preventDefault(); }, { passive: false });\naddEventListener('touchend', e => {\n  const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;\n  if (Math.hypot(dx, dy) < 18) { S.paused = !S.paused; return; }\n  if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0); else turn(0, dy > 0 ? 1 : -1);\n  e.preventDefault();\n}, { passive: false });\n\nfunction update() {\n  if (!S.alive || S.paused || !S.started) return;\n  S.dir = S.next;\n  const head = [S.snake[0][0] + S.dir[0], S.snake[0][1] + S.dir[1]];\n  if (head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS) return die();\n  if (S.snake.some(s => s[0] === head[0] && s[1] === head[1])) return die();\n  S.snake.unshift(head);\n  if (S.food && head[0] === S.food[0] && head[1] === S.food[1]) {\n    S.score += 10;\n    document.getElementById('sc').textContent = S.score;\n    if (S.score > S.best) { S.best = S.score; localStorage.setItem('snake.best', String(S.best)); document.getElementById('hi').textContent = S.best; }\n    placeFood();\n  } else S.snake.pop();\n}\nfunction die() {\n  S.alive = false;\n  document.getElementById('st').textContent = '撞了 · 按 R 重开';\n}\n\nfunction draw() {\n  g.fillStyle = '#0b1015'; g.fillRect(0, 0, c.width, c.height);\n  /* 细网格 */\n  g.strokeStyle = 'rgba(94,234,212,.05)'; g.lineWidth = 1;\n  for (let i = 1; i < COLS; i++) { g.beginPath(); g.moveTo(i * CELL, 0); g.lineTo(i * CELL, c.height); g.stroke(); }\n  for (let j = 1; j < ROWS; j++) { g.beginPath(); g.moveTo(0, j * CELL); g.lineTo(c.width, j * CELL); g.stroke(); }\n\n  /* 食物：脉动圆点 */\n  if (S.food) {\n    const t = performance.now() / 380;\n    const r = CELL * 0.30 + Math.sin(t) * 2;\n    g.fillStyle = '#f87171';\n    g.shadowColor = '#f87171'; g.shadowBlur = 16;\n    g.beginPath();\n    g.arc(S.food[0] * CELL + CELL / 2, S.food[1] * CELL + CELL / 2, r, 0, 6.2832);\n    g.fill();\n    g.shadowBlur = 0;\n  }\n\n  /* 蛇：越靠近头越亮 */\n  for (let i = S.snake.length - 1; i >= 0; i--) {\n    const [x, y] = S.snake[i];\n    const k = i / Math.max(1, S.snake.length);\n    g.fillStyle = 'rgba(' + Math.round(94 + 80 * (1 - k)) + ',' + Math.round(234 - 60 * k) + ',' + Math.round(212 - 40 * k) + ',' + (0.95 - k * .45) + ')';\n    const pad = i === 0 ? 1.5 : 2.5;\n    roundRect(x * CELL + pad, y * CELL + pad, CELL - pad * 2, CELL - pad * 2, i === 0 ? 6 : 4);\n    g.fill();\n  }\n  /* 眼睛 */\n  if (S.snake.length) {\n    const [hx, hy] = S.snake[0];\n    g.fillStyle = '#071013';\n    const ex = hx * CELL + CELL / 2 + S.dir[0] * 4, ey = hy * CELL + CELL / 2 + S.dir[1] * 4;\n    g.beginPath(); g.arc(ex - S.dir[1] * 3.4, ey - S.dir[0] * 3.4, 1.7, 0, 6.2832); g.fill();\n    g.beginPath(); g.arc(ex + S.dir[1] * 3.4, ey + S.dir[0] * 3.4, 1.7, 0, 6.2832); g.fill();\n  }\n\n  if (!S.alive) {\n    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, c.width, c.height);\n    g.fillStyle = '#f87171'; g.font = '600 26px ui-monospace,monospace'; g.textAlign = 'center';\n    g.fillText('GAME OVER', c.width / 2, c.height / 2 - 6);\n    g.fillStyle = '#8fb6b3'; g.font = '13px ui-monospace,monospace';\n    g.fillText('得分 ' + S.score + ' · 按 R 重开', c.width / 2, c.height / 2 + 24);\n  }\n}\nfunction roundRect(x, y, w, h, r) {\n  g.beginPath();\n  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r);\n  g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r);\n  g.arcTo(x, y, x + w, y, r); g.closePath();\n}\n\ndocument.getElementById('hi').textContent = S.best;\nreset();\nlet last = 0;\nfunction loop(t) {\n  if (t - last > 92) { update(); last = t; }\n  draw();\n  requestAnimationFrame(loop);\n}\nrequestAnimationFrame(loop);\n<\/script>\n</body></html>"
  },
  '.app.html-mandelbrot': {
    kind:'file', mime:'text/html',
    meta:{ hint:"HTML · Mandelbrot 分形（滚轮缩放 + 拖动平移）" },
    content:"<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,user-scalable=no\">\n<title>Mandelbrot</title>\n<style>\n  html,body{margin:0;height:100%;background:#05070a;overflow:hidden;font:12px/1.5 ui-monospace,monospace;color:#9cf}\n  canvas{display:block;cursor:grab}\n  canvas.drag{cursor:grabbing}\n  #hud{position:fixed;left:12px;bottom:10px;padding:6px 10px;border-radius:8px;\n    background:#0b1218cc;border:1px solid #1b2b33;backdrop-filter:blur(8px);line-height:1.6}\n  #hud b{color:#5eead4;font-weight:500}\n</style></head>\n<body>\n<canvas id=\"c\"></canvas>\n<div id=\"hud\">中心 <b id=\"cx\">-0.5</b> + <b id=\"cy\">0</b>i · 缩放 <b id=\"z\">1</b>× · 迭代 <b id=\"it\">160</b> · 用时 <b id=\"ms\">0</b>ms<br>滚轮缩放 · 拖动平移 · 双击回原点</div>\n<script>\nconst c = document.getElementById('c');\nconst g = c.getContext('2d');\nlet W, H, DPR = Math.min(2, devicePixelRatio || 1);\nlet cx = -0.5, cy = 0, scale = 3.2, maxIter = 160;\n\nfunction resize() {\n  W = innerWidth; H = innerHeight;\n  c.width = W; c.height = H;\n  c.style.width = W + 'px'; c.style.height = H + 'px';\n  render();\n}\naddEventListener('resize', resize);\n\n/* 调色板：把逃逸次数映射成蓝绿到橙的渐变 */\nfunction palette(t) {\n  const s = Math.sin(t * 3.1), s2 = Math.sin(t * 1.7 + 2.4);\n  return [Math.round(20 + 60 * t), Math.round(60 + 120 * t + 30 * s), Math.round(90 + 120 * t + 40 * s2)];\n}\n\nlet busy = false, pending = null;\nfunction render() {\n  if (busy) { pending = true; return; }\n  busy = true;\n  const t0 = performance.now();\n  const img = g.createImageData(W, H);\n  const d = img.data;\n  const aspect = W / H;\n  const x0 = cx - scale / 2 * aspect, y0 = cy - scale / 2;\n  const dx = scale * aspect / W, dy = scale / H;\n\n  for (let py = 0; py < H; py++) {\n    const y = y0 + py * dy;\n    for (let px = 0; px < W; px++) {\n      const x = x0 + px * dx;\n      let zx = 0, zy = 0, i = 0;\n      /* 主心形快速排除：落在主心形里一定不逃逸 */\n      const q = (x - 0.25) * (x - 0.25) + y * y;\n      if (q * (q + (x - 0.25)) < 0.25 * y * y) i = maxIter;\n      else {\n        for (; i < maxIter; i++) {\n          const zx2 = zx * zx, zy2 = zy * zy;\n          if (zx2 + zy2 > 4) break;\n          zy = 2 * zx * zy + y;\n          zx = zx2 - zy2 + x;\n        }\n      }\n      const idx = (py * W + px) * 4;\n      if (i >= maxIter) { d[idx] = 4; d[idx + 1] = 7; d[idx + 2] = 10; d[idx + 3] = 255; }\n      else {\n        /* 平滑着色：用 log 去掉色带 */\n        const sm = i + 1 - Math.log(Math.log(Math.max(2, Math.sqrt(zx * zx + zy * zy)))) / Math.LN2;\n        const t = Math.min(1, sm / maxIter * 3.2);\n        const [r, gg, b] = palette(t);\n        d[idx] = r; d[idx + 1] = gg; d[idx + 2] = b; d[idx + 3] = 255;\n      }\n    }\n  }\n  g.putImageData(img, 0, 0);\n  const ms = performance.now() - t0;\n  document.getElementById('cx').textContent = cx.toFixed(9);\n  document.getElementById('cy').textContent = cy.toFixed(9);\n  document.getElementById('z').textContent = (3.2 / scale).toExponential(3);\n  document.getElementById('it').textContent = maxIter;\n  document.getElementById('ms').textContent = ms.toFixed(0);\n  busy = false;\n  if (pending) { pending = false; render(); }\n}\n\n/* 滚轮：以鼠标位置为不动点缩放 */\nc.addEventListener('wheel', e => {\n  e.preventDefault();\n  const rect = c.getBoundingClientRect();\n  const mx = e.clientX - rect.left, my = e.clientY - rect.top;\n  const aspect = W / H;\n  const wx = cx - scale / 2 * aspect + scale * aspect * mx / W;\n  const wy = cy - scale / 2 + scale * my / H;\n  const k = Math.exp(-e.deltaY * 0.0015);\n  const ns = Math.max(1e-14, Math.min(6, scale * k));\n  const f = ns / scale;\n  cx = wx + (cx - wx) * f;\n  cy = wy + (cy - wy) * f;\n  scale = ns;\n  if (scale < 0.02) maxIter = Math.min(2000, Math.round(160 + Math.log10(3.2 / scale) * 120));\n  render();\n}, { passive: false });\n\nlet dragging = false, lx = 0, ly = 0;\nc.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; c.classList.add('drag'); c.setPointerCapture(e.pointerId); });\nc.addEventListener('pointermove', e => {\n  if (!dragging) return;\n  const aspect = W / H;\n  cx -= (e.clientX - lx) / W * scale * aspect;\n  cy -= (e.clientY - ly) / H * scale;\n  lx = e.clientX; ly = e.clientY;\n  render();\n});\nconst stop = () => { dragging = false; c.classList.remove('drag'); };\nc.addEventListener('pointerup', stop);\nc.addEventListener('pointercancel', stop);\nc.addEventListener('dblclick', () => { cx = -0.5; cy = 0; scale = 3.2; maxIter = 160; render(); });\n\nresize();\n<\/script>\n</body></html>"
  },
  '.app.audit': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"能力自检：原生 JS / DOM / 异步 / 加密能不能跑", interpreter:'js' },
    content:"\n/* .app.audit —— 这台「JS 引擎」到底能不能跑真代码？\n * 每一项都真的执行，不看声明看结果。 */\nconst R = [];\nasync function T(name, fn) {\n  const t0 = performance.now();\n  try {\n    const v = await fn();\n    R.push([v === false ? 'FAIL' : 'OK  ', name, (performance.now() - t0).toFixed(1) + 'ms']);\n  } catch (e) {\n    R.push(['ERR ', name + ' :: ' + (e && e.message || e), '']);\n  }\n}\n\nawait T('BigInt 2^128', () => (2n ** 128n).toString(16) === '1' + '0'.repeat(32));\nawait T('生成器双向通信', () => { function* g() { const x = yield 1; yield x * 2; } const it = g(); it.next(); return it.next(21).value === 42; });\nawait T('async generator', async () => { async function* g() { yield 1; yield 2; } let s = 0; for await (const v of g()) s += v; return s === 3; });\nawait T('Proxy + Reflect', () => { const p = new Proxy({}, { get: (t, k) => k === 'x' ? 7 : 0 }); return p.x === 7 && Reflect.ownKeys({ a: 1 }).length === 1; });\nawait T('class 私有字段', () => { class A { #x = 1; get x() { return this.#x; } } return new A().x === 1; });\nawait T('static 块', () => { class B { static v; static { this.v = 9; } } return B.v === 9; });\nawait T('structuredClone', () => { const o = { a: [1, 2] }; const c = structuredClone(o); return c.a !== o.a && c.a[1] === 2; });\nawait T('Promise.withResolvers', async () => { const { promise, resolve } = Promise.withResolvers(); resolve(3); return await promise === 3; });\nawait T('Array.fromAsync', async () => (await Array.fromAsync((async function* () { yield 1; yield 2; })())).length === 2);\nawait T('Object.groupBy', () => Object.groupBy([1, 2, 3], n => n % 2 ? 'o' : 'e').o.length === 2);\nawait T('正则命名捕获/后行断言', () => /(?<y>\\d{4})/.exec('2026').groups.y === '2026' && /(?<=\\$)\\d+/.exec('$42')[0] === '42');\nawait T('正则 Unicode 属性', () => /\\p{Script=Han}/u.test('汉'));\nawait T('Intl.Segmenter 中文分词', () => [...new Intl.Segmenter('zh', { granularity: 'word' }).segment('汉字编码')].length >= 2);\nawait T('TypedArray 共享缓冲视图', () => new Uint8Array(new Uint16Array([258]).buffer)[0] === 2);\nawait T('TextEncoder 往返', () => new TextDecoder().decode(new TextEncoder().encode('汉字')) === '汉字');\nawait T('crypto.subtle SHA-256', async () => {\n  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));\n  return Array.from(new Uint8Array(b)).slice(0, 3).join(',') === '186,120,22';\n});\nawait T('crypto.subtle AES-GCM', async () => {\n  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);\n  const iv = crypto.getRandomValues(new Uint8Array(12));\n  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode('secret'));\n  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct)) === 'secret';\n});\nawait T('CompressionStream gzip', async () => {\n  if (typeof CompressionStream === 'undefined') return false;\n  const s = new Blob(['x'.repeat(1000)]).stream().pipeThrough(new CompressionStream('gzip'));\n  return (await new Response(s).arrayBuffer()).byteLength > 0;\n});\nawait T('Worker + Blob URL', async () => {\n  const u = URL.createObjectURL(new Blob(['onmessage=e=>postMessage(e.data*2)'], { type: 'text/javascript' }));\n  const w = new Worker(u);\n  const v = await new Promise(r => { w.onmessage = e => r(e.data); w.postMessage(21); });\n  w.terminate(); URL.revokeObjectURL(u);\n  return v === 42;\n});\nawait T('动态 import(blob:)', async () => {\n  const u = URL.createObjectURL(new Blob(['export const x = 7;'], { type: 'text/javascript' }));\n  const m = await import(u); URL.revokeObjectURL(u);\n  return m.x === 7;\n});\nawait T('DOM 创建 / 属性 / 挂载', async () => {\n  const d = document.createElement('div');\n  d.id = '__audit_el'; d.textContent = 'hi';\n  d.setAttribute('data-k', 'v');\n  const ok1 = d.getAttribute('data-k') === 'v' && d.id === '__audit_el';\n  document.body.appendChild(d);\n  await sleep(60);\n  const got = document.getElementById('__audit_el');\n  const ok2 = !!got && got.textContent === 'hi';\n  d.remove();\n  return ok1 && ok2;\n});\nawait T('Canvas 真像素', () => {\n  const c = document.createElement('canvas'); c.width = 8; c.height = 8;\n  const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 8, 8);\n  return x.getImageData(1, 1, 1, 1).data.join(',') === '255,0,0,255';\n});\nawait T('事件（主线程回放）', async () => {\n  const d = document.createElement('button');\n  document.body.appendChild(d);\n  let n = 0; d.addEventListener('click', () => n++);\n  await sleep(80); d.click(); await sleep(120); d.remove();\n  return n === 1;\n});\nawait T('localStorage 同步读写', () => { localStorage.setItem('__audit', '1'); const v = localStorage.getItem('__audit'); localStorage.removeItem('__audit'); return v === '1'; });\nawait T('fetch data: URL', async () => (await (await fetch('data:text/plain,hi')).text()) === 'hi');\n\nconsole.log('\\n===== 能力自检 =====');\n/* 不做列对齐：中英文混排的显示宽度取决于终端字体与 wcwidth 表，\n * 硬按字符数补空格反而更乱。用分隔点，读起来更稳。 */\nfor (const [k, n, d] of R) console.log(k + '  ' + n + (d ? '  · ' + d : ''));\nconst ok = R.filter(x => x[0] === 'OK  ').length;\nconsole.log('\\n通过 ' + ok + ' / ' + R.length + (ok === R.length ? ' —— 全是真跑的' : ''));\nreturn ok + '/' + R.length;\n"
  },
  '.app.bench': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'基准测试：循环 / 数组 / Map / JSON / 正则 / TypedArray', interpreter:'js' },
    content:"\n/* .app.bench —— 不是「能跑」，是「跑得怎么样」。 */\nconst rows = [];\nfunction run(name, fn, scale) {\n  fn();                                        // 预热，别把 JIT 编译算进去\n  const t0 = performance.now();\n  const r = fn();\n  const ms = performance.now() - t0;\n  rows.push({ 项目: name, 耗时: ms.toFixed(2) + 'ms', 规模: scale, 结果: String(r).slice(0, 18) });\n}\n\nrun('for 循环累加', () => { let s = 0; for (let i = 0; i < 2e7; i++) s += i; return s; }, '2e7 次');\nrun('数组 push', () => { const a = []; for (let i = 0; i < 1e6; i++) a.push(i); return a.length; }, '1e6 个');\nrun('Map set/get', () => { const m = new Map(); for (let i = 0; i < 3e5; i++) m.set('k' + i, i); let s = 0; for (let i = 0; i < 3e5; i++) s += m.get('k' + i); return s; }, '3e5 次');\nrun('TypedArray 求和', () => { const a = new Float64Array(2e6); for (let i = 0; i < a.length; i++) a[i] = i * 0.5; let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s.toFixed(0); }, '2e6 项');\nrun('JSON 往返', () => { const o = Array.from({ length: 5e4 }, (_, i) => ({ i, s: 'x' + i })); return JSON.parse(JSON.stringify(o)).length; }, '5e4 对象');\nrun('正则替换', () => 'a1b22c333'.repeat(20000).replace(/\\d+/g, '#').length, '2e5 字符');\nrun('排序 1e5', () => { const a = Array.from({ length: 1e5 }, () => Math.random()); a.sort((x, y) => x - y); return a[0] < a[99999]; }, '1e5 项');\nrun('字符串拼接', () => { let s = ''; for (let i = 0; i < 3e4; i++) s += 'x' + i; return s.length; }, '3e4 次');\nrun('BigInt 幂', () => { let n = 1n; for (let i = 0; i < 2000; i++) n = n * 3n % 1000000007n; return n; }, '2000 次');\n\nconsole.table(rows);\n\n/* 单线程跑分：整数 + 浮点混合 */\nconst t0 = performance.now();\nlet acc = 0;\nfor (let i = 0; i < 1e7; i++) acc = (acc + Math.sqrt(i) * 1.0000001) % 1e9;\nconst ms = performance.now() - t0;\nconsole.log('\\n混合计算 1e7 次：' + ms.toFixed(1) + 'ms（' + (1e7 / ms / 1000).toFixed(1) + ' Mops/s）· 校验和 ' + acc.toFixed(3));\nreturn rows.length + ' 项基准';\n"
  },
  '.app.nqueens': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'N 皇后：位运算回溯，统计解数与第一条解', interpreter:'js' },
    content:"\n/* .app.nqueens —— 递归 + 位运算。N=12 有 14200 个解。 */\nfunction solve(n, wantFirst) {\n  let count = 0, first = null;\n  const full = (1 << n) - 1;\n  const dfs = (row, cols, d1, d2, acc) => {\n    if (row === n) {\n      count++;\n      if (wantFirst && !first) first = acc.slice();\n      return;\n    }\n    let avail = full & ~(cols | d1 | d2);\n    while (avail) {\n      const bit = avail & -avail;\n      avail ^= bit;\n      const c = 31 - Math.clz32(bit);\n      acc.push(c);\n      dfs(row + 1, cols | bit, (d1 | bit) << 1, (d2 | bit) >> 1, acc);\n      acc.pop();\n    }\n  };\n  dfs(0, 0, 0, 0, []);\n  return { count, first };\n}\n\nconsole.log('N    解数        耗时');\nlet total = 0;\nfor (const n of [6, 7, 8, 9, 10, 11, 12]) {\n  const t0 = performance.now();\n  const r = solve(n, n === 8);\n  const ms = performance.now() - t0;\n  total += r.count;\n  console.log(String(n).padEnd(6) + String(r.count).padEnd(12) + ms.toFixed(1) + 'ms');\n  if (n === 8 && r.first) {\n    console.log('\\n8 皇后第一解（Q 皇后，· 空位）：');\n    for (let row = 0; row < 8; row++) {\n      let line = '  ';\n      for (let c = 0; c < 8; c++) line += (c === r.first[row] ? 'Q ' : '· ');\n      console.log(line);\n    }\n  }\n}\nconsole.log('\\n合计 ' + total + ' 个解');\nreturn total;\n"
  },
  '.app.maze': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"迷宫：DFS 生成 + A* 求最短路", interpreter:'js' },
    content:"\n/* .app.maze —— 生成与求解都是真算法，不是画图。 */\nconst N = 12;                       // 12x12 格\nconst W = N * 2 + 1, H = N * 2 + 1;\nconst g = Array.from({ length: H }, () => Array(W).fill(1));   // 1 墙 0 路\nconst seen = Array.from({ length: N }, () => Array(N).fill(false));\n\nlet seed = 20261108;\nconst rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;\n\nconst stack = [[0, 0]];\nseen[0][0] = true;\ng[1][1] = 0;\nconst DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];\nwhile (stack.length) {\n  const [x, y] = stack[stack.length - 1];\n  const next = DIRS.filter(([dx, dy]) => {\n    const nx = x + dx, ny = y + dy;\n    return nx >= 0 && ny >= 0 && nx < N && ny < N && !seen[ny][nx];\n  });\n  if (!next.length) { stack.pop(); continue; }\n  const [dx, dy] = next[(rnd() * next.length) | 0];\n  const nx = x + dx, ny = y + dy;\n  seen[ny][nx] = true;\n  g[ny * 2 + 1][nx * 2 + 1] = 0;\n  g[y * 2 + 1 + dy][x * 2 + 1 + dx] = 0;\n  stack.push([nx, ny]);\n}\n\n/* A*：曼哈顿距离，四邻域 */\nfunction astar(sx, sy, tx, ty) {\n  const key = (x, y) => y * W + x;\n  const open = [{ x: sx, y: sy, g: 0, f: 0, p: null }];\n  const best = new Map([[key(sx, sy), 0]]);\n  while (open.length) {\n    open.sort((a, b) => a.f - b.f);\n    const cur = open.shift();\n    if (cur.x === tx && cur.y === ty) {\n      const path = [];\n      for (let n = cur; n; n = n.p) path.push([n.x, n.y]);\n      return path.reverse();\n    }\n    for (const [dx, dy] of DIRS) {\n      const nx = cur.x + dx, ny = cur.y + dy;\n      if (nx < 0 || ny < 0 || nx >= W || ny >= H || g[ny][nx]) continue;\n      const ng = cur.g + 1;\n      const k = key(nx, ny);\n      if (best.has(k) && best.get(k) <= ng) continue;\n      best.set(k, ng);\n      open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(nx - tx) + Math.abs(ny - ty), p: cur });\n    }\n  }\n  return null;\n}\n\nconst path = astar(1, 1, W - 2, H - 2);\nconst mark = new Set(path.map(([x, y]) => y * W + x));\n\nlet out = '';\nfor (let y = 0; y < H; y++) {\n  let line = '';\n  for (let x = 0; x < W; x++) {\n    if (x === 1 && y === 1) line += 'S';\n    else if (x === W - 2 && y === H - 2) line += 'E';\n    else if (mark.has(y * W + x)) line += '\\x1b[36m·\\x1b[0m';\n    else line += g[y][x] ? '\\x1b[90m█\\x1b[0m' : ' ';\n  }\n  out += line + '\\n';\n}\nconsole.log(out);\nconsole.log('迷宫 ' + N + 'x' + N + ' · 最短路 ' + path.length + ' 步');\nreturn path.length;\n"
  },
  '.app.raytrace': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:"光线追踪：球体求交 + 兰伯特光照，ASCII 出图", interpreter:'js' },
    content:"\n/* .app.raytrace —— 每像素一条光线，真有交点、真有法线。 */\nconst sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];\nconst add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];\nconst mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];\nconst dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];\nconst norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));\n\nconst SPHERES = [\n  { c: [-1.1, 0, -3.2], r: 0.85, col: 0.95 },\n  { c: [0.9, -0.25, -2.6], r: 0.55, col: 0.65 },\n  { c: [0.2, 1.1, -4.5], r: 0.7, col: 0.8 }\n];\nconst LIGHT = norm([-0.6, 0.9, 0.4]);\nconst W = 78, H = 34;\nconst CH = ' .:-=+*#%@';\n\nfunction trace(o, d) {\n  let best = Infinity, hit = null;\n  for (const s of SPHERES) {\n    const oc = sub(o, s.c);\n    const b = dot(oc, d);\n    const c = dot(oc, oc) - s.r * s.r;\n    const disc = b * b - c;\n    if (disc < 0) continue;\n    const t = -b - Math.sqrt(disc);\n    if (t > 0.001 && t < best) { best = t; hit = { s, t }; }\n  }\n  /* 地面：y = -1，取最近的一个正交点 */\n  if (Math.abs(d[1]) > 1e-6) {\n    const t = (-1 - o[1]) / d[1];\n    if (t > 0.001 && t < best) { best = t; hit = { ground: true, t }; }\n  }\n  if (!hit) return 0;\n  const p = add(o, mul(d, hit.t));\n  let n;\n  if (hit.ground) {\n    n = [0, 1, 0];\n    /* 棋盘格，不然地面是一整块灰 */\n    const k = (Math.floor(p[0] / 5) + Math.floor(p[2] / 5)) & 1;\n    if (k) return 0.030;\n  } else n = norm(sub(p, hit.s.c));\n  const diff = Math.max(0, dot(n, LIGHT));\n  const amb = 0.10;\n  const v = hit.ground ? (0.085 + diff * 0.13) : (amb + diff * 0.98 * hit.s.col);\n  /* 距离雾：远处地面淡出，不然棋盘纹会一直铺到天边 */\n  const fog = Math.max(0.12, 1 - best / 20);\n  return Math.min(1, v * (hit.ground ? fog : (0.55 + 0.45 * fog)));\n}\n\nconsole.log('渲染 ' + W + 'x' + H + ' · ' + SPHERES.length + ' 球 + 地面');\nconst t0 = performance.now();\nlet out = '';\nfor (let y = 0; y < H; y++) {\n  let line = '';\n  for (let x = 0; x < W; x++) {\n    const px = (x / W * 2 - 1) * 1.9;\n    const py = (1 - y / H * 2) * 0.95;\n    const d = norm([px, py, -1]);\n    const v = trace([0, 0.25, 0], d);\n    line += CH[Math.min(CH.length - 1, Math.round(Math.pow(v, 0.7) * (CH.length - 1)))];\n  }\n  out += line + '\\n';\n}\nconsole.log(out);\nconsole.log('光线 ' + (W * H) + ' 条 · ' + (performance.now() - t0).toFixed(1) + 'ms');\nreturn W * H;\n"
  },
  '.app.ask': {
    kind:'func', mime:'application/javascript',
    meta:{ hint:'向用户要一个文件并统计行数', interpreter:'js' },
    content:`const p = await askFile({ title:'选一个文本文件' });
if (!p) { print('没有选择文件'); return; }
const r = await fs.read(p);
const lines = String(r.content || '').split('\\n').length;
print('已放入', p, '，共', lines, '行');`
  },
  '.doc.version': { kind:'file', mime:'text/plain', content:'HTerMinaL ' + HT_VERSION + '\nJSHeL / 一切皆文件\nApache-2.0 OR MIT\n' },
  '.doc.license': { kind:'file', mime:'text/plain', content:`Apache License 2.0 OR MIT（双许可，任选其一）

Copyright (c) 2026 HTerMinaL contributors

本项目由 AI 智能体生成并维护。第三方组件：
  xterm.js                   MIT
  @xterm/addon-fit           MIT
  @xterm/addon-unicode11     MIT
  marked                     MIT
  html2canvas                MIT
  Pyodide                    MPL-2.0
完整原文见仓库 licenses/ 目录与 README。` },
  '.doc.mount': { kind:'file', mime:'text/markdown;charset=utf-8', meta:{ type:'text', hint:'spotfs ↔ FreeBSD 挂载说明' }, content:`# 把 spotfs 挂到 FreeBSD 的 /spotfs

目标：hsb2（FreeBSD）里 \`mount\` 一下就能读写同一份节点，路径映射是
\`/spotfs/.home.x\` ↔ \`spotfs:.home.x\`。

## 现在的状态

**还没接上，只完成了宿主这一侧的准备。**

\`FS.spotfsTable(prefix)\` 会把节点导出成一张表（path / kind / size / meta / type），
\`Spot.write|read|remove\` 就是读写口。也就是说「数据和语义」这一层已经就绪。

## 为什么没做完

v86 只模拟 IDE / 网卡 / 串口，**没有 virtio-9p**。要有真挂载点，得在 guest 里跑一个
用户态文件系统进程（FUSE 或 mount_pseudo + 一个把 HTTP 桥成 inode 的守护），
再把 v86 的串口/网卡接到宿主。这是一个独立工程，不适合塞进内核窗口里。

## 如果要做，接口已经定好

    host:  GET  /spotfs/list?p=.home      -> [{path,kind,size,type}]
    host:  GET  /spotfs/read?p=.home.a    -> 原始字节 + meta 头
    host:  PUT  /spotfs/write?p=.home.a   -> 覆盖（不存在则 409，要用 create）
    host:  POST /spotfs/create?p=.home.b  -> 新建空节点
    host:  DELETE /spotfs/remove?p=...    -> 删除

guest: 一个 200 行的 FUSE 守护把这些转成 inode 操作即可；\`.perm\` 之类的只读规则
由宿主返回 403，守护只需透传错误码。
` },
  '.doc.about': { kind:'file', mime:'text/plain', content:`HTerMinaL
浏览器里的 JS 终端 / 一切皆文件桌面 / 智能体宿主 HarTMLes

一个自包含的 index.html，加上三个可选的单文件模型转发后端。
没有构建步骤，没有账号，没有云端。

Apache-2.0 OR MIT · 由 AI 智能体生成并维护` },
  '.config.settings': { kind:'object', mime:'application/json', content:'{}' },
  '.config.agent': { kind:'object', mime:'application/json', content:'{}' },
  '.agent.session': { kind:'file', mime:'application/x-ndjson', content:'' },
};

/* ---------------------------------------------------------------- IndexedDB */
/* IndexedDB 是"持久化"的实现，不是运行前提。
 * 有三类环境 open() 会直接抛 SecurityError 或立刻 error：
 *   · Safari 无痕窗口（旧版）、部分浏览器的 file:// 页面
 *   · 企业策略 / 隐私插件关闭站点数据
 *   · 存储被用户清空到配额为 0
 * 以前这里拒绝 Promise，FS.init() 第一句 await 就抛，整个终端起不来 ——
 * 表现和"必须开后端"一模一样，其实跟后端毫无关系。
 * 现在失败就切内存模式：文件系统照常工作，只是刷新后丢失。 */
const IDB = {
  db: null,
  NAME: 'hterm-fs', STORE: 'files',
  mem: new Map(),          // 内存模式下的文件表（path -> rec）
  memMode: false,          // true = 本次会话不落盘
  open() {
    if (this.db) return Promise.resolve(this.db);
    if (this.memMode) return Promise.resolve(null);
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(this.NAME, 1); }
      catch (e) { this.memMode = true; return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          const st = db.createObjectStore(this.STORE, { keyPath:'path' });
          st.createIndex('parent', 'parent', { unique:false });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => { this.memMode = true; resolve(null); };
      req.onblocked = () => { this.memMode = true; resolve(null); };
    });
  },
  tx(mode) { return this.db.transaction(this.STORE, mode).objectStore(this.STORE); },
  async get(path) {
    const db = await this.open();
    if (!db) return this.mem.get(path) || null;
    return new Promise((res) => {
      const r = this.tx('readonly').get(path);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  },
  async put(rec) {
    const db = await this.open();
    if (!db) { this.mem.set(rec.path, rec); return rec; }
    return new Promise((res) => {
      const r = this.tx('readwrite').put(rec);
      r.onsuccess = () => res(rec);
      r.onerror = () => { this.mem.set(rec.path, rec); res(rec); };
    });
  },
  async del(path) {
    const db = await this.open();
    if (!db) { this.mem.delete(path); return true; }
    return new Promise((res) => {
      const r = this.tx('readwrite').delete(path);
      r.onsuccess = () => res(true);
      r.onerror = () => res(false);
    });
  },
  async all() {
    const db = await this.open();
    if (!db) return [...this.mem.values()];
    return new Promise((res) => {
      const r = this.tx('readonly').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    });
  },
  async keys() {
    const db = await this.open();
    if (!db) return [...this.mem.keys()];
    return new Promise((res) => {
      const r = this.tx('readonly').getAllKeys();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    });
  },
  async clear() {
    const db = await this.open();
    if (!db) { this.mem.clear(); return true; }
    return new Promise((res) => {
      const r = this.tx('readwrite').clear();
      r.onsuccess = () => res(true);
      r.onerror = () => res(false);
    });
  }
};

/* ---------------------------------------------------------------- FS */
const FS = {
  idx: new Map(),          // lowerPath -> {path, kind, size, mtime, meta}
  temp: new Map(),         // .temp.* 内存存储
  seeded: false,

  async init() {
    await IDB.open();
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
    if (!this.idx.size) await this.seed();
    else {
      // 补齐内置目录/应用（升级时不丢用户数据）
      await this.ensureBuiltins();
      await this.migrateBinDir();
      await this.migrateDocDir();
      await this.syncIndex();
    }
    this.persistIndex();
    rebuildLsMap();
    /* 存储不可用要让人知道，否则「刷新一下文件全没了」会被当成 bug。
     * 延迟一拍，等 toast 容器挂好。 */
    if (IDB.memMode) setTimeout(() => {
      try { toast('浏览器禁用了本地存储：本次会话不落盘，刷新即丢', true); } catch (e) {}
    }, 1200);
    try {
      const s = await IDB.get('.config.settings');
      if (s && s.content && s.content !== '{}') {
        const saved = JSON.parse(s.content);
        Settings.data = Object.assign({}, Settings.data, saved);
        try { localStorage.setItem('ht.settings', JSON.stringify(Settings.data)); } catch (e) {}
      }
    } catch (e) {}
  },

  async seed() {
    const t = Date.now();
    const put = (path, kind, content, meta) => IDB.put({
      path, parent:parentPath(path), name:baseName(path), kind,
      content: content == null ? '' : content, meta: meta || {},
      ctime:t, mtime:t, size: contentSize(content)
    });
    await put('.', 'dir', '', { hint:'根目录' });
    for (const d of DIRS) await put(d, 'dir', '', { hint:'系统目录' });
    for (const [p, f] of Object.entries(SEED_FILES)) {
      await put(p, f.kind, f.content, Object.assign({ hint:'' }, f.meta || {}, f.mime ? { mime:f.mime } : {}));
    }
    for (const a of APP_DEFS) await put('.app.' + a.name, 'app', '', { app:a.name, hint:a.desc, icon:a.icon, title:a.title, type:'app', exec:'native' });
    for (const d of DEV_DEFS) await put('.dev.' + d.name, 'device', '', { device:d.device, hint:d.hint });
    for (const p of PERM_DEFS) await put('.perm.' + p.name, 'grant', '', { perm:p.name, hint:p.hint });
    this.seeded = true;
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
  },

  async ensureBuiltins() {
    const t = Date.now();
    const put = (path, kind, content, meta) => IDB.put({
      path, parent:parentPath(path), name:baseName(path), kind,
      content: content == null ? '' : content, meta: meta || {},
      ctime:t, mtime:t, size: contentSize(content)
    });
    if (!this.idx.has('.')) await put('.', 'dir', '', { hint:'根目录' });
    for (const d of DIRS) if (!this.idx.has(d)) await put(d, 'dir', '', { hint:'系统目录' });
    for (const a of APP_DEFS) if (!this.idx.has('.app.' + a.name)) await put('.app.' + a.name, 'app', '', { app:a.name, hint:a.desc, icon:a.icon, title:a.title, type:'app', exec:'native' });
    for (const d of DEV_DEFS) if (!this.idx.has('.dev.' + d.name)) await put('.dev.' + d.name, 'device', '', { device:d.device, hint:d.hint });
    for (const p of PERM_DEFS) if (!this.idx.has('.perm.' + p.name)) await put('.perm.' + p.name, 'grant', '', { perm:p.name, hint:p.hint });
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
  },

  /* 旧版本把可执行脚本放在 .bin，新版本统一进 .app（装的不是二进制，是应用）。
   * 只搬一次：目标已存在就不覆盖，搬完删掉旧节点和空目录。 */
  async migrateBinDir() {
    if (!this.idx.has('.bin')) return 0;
    const kids = [...this.idx.keys()].filter(k => k.startsWith('.bin.'));
    let n = 0;
    for (const k of kids) {
      const target = '.app.' + k.slice(5);
      if (!this.idx.has(target)) {
        const r = await IDB.get(k);
        if (r) {
          await IDB.put(Object.assign({}, r, { path: target, parent: '.app', name: baseName(target) }));
          n++;
        }
      }
      await IDB.del(k);
    }
    await IDB.del('.bin');
    return n;
  },

  /* 0.0.1.34 把只读系统信息目录 `.sys` 改名成 `.doc`（里面本来全是文档）。
   * 搬一次：先把旧节点挪过去（目标已存在就不覆盖），再删旧目录。 */
  async migrateDocDir() {
    if (!this.idx.has('.sys')) return 0;
    const kids = [...this.idx.keys()].filter(k => k.startsWith('.sys.'));
    let n = 0;
    for (const k of kids) {
      const target = '.doc' + k.slice(4);
      if (!this.idx.has(target)) {
        const r = await IDB.get(k);
        if (r) { await IDB.put(Object.assign({}, r, { path:target, parent:'.doc', name:baseName(target) })); n++; }
      }
      await IDB.del(k);
    }
    await IDB.del('.sys');
    return n;
  },

  async syncIndex() {
    const all = await IDB.all();
    this.idx.clear();
    for (const r of all) this.idx.set(r.path, metaOf(r));
  },

  persistIndex() {
    try {
      const o = {};
      for (const [k, v] of this.idx) o[k] = v.kind;
      const s = JSON.stringify(o);
      if (s.length < 1500000) localStorage.setItem('ht.fs.index', s);
    } catch (e) {}
  },

  exists(p) { return this.idx.has(p) || this.temp.has(p) || DIRS.indexOf(p) >= 0 || this.virtualStat(p); },
  isVirtual(p) {
    return p === '.proc' || p.startsWith('.proc.') || p === '.localstorage' || p.startsWith('.localstorage.') ||
      p === '.pkg' || p.startsWith('.pkg.') || p === '.temp' || p.startsWith('.temp.') ||
      p === '.queryfile' || p.startsWith('.queryfile.');
  },

  virtualStat(p) {
    if (p === '.proc') return { path:p, name:'proc', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'进程/线程' } };
    if (p.startsWith('.proc.')) {
      const pid = Number(p.slice(6));
      const pr = Proc.list().find(x => x.pid === pid);
      if (pr) return { path:p, name:String(pid), kind:'proc', size:0, mtime:Date.now(), meta:{ pid, hint:pr.title, state:pr.state, role:pr.role, cwd:pr.cwd } };
    }
    if (p === '.localstorage') return { path:p, name:'localstorage', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'localStorage 镜像' } };
    if (p.startsWith('.localstorage.')) {
      const key = decodeLsName(p.slice(14));
      const v = localStorage.getItem('ht.ls.' + key);
      if (v !== null) return { path:p, name:baseName(p), kind:'file', size:v.length, mtime:Date.now(), meta:{ hint:'localStorage', lsKey:key, mime:'text/plain' }, content:v };
    }
    if (p === '.pkg') return { path:p, name:'pkg', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'已安装的包' } };
    if (p.startsWith('.pkg.')) {
      const spec = Pkg.getSpecByPath(p);
      if (spec) return { path:p, name:baseName(p), kind:'package', size:0, mtime:Date.now(), meta:{ hint:spec.spec, spec:spec.spec, url:spec.url, name:spec.name } };
    }
    if (p === '.temp') return { path:p, name:'temp', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'临时文件（刷新即失）' } };
    if (p.startsWith('.temp.')) {
      const v = this.temp.get(p);
      if (v) return { path:p, name:baseName(p), kind:'file', size:String(v.content || '').length, mtime:v.mtime, meta:v.meta || {}, content:v.content };
    }
    if (p === '.queryfile') return { path:p, name:'queryfile', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'用户提供的文件' } };
    return null;
  },

  async list(p) {
    p = normPath(p || '.');
    const out = new Map();
    const add = (rec) => {
      if (rec.path === p) return;
      if (parentPath(rec.path) !== p) return;
      const name = baseName(rec.path);
      out.set(name, {
        name, path:rec.path, kind:rec.kind, size:rec.size || 0, mtime:rec.mtime || Date.now(),
        meta:rec.meta || {}, hint:(rec.meta && rec.meta.hint) || ''
      });
    };
    for (const rec of this.idx.values()) add(rec);
    if (p === '.') {
      for (const d of DIRS) {
        const rec = this.idx.get(d);
        if (rec) add(rec); else add({ path:d, kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'系统目录' } });
      }
    }
    for (const [path, v] of this.temp) add({ path, kind:'file', size:String(v.content || '').length, mtime:v.mtime, meta:v.meta || {} });
    if (p === '.proc') {
      for (const pr of Proc.list()) add({ path:'.proc.' + pr.pid, kind:'proc', size:0, mtime:Date.now(), meta:{ hint:pr.title, pid:pr.pid, state:pr.state } });
    }
    if (p === '.localstorage') {
      for (const k of lsKeys()) {
        const name = encodeLsName(k);
        add({ path:'.localstorage.' + name, kind:'file', size:(localStorage.getItem('ht.ls.' + k) || '').length, mtime:Date.now(), meta:{ hint:'localStorage', lsKey:k } });
      }
    }
    if (p === '.pkg') {
      for (const pk of Pkg.list()) {
        const name = pkgPathName(pk.spec);
        add({ path:'.pkg.' + name, kind:'package', size:0, mtime:pk.at || Date.now(), meta:{ hint:pk.spec, spec:pk.spec, url:pk.url, name:pk.name } });
      }
    }
    const arr = [...out.values()];
    // 隐藏内部 . 前缀（除根目录）
    return arr.sort(byName);
  },

  async stat(p) {
    p = normPath(p);
    if (p === '.') return { path:'.', name:'.', kind:'dir', size:0, mtime:Date.now(), meta:{ hint:'根目录' } };
    const v = this.virtualStat(p);
    if (v) return v;
    if (this.temp.has(p)) {
      const t = this.temp.get(p);
      return { path:p, name:baseName(p), kind:'file', size:String(t.content || '').length, mtime:t.mtime, meta:t.meta || {}, content:t.content };
    }
    const rec = this.idx.get(p);
    return rec ? Object.assign({}, rec) : null;
  },

  async read(p) {
    p = normPath(p);
    const v = this.virtualStat(p);
    if (v) {
      if (v.kind === 'dir') return Object.assign({}, v, { content:null });
      if (v.content !== undefined) return v;
      if (v.kind === 'package') return Object.assign({}, v, { content:'' });
      return Object.assign({}, v, { content:'' });
    }
    if (this.temp.has(p)) {
      const t = this.temp.get(p);
      return { path:p, name:baseName(p), kind:'file', size:String(t.content || '').length, mtime:t.mtime, meta:t.meta || {}, content:t.content };
    }
    const rec = await IDB.get(p);
    if (!rec) throw new Error('文件不存在: ' + p);
    return Object.assign({}, rec);
  },

  async write(p, data, meta) {
    p = normPath(p);
    if (p === '.' || p === '.doc' || p.startsWith('.doc.')) throw new Error('只读路径: ' + p);
    /* .app 里有两类节点：内置应用（kind=app，只读）和用户装的脚本应用（kind=func，可改可删）。
     * 一刀切禁止整个 .app 会让「装进 .app 的脚本」永远改不了。 */
    const oldNode = this.idx.get(p);
    const appLocked = p === '.app' || (p.startsWith('.app.') && (!oldNode || oldNode.kind === 'app'));
    if (p === '.proc' || p.startsWith('.proc.') || p === '.dev' || p.startsWith('.dev.') || appLocked || p === '.perm' || p.startsWith('.perm.')) {
      throw new Error('系统路径不可写: ' + p);
    }
    const seg = baseName(p);
    const err = checkName(seg);
    if (err) throw new Error(err + '（' + seg + '）');
    /* 父目录必须存在。点号既是分隔符又常被当成扩展名，于是
     * `write(".home.a.txt")` 会被解析成「.home.a 目录下的 txt」，
     * 默默在不存在的地方造一个谁也看不见的文件（`ls .home` 永远列不出来）。
     * 与其留下幽灵，不如当场报错——这也和 mkdir 的规则保持一致。 */
    const par = parentPath(p);
    if (par !== '.' && !this.exists(par) && !this.temp.has(par)) {
      throw new Error('父目录不存在: ' + par + '（点名就是路径分隔符，文件名不要带点）');
    }
    if (p.startsWith('.localstorage.')) {
      const key = decodeLsName(p.slice(14));
      if (key === null) throw new Error('localStorage 键名不合法');
      lsSet(key, String(data == null ? '' : data));
      this.persistIndex();
      return this.stat(p);
    }
    meta = Object.assign({}, meta || {});
    if (!meta.mime) meta.mime = guessMime(p, data);
    if (p.startsWith('.temp.')) {
      const rec = { content:data == null ? '' : data, meta, mtime:Date.now() };
      this.temp.set(p, rec);
      return { path:p, name:seg, kind:'file', size:String(data || '').length, mtime:rec.mtime, meta };
    }
    let kind = meta.kind || 'file';
    const old = this.idx.get(p);
    /* kind 不随「写内容」丢失，这是两处必须一起改的地方：
     * ①改一个已有的 .app 函数（比如 vim 里存盘）不能把它降级成普通文本，否则下次 exec 就报
     *   「不是可执行对象」；
     * ②新建 .app.* 默认就是可执行函数——README 说过「.app 里放的是函数，content 被编译成
     *   AsyncFunction」。以前这里有一行 `if (!this.exists(p) && /\.app\./.test(p)) kind = kind || 'file'`，
     *   等于什么都没做（kind 本来就是 'file'），于是 `write('.app.hi','return 42')` 之后
     *   `exec('.app.hi')` 必然失败。 */
    if (!meta.kind) {
      if (old && old.kind && old.kind !== 'dir') kind = old.kind;
      else if (/^\.app\./.test(p)) kind = 'func';
    }
    const rec = {
      path:p, parent:parentPath(p), name:seg, kind,
      content:data == null ? '' : data, meta,
      ctime:old ? old.ctime || Date.now() : Date.now(), mtime:Date.now(),
      size:contentSize(data)
    };
    delete meta.kind;
    await IDB.put(rec);
    this.idx.set(p, metaOf(rec));
    this.persistIndex();
    EventBus.emit('fs', { type:'write', path:p });
    return Object.assign({}, rec);
  },

  async mkdir(p) {
    p = normPath(p);
    if (this.exists(p)) throw new Error('已存在: ' + p);
    const seg = baseName(p);
    const err = checkName(seg);
    if (err) throw new Error(err);
    if (!this.exists(parentPath(p))) throw new Error('父目录不存在: ' + parentPath(p));
    const rec = { path:p, parent:parentPath(p), name:seg, kind:'dir', content:'', meta:{ hint:'目录' }, ctime:Date.now(), mtime:Date.now(), size:0 };
    await IDB.put(rec);
    this.idx.set(p, metaOf(rec));
    this.persistIndex();
    EventBus.emit('fs', { type:'mkdir', path:p });
    return rec;
  },

  async remove(p, recursive) {
    p = normPath(p);
    if (p === '.' || DIRS.includes(p) || p.startsWith('.doc.') ||
        (p.startsWith('.app.') && (this.idx.get(p) || {}).kind === 'app') ||
        p.startsWith('.dev.') || p.startsWith('.perm.')) {
      throw new Error('不可删除: ' + p);
    }
    if (p.startsWith('.localstorage.')) {
      const key = decodeLsName(p.slice(14));
      localStorage.removeItem('ht.ls.' + key);
      EventBus.emit('fs', { type:'remove', path:p });
      return true;
    }
    if (p.startsWith('.temp.')) { this.temp.delete(p); EventBus.emit('fs', { type:'remove', path:p }); return true; }
    if (p.startsWith('.pkg.')) { const pk = Pkg.getSpecByPath(p); if (pk) Pkg.remove(pk.spec); EventBus.emit('fs', { type:'remove', path:p }); return true; }
    const st = await this.stat(p);
    if (!st) throw new Error('不存在: ' + p);
    if (st.kind === 'dir') {
      const kids = await this.list(p);
      if (kids.length && !recursive) throw new Error('目录非空（用 {r:true}）: ' + p);
      for (const k of kids) await this.remove(k.path, true);
    }
    await IDB.del(p);
    this.idx.delete(p);
    this.persistIndex();
    EventBus.emit('fs', { type:'remove', path:p });
    return true;
  },

  async move(a, b) {
    a = normPath(a); b = normPath(b);
    const st = await this.stat(a);
    if (!st) throw new Error('不存在: ' + a);
    if (st.kind === 'dir') {
      const kids = await this.list(a);
      for (const k of kids) await this.move(k.path, b + k.path.slice(a.length));
      await this.remove(a, true);
      return true;
    }
    const rec = await this.read(a);
    await this.write(b, rec.content, rec.meta);
    await this.remove(a, false);
    return true;
  },

  async copy(a, b) {
    const st = await this.stat(a);
    if (!st) throw new Error('不存在: ' + a);
    if (st.kind === 'dir') {
      await this.mkdir(b);
      for (const k of await this.list(a)) await this.copy(k.path, b + k.path.slice(a.length));
      return true;
    }
    const rec = await this.read(a);
    await this.write(b, rec.content, rec.meta);
    return true;
  },

  /* ---------------- spotfs：六个 syscall + 元数据 ----------------
   * spotfs 是「节点对象图」，不是 ext4；没有 inode、没有权限位、没有属主。
   * 六个原子操作，建 / 读 / 覆盖写 / 追加 一律分开——想要「新建并写入」就调两次，
   * 不再有「一次调用顺手把内容塞进去」的捷径（那会让「新建」这个动作失去意义）。
   *   c cover   sptc(p, data, meta)  覆盖写入：只能覆盖已存在的非目录节点
   *   n new     sptn(p, opts)        新建：只建空节点；.queryfile 请求文件 / .savefile 待保存
   *   a append  spta(p, data)        在末尾追加
   *   x execute sptx(p, args)        执行：返回「动作描述」，由当前环境落地
   *   r read    sptr(p, opts)        读内容（文件）或索引（目录/对象）；queryfile 读完即焚
   *   d delete  sptd(p)              删除：文件删 / 目录递归 / 进程杀 / 链接删
   * 外加两个元数据操作（也是单独的，不夹在别的调用里）：
   *   sptmetaread(p) / sptmetawrite(p, patch)
   */

  /* ---------------------------------------------------------------- 能力
   * 没有用户、没有属主，所以也没有「权限位」可设——这里是一张**预设规则表**，
   * 对谁都一样，改不了（真要改只能改代码）。它存在的意义不是「防」，而是
   * 告诉界面「这件事对这个节点有没有意义」，顺便挡掉会把页面逻辑搞坏的误操作
   * （比如删掉根目录、往 .perm 里写文件）。
   *
   * 返回 { r, w, x, d, mk, why }：
   *   r 读内容 · w 改内容 · x 执行/进入 · d 删除 · mk 在**这个目录里**新建
   */
  caps(p) {
    p = normPath(p);
    const node = this.virtualStat(p) || this.idx.get(p) || (this.temp.has(p) ? this.temp.get(p) : null);
    const kind = node ? (node.kind || 'file') : null;
    const cap = (r, w, x, d, mk, why) => ({ r:!!r, w:!!w, x:!!x, d:!!d, mk:!!mk, why:why || '' });

    if (p === '.') return cap(1, 0, 1, 0, 0, '根目录只用来穿越：不能新建、删除、挂载');
    if (DIRS.includes(p)) {
      if (p === '.proc') return cap(1, 0, 1, 0, 0, '进程表由内核维护');
      if (p === '.perm') return cap(1, 0, 1, 0, 0, '授权表只读；子项只能「申请」');
      if (p === '.dev') return cap(1, 0, 1, 0, 0, '设备由内核枚举');
      if (p === '.doc') return cap(1, 0, 1, 0, 0, '文档区只读');
      if (p === '.queryfile') return cap(1, 0, 1, 0, 1, '只能向用户要文件，不能自己造');
      if (p === '.savefile') return cap(1, 0, 1, 0, 1, '只能新建「待保存」节点');
      if (p === '.app') return cap(1, 0, 1, 0, 1, '可以装脚本应用，但不能删目录');
      return cap(1, 1, 1, 0, 1, '');
    }
    /* .perm 里的项：内容不可读，执行 = 申请授权 */
    if (p.startsWith('.perm.')) return cap(0, 0, 1, 0, 0, '授权项不读内容，执行=申请');
    /* .doc 里的文档：只读 */
    if (p.startsWith('.doc.')) return cap(1, 0, 0, 0, 0, '文档区只读：能看，不能改、不能执行');
    /* .proc.<pid>：读状态；删除 = 结束进程（对应窗口/后台一并关掉） */
    if (p.startsWith('.proc.')) return cap(1, 0, 0, 1, 0, '删除 = 结束这个进程');
    if (p.startsWith('.dev.')) return cap(1, 1, 1, 0, 0, '');
    /* 用户交进来的：读一次即消费，不能写 */
    if (p.startsWith('.queryfile.')) return cap(1, 0, 0, 1, 0, '用户交进来的文件：读一次即消费');
    /* 待保存的：写 = 保存到本机，节点随即消失 */
    if (p.startsWith('.savefile.')) return cap(1, 1, 0, 1, 0, '写入即保存到本机，节点随即消失');
    /* .app 里的：内置应用只读，脚本/页面可改可删 */
    if (p.startsWith('.app.')) {
      if (kind === 'app') return cap(1, 0, 1, 0, 0, '内置应用：不可改、不可删');
      return cap(1, 1, 1, 1, 0, '');
    }
    if (kind === 'dir') return cap(1, 1, 1, 1, 1, '');
    if (kind === 'grant') return cap(0, 0, 1, 0, 0, '授权项不读内容，执行=申请');
    if (kind === 'proc') return cap(1, 0, 0, 1, 0, '删除 = 结束进程');
    if (kind === 'device') return cap(1, 1, 1, 0, 0, '');
    /* 普通文件：能不能「执行」看类型，不看后缀——
     * 代码 / 页面 / 应用可以跑；文本、图片、音频只能看。 */
    const t = this.typeOf(node);
    const x = (t === 'code' || t === 'page' || t === 'app' || t === 'wasm') ? 1 : 0;
    return cap(1, 1, x, 1, 0, x ? '' : '这是 ' + t + '，没有可执行入口');
  },
  can(p, op) { return !!this.caps(p)[op]; },
  assert(p, op) {
    const c = this.caps(p);
    if (c[op]) return c;
    const names = { r:'读', w:'写', x:'执行', d:'删除', mk:'新建' };
    throw new Error((names[op] || op) + '不了「' + normPath(p) + '」' + (c.why ? '：' + c.why : ''));
  },

  /* ---------------------------------------------------------------- 类型判定
   * 顺序是**元数据 → 魔数 → 后缀**。
   * 后缀最不可信（一个 .txt 里可以是 wasm），魔数能看穿伪装，而元数据里写的是
   * 「这个节点到底是什么」——它由导入 / 保存 / 安装时自动写入，是首选依据。
   */
  sniff(data) {
    if (data == null) return null;
    let u8 = null;
    if (data instanceof ArrayBuffer) u8 = new Uint8Array(data.slice(0, 16));
    else if (data instanceof Uint8Array) u8 = data.subarray(0, 16);
    else if (data instanceof Blob) return null;      // Blob 要异步读，交给调用方
    else if (typeof data === 'string') {
      const h = data.slice(0, 5);
      if (/^\s*<!doctype html|^\s*<html/i.test(data.slice(0, 64))) return 'page';
      if (h === '\x00asm') return 'wasm';
      return 'text';
    }
    if (!u8 || u8.length < 4) return null;
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'image';
    if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'image';
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image';
    if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) return 'media';
    if (u8[0] === 0x00 && u8[1] === 0x61 && u8[2] === 0x73 && u8[3] === 0x6D) return 'wasm';
    if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) return 'archive';
    if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'document';
    return null;
  },
  typeOf(st, data) {
    if (!st) return 'none';
    const m = st.meta || {};
    if (m.type) return m.type;
    if (m.mime) {
      const t = String(m.mime);
      if (/^image\//.test(t)) return 'image';
      if (/^audio\//.test(t)) return 'audio';
      if (/^video\//.test(t)) return 'video';
      if (/html/.test(t)) return 'page';
      if (/javascript|ecmascript/.test(t)) return 'code';
      if (/json|xml|csv|yaml|markdown|text\//.test(t)) return 'text';
    }
    switch (st.kind) {
      case 'dir': return 'dir';
      case 'app': return 'app';
      case 'func': return 'code';
      case 'device': return 'device';
      case 'grant': return 'perm';
      case 'proc': return 'process';
      case 'package': return 'package';
      case 'object': return 'object';
    }
    const magic = this.sniff(data);
    if (magic) return magic;
    return 'text';
  },

  /* ---------------------------------------------------------------- 自动名字
   * `auto-2027-01-02T12-32-45-01`：秒级时间戳 + 两位序号。
   * 一秒内要多于 99 个就往后接一段：-99-01、-99-02……（横线本身就是分隔符，
   * 不会和序号混淆）。冒号换成短横线，因为 spotfs 名字里不允许它。
   */
  autoName(dir) {
    const p2 = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + '-' + p2(d.getMinutes()) + '-' + p2(d.getSeconds());
    const seq = (n, depth) => {
      if (n <= 99) return '-' + p2(n);
      if (depth > 6) return '-' + p2(n % 100);
      return seq(99, depth + 1) + seq(n - 99, depth + 1);
    };
    for (let i = 1; i < 100000; i++) {
      const name = 'auto-' + stamp + seq(i, 0);
      const path = (dir && dir !== '.' ? dir + '.' : '.') + name;
      if (!this.exists(normPath(path))) return normPath(path);
    }
    throw new Error('autoName: 名字用完了');
  },

  async sptc(p, data, meta) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) throw new Error('sptc: 不存在，不能覆盖（新建请用 sptn）: ' + p);
    if (st.kind === 'dir') throw new Error('sptc: 不能覆盖目录: ' + p);
    this.assert(p, 'w');
    if (st.kind === 'device') {
      return { path:p, kind:'device', device:(st.meta || {}).device, wrote:String(data == null ? '' : data).length };
    }
    await this.write(p, data, Object.assign({}, st.meta || {}, meta || {}));
    /* .savefile：写完了就等于「用户点了保存」。不论成没成，节点都消失——
     * 它本来就只是个「待保存」的筐，不是存储。 */
    if (parentPath(p) === '.savefile') {
      await this.flushSavefile(p);
      return { path:p, kind:'savefile', saved:true };
    }
    return this.stat(p);
  },

  /* 新建：**只建不写**。想写就再调一次 sptc。
   * p 可以是完整路径，也可以是目录（此时用 opts.name，或自动起名）。 */
  async sptn(p, opts) {
    opts = opts || {};
    let path = p ? normPath(p) : null;
    let st0 = path ? await this.stat(path) : null;
    if (!path || (st0 && st0.kind === 'dir')) {
      const dir = (st0 && st0.kind === 'dir') ? path : normPath(opts.dir || '.home');
      const name = opts.name ? sanitizeName(opts.name, 'file') : null;
      path = name ? dir + '.' + name : this.autoName(dir);
      st0 = null;
    }
    if (opts.kind === 'dir') {
      this.assert(parentPath(path), 'mk');
      if (this.exists(path)) throw new Error('sptn: 已存在: ' + path);
      await this.mkdir(path);
      return this.stat(path);
    }
    if (opts.data !== undefined) {
      throw new Error('sptn: 只新建、不写入。要写内容请紧接着调 sptc(' + path + ', data)');
    }
    const par = parentPath(path);
    this.assert(par, 'mk');
    if (this.exists(path)) throw new Error('sptn: 已存在，请用 sptc 覆盖: ' + path);

    /* .queryfile 下的「新建」= 向用户要一个文件（要回来的东西是只读的一次性副本） */
    if (par === '.queryfile') {
      const got = await askFile({ multiple:false, accept:opts.accept });
      return got ? { path:got, kind:'queryfile', consume:true } : null;
    }

    const meta = Object.assign({ hint:opts.hint || '' }, opts.meta || {});
    if (opts.mime) meta.mime = opts.mime;
    if (opts.type) meta.type = opts.type;
    const kind = opts.kind || (/^\.app\./.test(path) ? 'func' : 'file');
    if (kind !== 'file') meta.kind = kind;
    /* .savefile 下的「新建」= 登记一个「保存时才会落盘」的节点 */
    if (par === '.savefile') meta.saveOnClose = true;
    await this.write(path, '', meta);
    return this.stat(path);
  },

  async spta(p, data) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) throw new Error('spta: 不存在: ' + p);
    if (st.kind === 'dir') throw new Error('spta: 不能追加到目录: ' + p);
    this.assert(p, 'w');
    const r = await this.read(p);
    const old = r.content;
    if (old instanceof ArrayBuffer) {
      const base = new Uint8Array(old);
      const add = data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(String(data == null ? '' : data));
      const out = new Uint8Array(base.length + add.length);
      out.set(base); out.set(add, base.length);
      return this.write(p, out.buffer, st.meta);
    }
    return this.write(p, String(old == null ? '' : old) + String(data == null ? '' : data), st.meta);
  },

  /* opts.peek = true：只看一眼，不消费（文件管理器的预览栏用这个） */
  async sptr(p, opts) {
    p = normPath(p);
    opts = opts || {};
    const st = await this.stat(p);
    if (!st) throw new Error('sptr: 不存在: ' + p);
    this.assert(p, 'r');
    if (st.kind === 'dir') {
      const rows = await this.list(p);
      return { path:p, kind:'dir', type:'dir', index:rows.map(r => ({ name:r.name, path:r.path, kind:r.kind, size:r.size })) };
    }
    if (st.kind === 'device') return { path:p, kind:'device', type:'device', device:(st.meta || {}).device };
    if (st.kind === 'grant') return { path:p, kind:'grant', type:'perm', perm:(st.meta || {}).perm };
    const r = await this.read(p);
    let content = r.content;
    const type = this.typeOf(st, content);
    if (st.kind === 'object') {
      let v = content;
      try { v = JSON.parse(String(content || 'null')); } catch (e) {}
      return { path:p, kind:'object', type:'object', value:v, meta:r.meta };
    }
    /* 一次性文件：读完就把节点抹掉（永久删除，不进回收站） */
    if (parentPath(p) === '.queryfile' && !opts.peek) {
      await this.remove(p, true);
      return { path:p, kind:st.kind, type, content, meta:r.meta, consumed:true };
    }
    return { path:p, kind:st.kind, type, content, meta:r.meta };
  },

  async sptx(p, args) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) throw new Error('sptx: 不存在: ' + p);
    this.assert(p, 'x');
    if (st.kind === 'dir') return { act:'enter', path:p };
    if (st.kind === 'func') {
      const r = await this.read(p);
      return { act:'js', path:p, source:(r.meta && r.meta.source) || String(r.content || '') };
    }
    if (st.kind === 'app') return { act:'app', path:p, app:(st.meta || {}).app || st.name, args:args || [] };
    if (st.kind === 'device') return { act:'device', path:p, device:(st.meta || {}).device };
    if (st.kind === 'grant') return { act:'perm', path:p, perm:(st.meta || {}).perm };
    if (st.kind === 'package') return { act:'package', path:p, spec:(st.meta || {}).spec };
    const r = await this.read(p);
    const type = this.typeOf(st, r.content);
    /* 判类型只看元数据 / 魔数，不看后缀：.app 里放的是页面就开浏览器，
     * 放的是 JS 就跑，放的是 wasm 就交给 wasm 宿主。
     * 注意顺序：**先按 type 分流，再看 kind**。以前 `kind==='object'` 排在前面，
     * 于是一个 `{kind:'object', mime:'text/javascript'}` 的节点被判成「对象」，
     * 执行按钮点了毫无反应——typeOf 明明算出 `code`，却被 kind 抢了先。 */
    if (type === 'page') return { act:'html', path:p, html:String(r.content || '') };
    if (type === 'code') return { act:'js', path:p, source:String(r.content || '') };
    if (st.kind === 'object' || type === 'object') {
      let v = r.content;
      try { v = JSON.parse(String(r.content || 'null')); } catch (e) {}
      return { act:'object', path:p, value:v };
    }
    return { act:'file', path:p, content:r.content, meta:r.meta, type };
  },

  async sptd(p) {
    p = normPath(p);
    if (p === '.' || DIRS.includes(p)) throw new Error('sptd: 不能删除系统目录: ' + p);
    const st = await this.stat(p);
    if (!st) throw new Error('sptd: 不存在: ' + p);
    this.assert(p, 'd');
    /* 进程：结束（只有强制结束）。这一步会真的把关着这个进程的窗口关掉。 */
    if (st.kind === 'proc') return { act:'kill', pid:Number(baseName(p)) };
    if (parentPath(p) === '.savefile') { await this.flushSavefile(p); return true; }
    await this.remove(p, true);
    return true;
  },

  /* ---------------------------------------------------------------- 元数据
   * 单独读、单独写，不掺杂在别的小调用里（自动更新除外：导入/保存/安装时会自己写）。
   * 返回的是**人类可读 + 程序可用**的一份：类型判定看这里的 type/mime。
   */
  async sptmetaread(p) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) throw new Error('sptmetaread: 不存在: ' + p);
    const m = st.meta || {};
    const caps = this.caps(p);
    /* extra = 「我们不认识、但你想记下来」的键值对。meta.extra 就是专门放它的筐，
     * 其余零散的自定义键也一起并进来，读的时候不用管当初是怎么写的。 */
    const extra = Object.assign({}, (m.extra && typeof m.extra === 'object') ? m.extra : {});
    for (const k of Object.keys(m)) {
      if (['hint','mime','type','kind','app','icon','title','device','perm','spec','url','name','saveOnClose','source','binary','origin','interpreter','lsKey','extra'].includes(k)) continue;
      extra[k] = m[k];
    }
    return {
      path:p, kind:st.kind, type:this.typeOf(st, st.content),
      mime:m.mime || '', size:st.size || 0,
      readonly:!caps.w, executable:caps.x,
      ctime:st.ctime || st.mtime || 0, mtime:st.mtime || 0,
      hint:m.hint || '', extra
    };
  },
  async sptmetawrite(p, patch) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) throw new Error('sptmetawrite: 不存在: ' + p);
    this.assert(p, 'w');
    const p0 = patch || {};
    const merged = Object.assign({}, st.meta || {}, p0);
    /* extra 是「扩展区」：传进来的是增量，不是整体替换（否则改一个键会抹掉别的） */
    if (p0.extra && typeof p0.extra === 'object') {
      merged.extra = Object.assign({}, (st.meta && st.meta.extra) || {}, p0.extra);
    }
    /* 只改元数据：内容原样搬一遍，避免「改个类型把内容弄丢」 */
    if (st.kind === 'dir') {
      await IDB.put({
        path:p, parent:parentPath(p), name:baseName(p), kind:'dir',
        content:'', meta:merged, ctime:st.ctime || Date.now(), mtime:Date.now(), size:0
      });
      await this.syncIndex();
      EventBus.emit('fs', { type:'meta', path:p });
      return merged;
    }
    const r = await this.read(p);
    await this.write(p, r.content, merged);
    return merged;
  },

  /* sptm —— 把可执行的 JS 节点**挂载成函数**：拿到手就能像普通函数那样调。
   * （把整个 spotfs 挂给 FreeBSD 的 /spotfs 是另一件事，见 spotfsTable()。） */
  async sptm(p, opts) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) throw new Error('sptm: 不存在: ' + p);
    if (!(st.kind === 'func' || this.typeOf(st) === 'code')) {
      throw new Error('sptm: 只能把 JS 节点挂成函数: ' + p);
    }
    const r = await this.read(p);
    const src = (r.meta && r.meta.source) || String(r.content || '');
    const name = baseName(p);
    const path = p;
    const fn = new Function('return async function ' + (opts && opts.as || 'mounted_' + name.replace(/[^\w$]/g, '_')) +
      '(...args){ let __p=' + JSON.stringify(path) + '; ' + src + '\n}')();
    fn.path = path;
    return fn;
  },

  /* .savefile 里的节点：导出到本机后从文件系统删除 */
  async flushSavefile(p) {
    p = normPath(p);
    const st = await this.stat(p);
    if (!st) return false;
    const r = await this.read(p);
    await saveFileRaw(spotExportName(baseName(p)), r.content, (r.meta && r.meta.mime) || 'application/octet-stream');
    await this.remove(p, true);
    return true;
  },

  /* ---------------------------------------------------------------- 导出给「别的系统」看
   * 目的：让 FreeBSD（hsb2）里有个 /spotfs 能读到同一份节点。
   * 现在只做到「快照 + 写回」这一步：v86 没有 virtio-9p，真挂载需要在 guest 里
   * 跑一个把 HTTP/串口桥接成文件系统的服务，那是一个独立工程（README 里写明）。
   * 有这张表，那层桥接将来只要把 read/write 对到这里就行，不用再改语义。
   */
  spotfsTable(prefix) {
    prefix = normPath(prefix || '.');
    const out = [];
    for (const [path, rec] of this.idx) {
      if (prefix !== '.' && path !== prefix && !path.startsWith(prefix + '.')) continue;
      out.push({ path, kind:rec.kind, size:rec.size || 0, meta:rec.meta || {}, type:this.typeOf(rec) });
    }
    return out;
  },

  async usage() {
    let est = {};
    try { est = await navigator.storage.estimate(); } catch (e) {}
    let ls = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls += (k || '').length + (localStorage.getItem(k) || '').length;
    }
    return { usage: est.usage || 0, quota: est.quota || 0, localStorage:ls, files:this.idx.size };
  },

  async exportAll() {
    const files = [];
    for (const r of await IDB.all()) {
      files.push(Object.assign({}, r, { content:await packContent(r.content) }));
    }
    const temp = [];
    for (const [path, v] of this.temp) temp.push({ path, content:await packContent(v.content), meta:v.meta });
    const ls = {};
    for (const k of lsKeys()) ls[k] = localStorage.getItem('ht.ls.' + k);
    return { format:'HTerMinaL-fs', version:1, at:nowISO(), files, temp, localstorage:ls, settings:Settings.all() };
  },

  async importAll(obj) {
    if (!obj || obj.format !== 'HTerMinaL-fs') throw new Error('不是 HTerMinaL 导出的文件');
    if (Array.isArray(obj.files)) {
      for (const r of obj.files) {
        if (!r || !r.path) continue;
        const path = normPath(r.path);
        const rec = Object.assign({}, r, {
          path, parent:parentPath(path), name:baseName(path),
          content:await unpackContent(r.content)
        });
        await IDB.put(rec);
      }
    }
    if (obj.temp) for (const t of obj.temp) this.temp.set(normPath(t.path), { content:await unpackContent(t.content), meta:t.meta || {}, mtime:Date.now() });
    if (obj.localstorage) for (const [k, v] of Object.entries(obj.localstorage)) lsSet(k, v);
    await this.syncIndex();
    this.persistIndex();
    return true;
  },

  mounts() {
    return [
      { mount:'idb://hterm', path:'.', type:'indexeddb' },
      { mount:'ls://local', path:'.localstorage', type:'localstorage' },
      { mount:'tmpfs', path:'.temp', type:'memory' },
      { mount:'procfs', path:'.proc', type:'virtual' },
      { mount:'devfs', path:'.dev', type:'virtual' },
      { mount:'pkgfs', path:'.pkg', type:'virtual' },
    ];
  }
};
/* ---------------------------------------------------------------- Spot
 * 应用（记事本、截图、看图、录音、HTML 编辑器……）只走这一层，不直接碰
 * `FS.write / FS.remove / FS.mkdir`。理由：裸操作绕过了 spotfs 的语义
 * （新建和写入是两件事、queryfile 读一次就没了、savefile 写完就消失、
 * 能力表决定「这个动作有没有意义」）。系统自己为了解决启动/迁移之类的问题
 * 才用裸操作，那是例外，不是常规。
 */
const Spot = {
  stat: (p) => FS.stat(p),
  list: (p) => FS.list(p),
  caps: (p) => FS.caps(p),
  can: (p, op) => FS.can(p, op),
  typeOf: (st, data) => FS.typeOf(st, data),
  meta: (p) => FS.sptmetaread(p),
  setMeta: (p, patch) => FS.sptmetawrite(p, patch),
  /* 普通读。queryfile 里的东西读一次就没了——这是设计，不是 bug。 */
  read: (p) => FS.sptr(p),
  /* 只想看一眼（预览、列个摘要），不消费 */
  peek: (p) => FS.sptr(p, { peek:true }),
  /* 有就覆盖、没有就新建，两步 internally，但对调用方是一步「保存」 */
  async write(p, data, meta) {
    meta = meta || {};
    const st = await FS.stat(p);
    if (!st) {
      await FS.sptn(p, { kind: meta.kind || 'file', mime: meta.mime, type: meta.type, meta });
    }
    return FS.sptc(p, data, meta);
  },
  mkdir(p) { return FS.sptn(p, { kind:'dir' }); },
  remove(p) { return FS.sptd(p); },
  /* 「保存到本机」：在 .savefile 里建一个待保存节点，写进去就落盘并消失 */
  async save(name, data, mime) {
    const nm = spotEscape(String(name || 'download'));
    let path = '.savefile.' + nm;
    let i = 2;
    while (FS.exists(path)) path = '.savefile.' + nm + '-' + i++;
    await FS.sptn(path, { kind:'file', mime, meta:{ hint:name } });
    await FS.sptc(path, data, { mime });
    return path;
  },
  /* 执行一个节点：把 sptx 的「动作描述」在主线程落地 */
  async run(p, args) {
    const st = await FS.stat(p);
    if (!st) throw new Error('不存在: ' + p);
    const act = await FS.sptx(p, args || []);
    return Spot.act(act);
  },
  async act(d) {
    if (!d) return d;
    if (d.act === 'enter') return { kind:'dir', path:d.path };
    if (d.act === 'app') return WindowManager.open({ app:d.app, path:d.path, args:d.args });
    if (d.act === 'html') return WindowManager.open({ type:'browser', html:d.html, title:baseName(d.path) });
    if (d.act === 'js') return WindowManager.open({ type:'shell', code:d.source, title:'执行 · ' + baseName(d.path) });
    if (d.act === 'perm') return requestPermission(d.perm);
    if (d.act === 'file') return d;
    if (d.act === 'object') return d.value;
    if (d.act === 'kill') return { kind:'kill', pid:d.pid };
    if (d.act === 'package') return d;
    if (d.act === 'device') return d;
    return d;
  },
  /* 双击的默认动作：能执行就执行，不能就按类型打开（编辑器 / 看图 / 浏览器），
   * 再不行才看属性。返回做了什么，方便界面提示。 */
  async openSmart(p) {
    const st = await FS.stat(p);
    if (!st) throw new Error('不存在: ' + p);
    if (st.kind === 'dir') return { how:'enter', path:p };
    const type = FS.typeOf(st);
    const c = FS.caps(p);
    /* 能力表说能执行就执行（脚本 / 页面 / 应用 / 授权项）；
     * 不能执行才按类型落到编辑器、看图、音频，最后才是属性。 */
    if (c.x) {
      const act = await FS.sptx(p);
      await Spot.act(act);
      return { how:'exec', type };
    }
    if (type === 'image') { WindowManager.open({ type:'image', path:p, title:spotExportName(baseName(p)) }); return { how:'view', type }; }
    if (type === 'audio' || type === 'video') { WindowManager.open({ type:'audio', path:p, title:spotExportName(baseName(p)) }); return { how:'view', type }; }
    if (type === 'text' || type === 'code' || type === 'page') {
      WindowManager.open({ type:'editor', path:p, title:spotExportName(baseName(p)) });
      return { how:'edit', type };
    }
    return { how:'meta', type };
  }
};

async function packContent(c) {
  if (c == null) return { t:'s', v:'' };
  if (typeof c === 'string') return { t:'s', v:c };
  if (c instanceof ArrayBuffer) return { t:'b64', v:toB64(c) };
  if (c instanceof Blob) return { t:'b64', v:toB64(await c.arrayBuffer()), mime:c.type };
  return { t:'s', v:String(c) };
}
async function unpackContent(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (c.t === 'b64') return fromB64(c.v);
  return c.v || '';
}
function toB64(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s || '');
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}
function metaOf(r) {
  return { path:r.path, name:r.name || baseName(r.path), kind:r.kind || 'file', size:r.size || 0, mtime:r.mtime || Date.now(), ctime:r.ctime || Date.now(), meta:r.meta || {} };
}
function contentSize(c) {
  if (c == null) return 0;
  if (typeof c === 'string') return c.length;
  if (c instanceof Blob) return c.size;
  if (c instanceof ArrayBuffer) return c.byteLength;
  try { return JSON.stringify(c).length; } catch (e) { return 0; }
}
function byName(a, b) {
  if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-CN');
}
function guessMime(p, data) {
  const n = baseName(p);
  if (/json|settings|agent/.test(n)) return 'application/json';
  if (/readme|welcome|license|about|version|txt|note/.test(n)) return 'text/plain';
  if (typeof data === 'string' && /^\s*[[{]/.test(data)) return 'application/json';
  return 'text/plain';
}

/* ---------------------------------------------------------------- 进程表（worker 线程） */
const Proc = {
  map: new Map(),
  add(p) { this.map.set(p.pid, p); return p; },
  get(pid) { return this.map.get(pid); },
  remove(pid) { this.map.delete(pid); },
  list() { return [...this.map.values()].map(p => ({ pid:p.pid, role:p.role, state:p.state, cwd:p.cwd, title:p.title })); }
};

/* ---------------------------------------------------------------- 事件总线 */
const EventBus = {
  h: {},
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return () => this.off(ev, fn); },
  off(ev, fn) { this.h[ev] = (this.h[ev] || []).filter(x => x !== fn); },
  emit(ev, data) { for (const fn of (this.h[ev] || [])) { try { fn(data); } catch (e) { console.error(e); } } }
};

/* ---------------------------------------------------------------- localStorage 镜像 */
function encodeLsName(key) {
  let out = '';
  for (const ch of String(key)) {
    if (/[\p{L}\p{N}-]/u.test(ch)) out += ch;
    else if (ch === '_') out += '__';
    else {
      for (const b of new TextEncoder().encode(ch)) out += '_x' + b.toString(16).padStart(2, '0') + '_';
    }
  }
  if (!/^[\p{L}]/u.test(out)) out = 'k' + out;
  return out.slice(0, 64) || 'k';
}
function decodeLsName(name) {
  const map = lsMap();
  if (map[name] !== undefined) return map[name];
  let s = name;
  // 为合法化添加的 k 前缀：只有原键为空或以非字母开头时才可能添加。
  // 手动写在 .localstorage. 下的名字没有映射，保留字面。
  let out = '', bytes = [];
  const flush = () => {
    if (bytes.length) {
      try { out += new TextDecoder().decode(new Uint8Array(bytes)); } catch (e) {}
      bytes = [];
    }
  };
  for (let i = 0; i < s.length;) {
    if (s.startsWith('_x', i)) {
      const m = s.slice(i).match(/^_x([0-9a-f]{2})_/i);
      if (m) { bytes.push(parseInt(m[1], 16)); i += m[0].length; continue; }
    }
    if (s.startsWith('__', i)) { flush(); out += '_'; i += 2; continue; }
    flush();
    out += s[i++];
  }
  flush();
  return out;
}
function rebuildLsMap() {
  const m = lsMap();
  let changed = false;
  for (const k of lsKeys()) {
    const e = encodeLsName(k);
    if (m[e] !== k) { m[e] = k; changed = true; }
  }
  if (changed) { try { localStorage.setItem('ht.lsmap', JSON.stringify(m)); } catch (e) {} }
}
function lsMap() {
  try {
    return JSON.parse(localStorage.getItem('ht.lsmap') || localStorage.getItem('ht.ls.map') || '{}');
  } catch (e) { return {}; }
}
function lsSet(key, value) {
  localStorage.setItem('ht.ls.' + key, value);
  const m = lsMap(); m[encodeLsName(key)] = key;
  try { localStorage.setItem('ht.lsmap', JSON.stringify(m)); } catch (e) {}
}
function lsKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('ht.ls.') && k !== 'ht.ls.map') out.push(k.slice(6));
  }
  return out;
}

/* ---------------------------------------------------------------- 包索引 */
const Pkg = {
  KEY: 'ht.packages',
  list() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (e) { return []; }
  },
  save(list) { localStorage.setItem(this.KEY, JSON.stringify(list)); EventBus.emit('pkg', list); },
  add(rec) {
    const l = this.list().filter(x => x.spec !== rec.spec);
    l.push(rec); this.save(l); return rec;
  },
  remove(spec) { this.save(this.list().filter(x => x.spec !== spec)); },
  getSpecByPath(p) {
    const name = baseName(p);
    return this.list().find(x => pkgPathName(x.spec) === name);
  }
};
function pkgPathName(spec) {
  return sanitizeName(String(spec).replace(/^@[^/]+\//, '').replace(/@.*$/, '').replace(/[\/.]/g, '-'), 'pkg');
}

/* ---------------------------------------------------------------- 下载 / 询问文件 */
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name || 'download';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
async function saveFile(name, content, mime) {
  let blob;
  if (content instanceof Blob) blob = content;
  else if (content instanceof ArrayBuffer) blob = new Blob([content], { type:mime || 'application/octet-stream' });
  else blob = new Blob([String(content == null ? '' : content)], { type:mime || 'text/plain;charset=utf-8' });
  downloadBlob(sanitizeName(name || 'download', 'download'), blob);
  toast('已保存 ' + (name || 'download'));
  return true;
}
/* 导出时**不**再过 sanitizeName：名字已经由 spotExportName 处理过，
 * 再走一遍会把 -XX 哨兵前的短横线剥掉（sanitizeName 会 trim 首尾的 -）。 */
async function saveFileRaw(name, content, mime) {
  let blob;
  if (content instanceof Blob) blob = content;
  else if (content instanceof ArrayBuffer) blob = new Blob([content], { type:mime || 'application/octet-stream' });
  else blob = new Blob([String(content == null ? '' : content)], { type:mime || 'text/plain;charset=utf-8' });
  downloadBlob(name || 'download', blob);
  toast('已保存 ' + (name || 'download'));
  return true;
}

/* 把外部 File 列表导入 spotfs：名字走 spotEscape，内容按文本/二进制分流。
 * 被 drop / 上传 / 导入共同复用，保证「同一个文件不管从哪进来，落点规则一致」。 */
async function importFiles(files, dir) {
  dir = normPath(dir || '.home');
  const join = (d, n) => (d === '.' ? '' : d + '.') + n;
  const out = [];
  for (const f of files) {
    const raw = f.name || 'file';
    let stored = spotEscape(raw);
    let p = join(dir, stored), n = 2;
    while (FS.exists(p)) { stored = spotEscape(raw + '-' + n); p = join(dir, stored); n++; }
    const isText = /^text\//.test(f.type || '') ||
      /\.(txt|md|json|js|mjs|cjs|ts|csv|log|yml|yaml|xml|html|htm|css|py|sh|ini|toml)$/i.test(raw) ||
      (f.size < 262144 && !f.type);
    const content = isText ? await f.text() : await f.arrayBuffer();
    await FS.write(p, content, {
      mime: f.type || (isText ? 'text/plain' : 'application/octet-stream'),
      hint: raw, binary: !isText, origin: 'drop', spotName: stored
    });
    out.push(p);
  }
  if (out.length) EventBus.emit('fs', { type:'import', dir, count:out.length });
  return out;
}
/* ---------------------------------------------------------------- 窗口间拖拽
 * 所有窗口都在同一个文档里，所以最可靠的信道就是一个共享变量：
 *   ① 它在 dragenter / dragover 阶段就能读（dataTransfer 的内容要等 drop 才允许读），
 *      这样「拖到哪个窗口上，哪个窗口先亮起来」才做得到；
 *   ② 不受 iframe 的 sandbox / 跨域影响。
 * dataTransfer 里仍然写一份，理由有两条：外部应用只认 DownloadURL / text/plain；
 * 变量丢了（拖拽中途刷新、跨文档）时还有退路。
 *
 * item 有两种：
 *   { kind:'spot', path, name, mime }   spotfs 里的一个节点（name 是存储名）
 *   { kind:'page', name, url, html }    浏览器里的一个页面（html 为 null 表示跨域读不到）
 */
const DRAG_MIME = 'application/x-ht-spot';
const DragBus = {
  items: null,
  /* 内部拖拽的起始时刻：给「这次 DragEvent 到底是不是页面内拖动」留一个时间窗，
   * 万一某个浏览器把自定义 MIME 从 types 里吞了，也还能靠它判断。 */
  startedAt: 0,
  get() { return this.items; },
  set(items) {
    this.items = (items && items.length) ? items.slice() : null;
    this.startedAt = this.items ? Date.now() : 0;
    return this.items;
  },
  /* 页面内拖拽是否仍在进行（10 秒内开始过） */
  fresh() { return !!this.items && Date.now() - this.startedAt < 10000; },
  clear() {
    this.items = null;
    this.startedAt = 0;
    try { document.body.classList.remove('drag-internal'); } catch (e) {}
  },
  /* dragstart 里同步调用：Chrome 只认同步阶段 setData */
  write(dt, items, fallbackText, effect) {
    this.set(items);
    /* 拖拽期间给 body 挂个类：浏览器窗口的 iframe 遮板靠它显示
     * （否则 drop 事件会被 iframe 的文档吃掉，父文档收不到）。 */
    try { document.body.classList.add('drag-internal'); } catch (e) {}
    if (!dt) return;
    try { dt.effectAllowed = effect || 'copyMove'; } catch (e) {}
    try { dt.setData(DRAG_MIME, JSON.stringify(this.items)); } catch (e) {}
    if (fallbackText) { try { dt.setData('text/plain', String(fallbackText)); } catch (e) {} }
  },
  read(dt) {
    if (this.items && this.items.length) return this.items;
    try {
      const raw = dt && dt.getData(DRAG_MIME);
      if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; }
    } catch (e) {}
    return null;
  }
};
/* 拖拽进行中的判断：只看 types，**不读内容**（dragover 阶段读不到） */
function hasInternalDrag(e) {
  const dt = e && e.dataTransfer;
  if (!dt || !dt.types) return false;
  try { return Array.from(dt.types).includes(DRAG_MIME); } catch (err) { return false; }
}

/* 在 dir 下取一个不撞名的路径：name → name-2 → name-3…
 * 文件和目录都适用（目录撞名时 mkdir 会直接失败，所以必须先算） */
function uniquePathIn(dir, name) {
  dir = normPath(dir || '.home');
  const join = (d, n) => (d === '.' ? '' : d + '.') + n;
  let p = join(dir, name), i = 2;
  while (FS.exists(p)) { p = join(dir, name + '-' + i); i++; }
  return p;
}
/* target 是不是 source 本身或在 source 里面（禁止把目录拖进自己） */
function isSameOrInside(target, source) {
  return target === source || String(target).startsWith(source + '.');
}

/* 给页面标题补扩展名：标题本身就叫 x.html 时不要变成 x.html.html */
function htmlFileName(name) {
  const n = String(name == null ? '' : name).trim() || 'page';
  return /\.html?$/i.test(n) ? n : n + '.html';
}

/* 把一批拖拽项落到 dir。默认复制，opts.move 为真则移动。
 * 返回 { copied, moved, skipped }，让调用方决定怎么提示。 */
async function dropIntoDir(items, dir, opts) {
  opts = opts || {};
  dir = normPath(dir || '.home');
  const r = { copied: [], moved: [], skipped: [] };
  for (const it of items || []) {
    try {
      if (it && it.kind === 'page') {
        const title = String(it.name || 'page');
        const html = (it.html != null && it.html !== '')
          ? String(it.html)
          : '<!DOCTYPE html>\n<meta charset="utf-8"><title>' + esc(title) + '</title>\n'
            + '<p>这个页面跨域，读不到 DOM，只保存了地址：</p>\n<p><a href="' + esc(it.url || '') + '" target="_blank">'
            + esc(it.url || '') + '</a></p>\n';
        const p = uniquePathIn(dir, spotEscape(htmlFileName(title)));
        await FS.write(p, html, { mime:'text/html;charset=utf-8', hint:title, origin:'browser' });
        r.copied.push(p);
        continue;
      }
      const src = normPath((it && it.path) || '');
      if (!src || !FS.exists(src)) { r.skipped.push((it && it.name) || src); continue; }
      if (isSameOrInside(dir, src)) { r.skipped.push(baseName(src)); continue; }
      if (opts.move && parentPath(src) === dir) { r.skipped.push(baseName(src)); continue; }
      const p = uniquePathIn(dir, baseName(src));
      if (opts.move) { await FS.move(src, p); r.moved.push(p); }
      else { await FS.copy(src, p); r.copied.push(p); }
    } catch (e) { r.skipped.push((it && (it.name || it.path)) || '?'); }
  }
  if (r.copied.length || r.moved.length) EventBus.emit('fs', { type:'drop', dir, count:r.copied.length + r.moved.length });
  return r;
}

/* 任意内容 → dataURL（附件里放图片用）。File / Blob / ArrayBuffer / 类型化数组 / 字符串都吃。 */
async function contentToDataUrl(content, mime) {
  /* Uint8Array 也要认：FS.write 存二进制时就是它，只判断 Blob/ArrayBuffer
   * 会把 PNG 的字节拼成 "137,80,78,…" 当文本读，浏览器自然解码失败。 */
  const typed = ArrayBuffer.isView(content)
    ? content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)
    : content;
  const blob = typed instanceof Blob ? typed
    : typed instanceof ArrayBuffer ? new Blob([typed], { type:mime || 'application/octet-stream' })
    : new Blob([String(typed == null ? '' : typed)], { type:mime || 'text/plain' });
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error('读取失败'));
    fr.readAsDataURL(blob);
  });
}

function pickFiles(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = !!opts.multiple;
    if (opts.accept) inp.accept = opts.accept;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    inp.oncancel = () => { resolve([]); inp.remove(); };
    inp.click();
  });
}
async function askFile(opts) {
  opts = opts || {};
  const files = await pickFiles({ multiple:!!opts.multiple, accept:opts.accept });
  if (!files.length) return opts.multiple ? [] : null;
  const out = [];
  for (const f of files) {
    /* 名字里不能有点（点就是路径分隔符），但直接把扩展名剁掉会让 a.txt / a.md 撞成同一个
     * `a`。折中：`hello.txt` → `hello-txt`，既守命名规则，又能一眼看出是什么。 */
    let name = sanitizeName(f.name, 'query');
    const ext = String(f.name || '').match(/\.([\p{L}\p{N}_-]{1,8})$/u);
    if (ext && !name.endsWith('-' + ext[1])) name += '-' + ext[1];
    let path = '.queryfile.' + name;
    let n = 2;
    while (FS.exists(path)) { path = '.queryfile.' + name + '-' + n; n++; }
    const isText = /^text\//.test(f.type) || /\.(txt|md|json|js|csv|log|yml|yaml|xml|html|css)$/i.test(f.name) || f.size < 262144;
    let content;
    if (isText) content = await f.text();
    else content = await f.arrayBuffer();
    await FS.write(path, content, { mime:f.type || 'application/octet-stream', hint:f.name, binary:!isText, origin:'queryfile' });
    out.push(path);
  }
  EventBus.emit('fs', { type:'queryfile' });
  toast('已放入 ' + out.length + ' 个文件到 .queryfile');
  return opts.multiple ? out : out[0];
}

/* ---------------------------------------------------------------- 权限 */
async function requestPermission(name) {
  name = String(name || '').toLowerCase();
  try {
    if (name === 'notification') {
      if (!('Notification' in window)) return 'unsupported';
      return await Notification.requestPermission();
    }
    if (name === 'clipboard') {
      if (navigator.clipboard && navigator.clipboard.readText) { await navigator.clipboard.readText(); return 'granted'; }
      return 'unsupported';
    }
    if (name === 'camera' || name === 'microphone') {
      const stream = await navigator.mediaDevices.getUserMedia(name === 'camera' ? { video:true } : { audio:true });
      stream.getTracks().forEach(t => t.stop());
      return 'granted';
    }
    if (name === 'geolocation') {
      return await new Promise((res) => navigator.geolocation.getCurrentPosition(() => res('granted'), () => res('denied'), { timeout:8000 }));
    }
    if (name === 'fullscreen') {
      await document.documentElement.requestFullscreen();
      return 'granted';
    }
    if (name === 'persistent') {
      const ok = await navigator.storage.persist();
      return ok ? 'granted' : 'denied';
    }
    return 'unsupported';
  } catch (e) { return 'denied'; }
}

/* ---------------------------------------------------------------- CDN 装载器 */
const CDN = {
  async css(urls) {
    for (const u of urls) {
      await new Promise(res => {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = u;
        l.onload = () => res(true); l.onerror = () => { l.remove(); res(false); };
        document.head.appendChild(l);
      });
      if ([...document.querySelectorAll('link[rel=stylesheet]')].some(x => x.href === u)) return true;
    }
    return false;
  },
  async js(urls) {
    for (const u of urls) {
      const ok = await new Promise(res => {
        const s = document.createElement('script');
        s.src = u;
        s.onload = () => res(true);
        s.onerror = () => { s.remove(); res(false); };
        document.head.appendChild(s);
      });
      if (ok) return true;
    }
    return false;
  }
};

/* ---------------------------------------------------------------- 快捷键帮助 */
function isTypingTarget(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}

/* ---------------------------------------------------------------- 关于 */
function aboutHtml() {
  return `<div style="line-height:1.8">
    <p><b style="color:var(--accent);font-family:var(--mono)">HTerMinaL ${HT_VERSION}</b><br>
    浏览器里的 JS 终端、一切皆文件桌面、轻量智能体宿主。</p>
    <p>一个自包含的 <span class="code">index.html</span>，加上三个可选的单文件模型转发后端
    （<span class="code">modelserver.py / .js / .go</span>）。没有构建步骤，没有账号，没有云端。</p>
    <p style="color:var(--fg-mute)">许可：Apache-2.0 OR MIT（双许可，任选其一）。<br>
    本项目由 AI 智能体生成并维护。<br>
    第三方：xterm.js (MIT)、@xterm/addon-fit (MIT)、Pyodide (MPL-2.0)，均经 CDN 引用。</p>
    <p style="color:var(--fg-mute);font-size:11px">数据全部留在本机浏览器。清除数据会删除 IndexedDB、localStorage 与缓存。</p>
  </div>`;
}
