/* ============================================================================
 * HTerMinaL · worker runtime
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。此文件被内联进 index.html，作为 Blob Worker 运行。
 * 职责：JS shell 执行、行编辑、历史、补全、包加载、Python(Pyodide) REPL。
 * 一切文件/窗口/权限操作都通过 RPC 交给主线程的“环境”。
 * ==========================================================================*/
'use strict';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** 版本号由主线程的 init 消息注入（前端唯一来源是 30-core.js 的 HT_VERSION）。
 *  注意：这里必须是模块级变量——每个 shell 的 `state` 是闭包里的，模块级代码读不到。 */
let HT_VERSION = '0.0.1.0';

/* ANSI 只属于终端（21-shared 的 inspect 会用它上色；主线程没有它）。 */
const ANSI = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', italic:'\x1b[3m', underline:'\x1b[4m',
  red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', blue:'\x1b[34m',
  magenta:'\x1b[35m', cyan:'\x1b[36m', white:'\x1b[37m', gray:'\x1b[90m',
  bgRed:'\x1b[41m', bgYellow:'\x1b[43m'
};

/* ---------------------------------------------------------------- 基础工具 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function post(msg, transfer) { self.postMessage(msg, transfer || []); }
function out(s) { if (s !== null && s !== undefined && s !== '') post({ t:'out', data:String(s) }); }
function writeErr(s) { out(ANSI.red + s + ANSI.reset); }

/* 渲染层（xterm）的宽度表，随 init 消息到达：{ w2:[[a,b]…], w0:[[a,b]…] }。
 * 有表就一律按表算——折行与光标列必须和屏幕上的渲染完全一致，
 * 差一列，打字时光标就会一路往右跑。表由主线程用 unicodeService.wcwidth 导出。 */
let WC2 = null, WC0 = null;
function inRanges(r, cp) {
  if (!r) return false;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, a = r[mid][0], b = r[mid][1];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** 单个码点的终端显示宽度：CJK / 全角算 2，组合字符算 0。 */
function charWidth(cp) {
  if (WC2) return inRanges(WC0, cp) ? 0 : (inRanges(WC2, cp) ? 2 : 1);
  /* 没有表（老页面 / addon 没加载）时的兜底。零宽字符必须先判：
   * xterm 把 ZWJ 序列拆成「每个 emoji 各占 2 格」，ZWJ / VS16 自己不占格；
   * 这里若给它们 1 列，光标就一路往右偏——实测 `👨‍👩‍👧‍👦` 偏 3 列、
   * `🧑‍🦲` 偏 1 列、`1️⃣` 偏 1 列。 */
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x200e || cp === 0x200f ||
      (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0xfe00 && cp <= 0xfe0f) ||
      cp === 0xfeff || cp === 0x20e3 || (cp >= 0x2060 && cp <= 0x2064)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

/** 终端显示宽度：CJK / 全角算 2，组合字符算 0。够用即可。 */
function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

/** 剥掉 ANSI 转义，只留可见字符（算提示符宽度用）。 */
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '');
}

/**
 * 把「提示符 + 输入」按显示宽度折成若干行，并算出光标所在的行/列。
 *
 * 为什么必须自己折：终端的自动折行是隐式的，一旦内容超过一列宽，
 * `\r` 只回到**最后一行**行首、`\x1b[nD` 也跨不过行边界。中文每字 2 列，
 * 80 列终端打 39 个字就折行，之后所有相对移动全部错位——这就是
 * 「打多了 / 打中文 / 光标乱移就全乱」的根因。
 *
 * 显式折行之后，行号、列号都是我们自己算的，跨多少行都不会错。
 * 宽度不够放一个宽字符时整字移到下一行（行尾留 1 列空），与 xterm 一致。
 */
function layoutInput(prompt, buf, cur, cols) {
  const lines = [];
  let line = '', w = 0;
  const flush = () => { lines.push(line); line = ''; w = 0; };
  const put = (ch, cw) => {
    if (w + cw > cols && line) flush();
    line += ch; w += cw;
  };
  let i = 0, curRow = 0, curCol = 0, found = false;
  /* 提示符里有 ANSI 颜色，`\x1b[36m` 这 5 个 byte 不占屏幕，绝不能算宽度。
   * 以前直接逐字符遍历原文，光标列数凭空多出 9 列，于是「打完字光标跑到右边」。 */
  const plain = stripAnsi(prompt);
  for (const ch of plain) put(ch, charWidth(ch.codePointAt(0)));
  /* 第一行里属于提示符的可见字符数：渲染时把这一段换成带颜色的原文 */
  const prefixChars = lines.length ? lines[0].length : line.length;
  while (i < buf.length) {
    if (i === cur && !found) { curRow = lines.length; curCol = w; found = true; }
    const cp = buf.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    put(ch, charWidth(cp));
    i += ch.length;
  }
  if (!found) { curRow = lines.length; curCol = w; found = true; }
  flush();
  if (prefixChars) lines[0] = prompt + lines[0].slice(prefixChars);
  return { lines, curRow, curCol };
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function fmtArgs(args) {
  return args.map(a => typeof a === 'string' ? a : inspect(a, 1)).join(' ');
}

/* ---------------------------------------------------------------- RPC 客户端 */
let rpcSeq = 0;
const rpcPending = new Map();
function call(op, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    rpcPending.set(id, { resolve, reject });
    post({ t:'rpc', id, op, args });
  });
}
async function callSafe(op, ...args) {
  try { return await call(op, ...args); }
  catch (e) { throw e instanceof Error ? e : new Error(String(e && e.message || e)); }
}

/* ---------------------------------------------------------------- 行编辑器 */
class LineEditor {
  constructor(opts) {
    this.o = opts;
    this.buf = '';
    this.cur = 0;
    this.history = opts.history ? opts.history.slice() : [];
    this.histIdx = this.history.length;
    this.draft = '';
    this.busy = false;
    this.closed = false;
    this.queue = Promise.resolve();
    this.promptStr = '';
    this.paste = null;
    this.interrupted = false;
    /* 上次绘制占用了几行、光标停在块内第几行——重绘时靠这两个数回到起点。
     * 不记的话，只能假设「输入永远一行」，中文一折行就画歪。 */
    this._rows = 0;
    this._curRow = 0;
    this._pending = '';
  }
  /* 终端列数由宿主的 resize 消息同步过来；没有就按 80。 */
  get cols() {
    let c = 80;
    try { c = (this.o.cols && this.o.cols()) || 80; } catch (e) {}
    return Math.max(8, c | 0);
  }
  get rows() {
    let r = 24;
    try { r = (this.o.rows && this.o.rows()) || 24; } catch (e) {}
    return Math.max(4, r | 0);
  }
  promptText() { return typeof this.o.prompt === 'function' ? this.o.prompt() : (this.o.prompt || '> '); }
  start() {
    this.promptStr = this.promptText();
    this.buf = ''; this.cur = 0;
    this._rows = 0;
    this._curRow = 0;
    this.redraw();
  }
  /** 提交完成后重开一行提示符。统一走 redraw，才不会出现两个提示符叠在一起。 */
  reopen() {
    if (this.closed || this.raw) return;
    /* 先擦掉上一次画的块。正常提交后 _rows 已经是 0（光标停在新行行首），
     * erase 什么都不做；但有些路径**不换行就直接切提示符**——hsb1 进/出层、
     * agent 退出——那里 _rows 还是 1，不擦就会在原提示符后面再画一个，
     * 屏幕上出现「.home $ .home $ 」。 */
    this.erase();
    this.promptStr = this.promptText();
    this.buf = ''; this.cur = 0;
    this._rows = 0; this._curRow = 0;
    this.redraw();
    const pend = this._pending;
    this._pending = '';
    if (pend) this.insertText(pend);
  }
  /* 等待期间攒下来的输入：只留可打印字符。
   * 方向键、Esc 序列在「没有输入行」的时候没有意义，丢掉比乱用安全。 */
  _stash(data) {
    let s = '';
    for (let i = 0; i < data.length; i++) {
      const c = data.codePointAt(i);
      if (c === 0x1b) {
        const m = data.slice(i).match(/^\x1b\[[0-9;?]*[ -\/]*[@-~]/);
        i += (m ? m[0].length : 1) - 1;
        continue;
      }
      if (c === 0x7f || c === 0x08) { s = s.slice(0, -1); continue; }
      if (c >= 0x20) s += String.fromCodePoint(c);
    }
    if (s) this._pending += s;
  }
  setBusy(b) { this.busy = b; }

  /** 只擦掉上次画的那一块，不重画。粘贴、Ctrl+C、发生外部输出之前调用。 */
  erase() {
    if (this._rows <= 0) { this._rows = 0; this._curRow = 0; return; }
    if (this._curRow > 0) out('\x1b[' + this._curRow + 'A');
    out('\r');
    for (let k = 0; k < this._rows; k++) {
      out('\x1b[2K');
      if (k < this._rows - 1) out('\x1b[1B\r');
    }
    if (this._rows > 1) out('\x1b[' + (this._rows - 1) + 'A');
    out('\r');
    this._rows = 0; this._curRow = 0;
  }

  /**
   * 全量重绘。**所有会改变 buf 或 cur 的操作都走这里**，不再用 `\x1b[nD`
   * 这种相对位移——它在折行后完全不成立。
   *
   * 步骤：上移回块首 → 逐行擦掉旧内容 → 显式按行写新内容 → 定位光标。
   */
  redraw() {
    if (this.closed || this.raw) return;
    const p = this.promptStr || this.promptText();
    const cols = this.cols;
    let L = layoutInput(p, this.buf, this.cur, cols);

    /* 输入长到超过一屏时只画尾部：终端没法把已经滚上去的行再擦掉，
     * 硬画只会把历史输出盖烂。这一屏以外的内容仍然在 buf 里，按键照常生效。 */
    const maxRows = Math.max(1, this.rows - 1);
    let skip = 0;
    if (L.lines.length > maxRows) {
      skip = L.lines.length - maxRows;
      L = { lines: L.lines.slice(skip), curRow: L.curRow - skip, curCol: L.curCol };
      if (L.curRow < 0) { L.curRow = 0; L.curCol = 0; }
    }

    this.erase();

    /* 整块一次 out：一条 postMessage 画完，避免中间帧闪烁；
     * 每按键发十来条消息的话，长文本输入会明显卡顿。
     * 开头的 \r 是保底：erase() 在 _rows=0 时什么都不做（resize 之后坐标系
     * 已经失效，旧 _rows 不能信），这时光标可能停在行中间，不回车就会
     * 把新提示符**追加**在旧内容后面——实测缩放窗口后变成
     * 「JSHeL> abcJSHeL> abc」。 */
    let buf = '\r' + L.lines.join('\r\n');
    const back = L.lines.length - 1 - L.curRow;
    if (back > 0) buf += '\x1b[' + back + 'A';
    buf += '\r';
    if (L.curCol > 0) buf += '\x1b[' + L.curCol + 'C';
    out(buf);

    this._rows = L.lines.length;
    this._curRow = L.curRow;
  }
  insert(text) {
    text = text.replace(/\r\n?/g, '\n');
    if (text.includes('\n')) {
      const merged = (this.buf + text).replace(/\n+$/, '');
      this.buf = ''; this.cur = 0;
      /* 先把自己画的那一块擦掉，否则「[粘贴 N 行]」会插在输入中间，
       * 上面几行输入就永远留在屏幕上了。 */
      this.erase();
      out(ANSI.gray + '[粘贴 ' + merged.split('\n').length + ' 行]' + ANSI.reset);
      this.enqueueText(merged);
      return;
    }
    this.insertText(text);
  }
  insertText(text) {
    if (!text) return;
    this.buf = this.buf.slice(0, this.cur) + text + this.buf.slice(this.cur);
    this.cur += text.length;
    /* 不再有「在行尾就直接 out(text)」的快速路径：那条路依赖终端的自动折行，
     * 一旦折行，`_rows` 就与实际屏幕不符，下一次按键必然画歪。 */
    this.redraw();
  }
  backspace() {
    if (this.cur <= 0) return;
    let n = 1;
    const prev = this.buf.charCodeAt(this.cur - 1);
    if (prev >= 0xdc00 && prev <= 0xdfff && this.cur >= 2) n = 2;
    this.buf = this.buf.slice(0, this.cur - n) + this.buf.slice(this.cur);
    this.cur -= n;
    this.redraw();
  }
  delete() {
    if (this.cur >= this.buf.length) return;
    let n = 1;
    const c = this.buf.charCodeAt(this.cur);
    if (c >= 0xd800 && c <= 0xdbff) n = 2;
    this.buf = this.buf.slice(0, this.cur) + this.buf.slice(this.cur + n);
    this.redraw();
  }
  /* 左右移动按**码点**走一步，不是按 UTF-16 码元：emoji 是代理对，
   * 按码元移一半会卡在字符中间，后续 slice 就把它劈开了。 */
  move(d) {
    let next = this.cur;
    if (d > 0) {
      if (next >= this.buf.length) return;
      const cp = this.buf.codePointAt(next);
      next += cp > 0xffff ? 2 : 1;
    } else {
      if (next <= 0) return;
      next -= 1;
      const prev = this.buf.charCodeAt(next);
      if (prev >= 0xdc00 && prev <= 0xdfff && next > 0) next -= 1;
    }
    if (next === this.cur) return;
    this.cur = next;
    this.redraw();
  }
  home() { if (this.cur) { this.cur = 0; this.redraw(); } }
  end() { if (this.cur < this.buf.length) { this.cur = this.buf.length; this.redraw(); } }
  clearLine() { this.buf = ''; this.cur = 0; this.redraw(); }
  /* 外部输出（智能体流式回答、命令结果）要插进来之前，把输入块挪开 */
  beforeExternalOutput() { this.erase(); }
  killToEnd() { this.buf = this.buf.slice(0, this.cur); this.redraw(); }
  delWord() {
    let i = this.cur;
    while (i > 0 && /\s/.test(this.buf[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.buf[i - 1])) i--;
    this.buf = this.buf.slice(0, i) + this.buf.slice(this.cur);
    this.cur = i; this.redraw();
  }
  setLine(s) { this.buf = s; this.cur = s.length; this.redraw(); }
  historyPrev() {
    if (!this.history.length) return;
    if (this.histIdx === this.history.length) this.draft = this.buf;
    if (this.histIdx > 0) this.histIdx--;
    this.setLine(this.history[this.histIdx] || '');
  }
  historyNext() {
    if (this.histIdx >= this.history.length) return;
    this.histIdx++;
    this.setLine(this.histIdx === this.history.length ? this.draft : (this.history[this.histIdx] || ''));
  }
  async submit() {
    const line = this.buf;
    this.buf = ''; this.cur = 0; this.draft = '';
    this._rows = 0; this._curRow = 0;
    out('\r\n');
    if (line.trim()) {
      if (this.history[this.history.length - 1] !== line) {
        this.history.push(line);
        if (this.history.length > 500) this.history.shift();
        if (this.o.onHistory) { try { this.o.onHistory(this.history); } catch (e) {} }
      }
    }
    /* 关键：histIdx 必须在这之后再对齐。
     * 原来在 push 之前就把 histIdx 设成旧 length，push 之后 length 又 +1，
     * 于是第一次按 ↑ 直接落到 length-2 —— 用户看到的就是「跳到上上条」。 */
    this.histIdx = this.history.length;
    this.busy = true;
    try {
      await this.o.onSubmit(line);
    } catch (e) {
      if (e === EXIT) { this.closed = true; if (this.o.onEOF) this.o.onEOF(); return; }
      writeErr((e && (e.stack || e.message)) || String(e));
      out('\r\n');
    } finally {
      this.busy = false;
      /* 全屏应用（vim/nano）接管期间**绝对不能**补提示符：
       * 它们把画面画在自己算好的坐标上，这里再 out 一个 ".home $ " 会正好盖在
       * 正文第一行上（nano 的标题栏和第二行内容就是这么糊掉的）。 */
      if (!this.closed && !this.raw) this.reopen();
    }
  }
  async submitText(text) {
    if (this.closed) return;
    this._rows = 0; this._curRow = 0;
    out('\r\n');
    this.busy = true;
    try { await this.o.onSubmit(text); }
    catch (e) {
      if (e === EXIT) { this.closed = true; if (this.o.onEOF) this.o.onEOF(); return; }
      writeErr((e && (e.stack || e.message)) || String(e));
      out('\r\n');
    } finally {
      this.busy = false;
      if (!this.closed && !this.raw) this.reopen();
    }
  }
  enqueueSubmit() {
    if (this.closed) return;
    this.queue = this.queue.then(() => this.submit()).catch(() => {});
  }
  enqueueText(text) {
    if (this.closed) return;
    this.queue = this.queue.then(() => this.submitText(text)).catch(() => {});
  }
  /* 原始模式：把按键原样交给外部（vim/nano 这类全屏 TUI 用），不走行编辑。 */
  setRaw(fn) {
    this.raw = fn || null;
    /* 全屏应用（vim/nano）期间屏幕由它接管，我们记的 _rows 已经无意义；
     * 回来时若还拿旧值上移擦除，会把人家刚画完的画面抹掉一块。 */
    if (!fn) { this._rows = 0; this._curRow = 0; this.redraw(); }
  }
  feed(data) {
    if (this.closed) return;
    if (this.raw) {
      /* 拖拽 / 粘贴送进来的是括号粘贴（\x1b[200~…\x1b[201~），
       * 全屏应用不认这对标记，直接给它会把 "[200~" 当成内容插进文件。
       * 这里剥掉标记只传正文——vim/nano 收到的是纯文本。 */
      let raw = data;
      if (raw.startsWith('\x1b[200~') && raw.endsWith('\x1b[201~')) raw = raw.slice(6, -6);
      try { this.raw(raw); } catch (e) { out('\r\n' + String(e && e.stack || e) + '\r\n'); this.setRaw(null); }
      return;
    }
    if (this.busy) {
      /* 等模型回答时打的字以前是**直接扔掉**的：用户以为输进去了，
       * 结果提示符回来后句子少了半截，或者干脆全没了。
       * 现在攒起来，提示符回来时一次性补进输入行。 */
      this._stash(data);
      if (data.includes('\x03')) {
        this.interrupted = true;
        out('^C\r\n');
        /* 交给宿主决定能不能真的中断（智能体 TUI 可以，同步 eval 不行）。
         * 返回 true = 已经处理掉了，不再打印「无法中断」这句。 */
        let handled = false;
        try { handled = !!(this.o.onInterrupt && this.o.onInterrupt()); } catch (e) {}
        if (!handled) writeErr('（同步执行无法中断；若是异步任务，请等待其检查 hterm.interrupted）\r\n');
      }
      return;
    }
    let i = 0;
    while (i < data.length) {
      // 粘贴模式
      if (this.paste !== null) {
        const end = data.indexOf('\x1b[201~', i);
        if (end === -1) { this.paste += data.slice(i); return; }
        this.paste += data.slice(i, end);
        const txt = this.paste; this.paste = null;
        i = end + 6;
        this.insert(txt);
        continue;
      }
      const rest = data.slice(i);
      if (rest.startsWith('\x1b[200~')) { this.paste = ''; i += 6; continue; }
      if (rest.startsWith('\x1b[2004h') || rest.startsWith('\x1b[2004l')) { i += 8; continue; }

      const cp = data.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      const seq3 = data.slice(i, i + 3);
      const seq4 = data.slice(i, i + 4);
      const seq6 = data.slice(i, i + 6);

      if (ch === '\x1b') {
        if (seq3 === '\x1b[A') { this.historyPrev(); i += 3; continue; }
        if (seq3 === '\x1b[B') { this.historyNext(); i += 3; continue; }
        if (seq3 === '\x1b[C') { this.move(1); i += 3; continue; }
        if (seq3 === '\x1b[D') { this.move(-1); i += 3; continue; }
        if (seq3 === '\x1b[H' || seq4 === '\x1b[1~' || seq4 === '\x1b[7~') { this.home(); i += (seq3 === '\x1b[H' ? 3 : 4); continue; }
        if (seq3 === '\x1b[F' || seq4 === '\x1b[4~' || seq4 === '\x1b[8~') { this.end(); i += (seq3 === '\x1b[F' ? 3 : 4); continue; }
        if (seq4 === '\x1b[3~') { this.delete(); i += 4; continue; }
        if (seq3 === '\x1b[Z') { i += 3; continue; }
        // 吞掉未知 CSI / SS3
        if (seq3.startsWith('\x1b[')) {
          const m = data.slice(i).match(/^\x1b\[[0-9;?]*[ -\/]*[@-~]/);
          i += m ? m[0].length : 3;
          continue;
        }
        if (data.slice(i, i + 2) === '\x1bO') { i += 3; continue; }
        i += 2; continue;
      }
      if (ch === '\r' || ch === '\n') { i += 1; this.enqueueSubmit(); continue; }
      if (ch === '\x7f' || ch === '\b') { this.backspace(); i += 1; continue; }
      if (ch === '\x03') {
        i += 1;
        /* 先把输入块擦掉再打 ^C：否则 ^C 落在输入中间，后面那半截还留在屏幕上。 */
        this.erase();
        this.buf = ''; this.cur = 0;
        out('^C\r\n');
        this.reopen();
        continue;
      }
      if (ch === '\x04') {
        i += 1;
        if (!this.buf) {
          /* Ctrl+D 在 agent 模式里是「退出这一层」，不是「关掉终端」。
           * 宿主返回 true 表示它自己处理了（并且会补提示符）。 */
          let handled = false;
          try { handled = !!(this.o.onCtrlD && this.o.onCtrlD()); } catch (e) {}
          if (!handled) { this.closed = true; out('\r\n'); if (this.o.onEOF) this.o.onEOF(); }
        } else this.delete();
        continue;
      }
      if (ch === '\x0c') {
        i += 1;
        /* 清屏后旧块已经不存在了，_rows 必须归零，否则下一次重绘会往上抹空气。 */
        this._rows = 0; this._curRow = 0;
        out('\x1b[2J\x1b[H');
        this.promptStr = this.promptText();
        this.redraw();
        continue;
      }
      if (ch === '\x15') { i += 1; this.clearLine(); continue; }
      if (ch === '\x17') { i += 1; this.delWord(); continue; }
      if (ch === '\x01') { i += 1; this.home(); continue; }
      if (ch === '\x05') { i += 1; this.end(); continue; }
      if (ch === '\x0b') { i += 1; this.killToEnd(); continue; }
      if (ch === '\t') {
        i += 1;
        if (this.o.onTab) {
          const before = this.buf.slice(0, this.cur);
          const after = this.buf.slice(this.cur);
          this.busy = true;
          let p;
          try { p = Promise.resolve(this.o.onTab(before)); }
          catch (e) { this.busy = false; this.redraw(); return; }
          p.then(res => {
            this.busy = false;
            if (!res) { this.redraw(); return; }
            if (res.candidates && res.candidates.length > 1) {
              out('\r\n');
              out(res.candidates.map(c => c.name).join('   ') + '\r\n');
              this.redraw();
            } else if (res.value !== undefined) {
              this.buf = res.value + after;
              this.cur = res.value.length;
              this.redraw();
            }
          }).catch(() => { this.busy = false; this.redraw(); });
        }
        continue;
      }
      if (cp < 0x20) { i += 1; continue; }
      // 可打印字符（可能一次粘贴整段没有换行）
      let j = i;
      while (j < data.length) {
        const c = data.codePointAt(j);
        if (c < 0x20 || c === 0x7f) break;
        j += c > 0xffff ? 2 : 1;
      }
      this.insertText(data.slice(i, j));
      i = j;
    }
  }
}

/* ---------------------------------------------------------------- 历史持久化 */
let historyCache = [];
function saveHistory(list) {
  historyCache = list.slice(-500);
  call('history.set', historyCache).catch(() => {});
}

/* ---------------------------------------------------------------- 包管理 */
const pkgState = { mods: new Map() };
function cdnUrls(spec, cdn) {
  const clean = spec.trim();
  if (/^https?:\/\//.test(clean)) return [clean];
  const bare = clean.replace(/^npm:/, '');
  if (cdn === 'jsdelivr') return ['https://cdn.jsdelivr.net/npm/' + bare + '/+esm'];
  if (cdn === 'unpkg') return ['https://unpkg.com/' + bare + '?module'];
  return ['https://esm.sh/' + bare, 'https://cdn.jsdelivr.net/npm/' + bare + '/+esm', 'https://unpkg.com/' + bare + '?module'];
}
function pkgGlobalName(spec) {
  let s = spec.trim().replace(/^npm:/, '');
  s = s.replace(/^@[^/]+\//, '');
  s = s.replace(/@.*$/, '');
  s = s.split('/').pop() || s;
  s = s.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^(\d)/, '_$1');
  return s || 'mod';
}
async function loadPackage(spec, opts) {
  opts = opts || {};
  const clean = spec.trim();
  const name = pkgGlobalName(clean);
  if (pkgState.mods.has(clean)) return pkgState.mods.get(clean);
  const cdn = opts.cdn || (await call('settings.get', 'cdn').catch(() => 'esm.sh')) || 'esm.sh';
  const urls = cdnUrls(clean, cdn);
  let lastErr;
  for (const url of urls) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      pkgState.mods.set(clean, mod);
      try { globalThis[name] = mod; } catch (e) {}
      if (mod && typeof mod === 'object') {
        for (const k of Object.keys(mod)) {
          if (/^[A-Za-z_$][\w$]*$/.test(k) && !(k in globalThis)) { try { globalThis[k] = mod[k]; } catch (e) {} }
        }
      }
      if (!opts.silent) {
        out(ANSI.gray + '  ✓ ' + clean + ' ← ' + url + ANSI.reset + '\r\n');
      }
      if (!opts.noIndex) {
        await call('pkg.add', { spec: clean, url, name, cdn, at: Date.now() }).catch(() => {});
      }
      return mod;
    } catch (e) { lastErr = e; }
  }
  throw new Error('无法加载 ' + clean + '：' + (lastErr && lastErr.message || lastErr));
}
async function autoLoadPackages() {
  try {
    const list = await call('pkg.list');
    for (const p of list || []) {
      try { await loadPackage(p.spec, { silent:true, noIndex:true, cdn:p.cdn }); }
      catch (e) { out(ANSI.yellow + '  ! 自动加载 ' + p.spec + ' 失败：' + e.message + ANSI.reset + '\r\n'); }
    }
  } catch (e) {}
}

/* ---------------------------------------------------------------- 文件系统便捷层 */
const norm = async (p) => call('fs.resolve', p == null ? null : String(p));
async function fsls(p) { return call('fs.list', p == null ? null : String(p)); }
async function fsread(p) { const r = await call('fs.read', String(p)); return r; }
async function fswrite(p, data, meta) { return call('fs.write', String(p), data, meta || null); }
async function fsrm(p, recursive) { return call('fs.remove', String(p), !!recursive); }
async function fsmkdir(p) { return call('fs.mkdir', String(p)); }
async function fsstat(p) { return call('fs.stat', String(p)); }
async function fsmv(a, b) { return call('fs.move', String(a), String(b)); }
async function fscp(a, b) { return call('fs.copy', String(a), String(b)); }

/* ---------------------------------------------------------------- 颜色与展示 */
function colorKind(kind) {
  return ({ dir:ANSI.cyan, func:ANSI.yellow, app:ANSI.magenta, device:ANSI.blue,
    package:ANSI.green, grant:ANSI.yellow, proc:ANSI.violet, link:ANSI.cyan,
    file:'', object:ANSI.green, blob:ANSI.blue })[kind] || '';
}
function kindTag(kind) {
  return ({ dir:'d', file:'-', func:'x', app:'a', device:'v', package:'p', grant:'!', proc:'&', link:'l', object:'o', blob:'b' })[kind] || '?';
}
function fmtRows(rows, long) {
  if (!rows.length) return '';
  const maxName = Math.min(28, Math.max(...rows.map(r => strWidth(r.name))));
  return rows.map(r => {
    const c = colorKind(r.kind);
    const name = r.kind === 'dir' ? r.name + '.' : r.name;
    const pad = ' '.repeat(Math.max(0, maxName - strWidth(name) + 2));
    if (long) {
      const size = r.kind === 'dir' ? '-' : fmtBytes(r.size || 0);
      return ANSI.gray + kindTag(r.kind) + ' ' + String(size).padStart(8) + '  ' + ANSI.reset +
        c + name + ANSI.reset + pad + ANSI.gray + (r.meta && r.meta.hint || r.kind) + ANSI.reset;
    }
    return c + name + ANSI.reset + pad;
  }).join(long ? '\r\n' : '  ') + '\r\n';
}

/* ---------------------------------------------------------------- Shell 运行时 */
let shellCtx = null;

const EXIT = Symbol('exit');
/* JSHeL 力求与真实 JS 执行一致：一行就是一个 JS 表达式 / 语句。
 * 裸敲 `ls` 只是求值出那个函数对象（或未定义），**不会**自动调用、不会列出目录；
 * 要执行就写 `ls()`。以前那份 AUTO_CALL 名单会把裸命令名偷偷调用一遍，
 * 相当于在 JS 控制台里伪装了一个 shell，已移除。 */

function makeShell(ctx) {
  const state = {
    cwd: ctx.cwd || '.home',
    user: ctx.user || 'human',
    started: Date.now(),
    running: true,
    history: ctx.history || [],
    last: undefined,
    lastError: null,
    mode: 'jshel',          // jshel | hsb1（hsb1 时整行交给 COMPAT，不认 JS）
    cols: ctx.cols || 80,
    rows: ctx.rows || 24
  };

  /* ---- 输出与 console ---- */
  const con = {
    log: (...a) => { out(fmtArgs(a) + '\r\n'); },
    info: (...a) => { out(ANSI.blue + fmtArgs(a) + ANSI.reset + '\r\n'); },
    warn: (...a) => { out(ANSI.yellow + fmtArgs(a) + ANSI.reset + '\r\n'); },
    error: (...a) => { out(ANSI.red + fmtArgs(a) + ANSI.reset + '\r\n'); },
    debug: (...a) => { out(ANSI.gray + fmtArgs(a) + ANSI.reset + '\r\n'); },
    dir: (o) => { out(inspect(o, 1) + '\r\n'); },
    table: (o) => { out(inspect(o, 1) + '\r\n'); },
    time: (l) => { try { console.time(l); } catch (e) {} },
    timeEnd: (l) => { try { console.timeEnd(l); } catch (e) {} },
    trace: (...a) => { out(ANSI.gray + fmtArgs(a) + '\r\n' + new Error().stack + ANSI.reset + '\r\n'); },
    assert: (c, ...a) => { if (!c) out(ANSI.red + 'Assertion failed: ' + fmtArgs(a) + ANSI.reset + '\r\n'); },
    clear: () => out('\x1b[2J\x1b[H')
  };

  /* ---- 路径与目录 ---- */
  function abs(p) {
    if (p === undefined || p === null || p === '') return state.cwd;
    p = String(p);
    if (p === '.') return state.cwd;
    if (p === '..') {
      const seg = state.cwd.split('.');
      seg.pop();
      return seg.length <= 1 ? '.' : seg.join('.');
    }
    if (p.startsWith('.')) {
      // `.home.foo` 绝对；单独 `.` 是根
      return p.replace(/\.+$/, '') || '.';
    }
    return (state.cwd === '.' ? '.' : state.cwd + '.') + p;
  }

  async function pwd() { return state.cwd; }
  async function cd(p) {
    const t = abs(p || '.home');
    const st = await fsstat(t);
    if (!st) throw new Error('cd: 没有这个目录: ' + p);
    if (st.kind !== 'dir') throw new Error('cd: 不是目录: ' + p);
    state.cwd = t;
    post({ t:'cwd', path:t });
  }
  async function ls(p, flags) {
    flags = flags || {};
    const t = abs(p);
    const rows = await fsls(t);
    if (flags.long || flags.l) out(fmtRows(rows, true));
    else out(fmtRows(rows, false));
  }
  async function ll(p) { return ls(p, { long:true }); }

  async function cat(p) {
    if (!p) throw new Error('cat: 缺少文件');
    const r = await fsread(abs(p));
    if (r.kind === 'dir') throw new Error('cat: ' + p + ' 是目录');
    if (r.kind === 'func' || r.kind === 'app') {
      out(ANSI.gray + '# ' + r.kind + ' ' + r.path + ANSI.reset + '\r\n');
      out((r.meta && r.meta.source ? r.meta.source : String(r.content)) + '\r\n');
      return;
    }
    if (typeof r.content === 'string') out(r.content.endsWith('\n') ? r.content : r.content + '\r\n');
    else out(inspect(r.content) + '\r\n');
  }

  async function writeFile(p, data, meta) {
    if (!p) throw new Error('write: 缺少路径');
    const r = await fswrite(abs(p), data, meta);
    // 命令语义：不回显返回值；需要返回值请用 fs.write
    return undefined;
  }

  async function mkdir(p) { await fsmkdir(abs(p)); }
  async function rm(p, flags) {
    const recursive = !!(flags && (flags.r || flags.recursive || flags.R));
    await fsrm(abs(p), recursive);
  }
  async function mv(a, b) { await fsmv(abs(a), abs(b)); }
  async function cp(a, b) { await fscp(abs(a), abs(b)); }
  async function stat(p) {
    const s = await fsstat(abs(p));
    if (!s) throw new Error('stat: 不存在: ' + p);
    out(ANSI.gray + 'File: ' + ANSI.reset + s.path + '\r\n');
    out(ANSI.gray + 'Type: ' + ANSI.reset + s.kind + '    Size: ' + (s.size || 0) + '    Modified: ' + new Date(s.mtime || Date.now()).toLocaleString('zh-CN') + '\r\n');
    if (s.meta && Object.keys(s.meta).length) out(ANSI.gray + 'Meta: ' + ANSI.reset + inspect(s.meta) + '\r\n');
  }
  async function exists(p) { try { return !!(await fsstat(abs(p))); } catch (e) { return false; } }

  async function tree(p, depth) {
    depth = depth == null ? 2 : depth;
    const t = abs(p);
    async function walk(path, prefix, d) {
      if (d < 0) return;
      const rows = await fsls(path);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const last = i === rows.length - 1;
        out(prefix + (last ? '└─ ' : '├─ ') + colorKind(r.kind) + r.name + (r.kind === 'dir' ? '.' : '') + ANSI.reset + '\r\n');
        if (r.kind === 'dir' && d > 0) await walk(r.path, prefix + (last ? '   ' : '│  '), d - 1);
      }
    }
    out(ANSI.cyan + t + ANSI.reset + '\r\n');
    await walk(t, '', depth);
  }

  async function du(p) {
    const t = abs(p);
    const st = await fsstat(t);
    if (!st) throw new Error('du: 不存在: ' + p);
    let total = st.size || 0, count = 1;
    if (st.kind === 'dir') {
      const walk = async (path) => {
        const rows = await fsls(path);
        for (const r of rows) {
          count++; total += r.size || 0;
          if (r.kind === 'dir') await walk(r.path);
        }
      };
      await walk(t);
    }
    out(fmtBytes(total) + '\t' + count + ' 项\t' + t + '\r\n');
  }

  async function find(p, needle) {
    const t = abs(p);
    const out = [];
    const walk = async (path) => {
      const rows = await fsls(path);
      for (const r of rows) {
        if (!needle || r.name.toLowerCase().includes(String(needle).toLowerCase())) out.push(r.path);
        if (r.kind === 'dir') await walk(r.path);
      }
    };
    await walk(t);
    out.forEach(x => out(x + '\r\n'));
  }

  async function head(p, n) {
    const r = await fsread(abs(p));
    const lines = String(r.content || '').split('\n').slice(0, n || 10);
    out(lines.join('\n') + '\r\n');
  }
  async function tail(p, n) {
    const r = await fsread(abs(p));
    const lines = String(r.content || '').split('\n');
    out(lines.slice(-(n || 10)).join('\n') + '\r\n');
  }
  async function grep(pattern, p) {
    const re = new RegExp(pattern, 'i');
    const t = abs(p);
    const walk = async (path) => {
      const rows = await fsls(path);
      for (const r of rows) {
        if (r.kind === 'dir') { await walk(r.path); continue; }
        if (r.kind !== 'file') continue;
        try {
          const rr = await fsread(r.path);
          String(rr.content || '').split('\n').forEach((line, i) => {
            if (re.test(line)) out(ANSI.magenta + r.path + ANSI.reset + ':' + (i + 1) + ': ' + line + '\r\n');
          });
        } catch (e) {}
      }
    };
    await walk(t);
  }

  async function open(p) {
    if (!p) { await call('drawer.open'); return; }
    /* 和 window.open 对齐：URL 开浏览器窗口，其余当文件路径。
     * 以前 open('https://…') 会去文件系统里找一个叫 https: 的目录，报「不存在」。 */
    const s0 = String(p);
    if (/^(https?:|data:|blob:|about:|file:)/i.test(s0) || /^\/\//.test(s0) || /^www\./i.test(s0)) {
      return await call('win.open', { type:'browser', url:/^www\./i.test(s0) ? 'https://' + s0 : s0 });
    }
    const t = abs(p);
    const st = await fsstat(t);
    if (!st) {
      const got = await call('file.ask', { path:t });
      if (got) { await open(got); return; }
      throw new Error('open: 不存在: ' + p);
    }
    if (st.kind === 'dir') { await cd(t); return; }
    if (st.kind === 'app') { await call('win.open', { app:st.meta.app || st.name, path:t }); return; }
    if (st.kind === 'func') {
      const r = await fsread(t);
      const fn = r.meta && r.meta.source ? compileFunction(r.meta.source, t) : null;
      if (fn) { await fn(); return; }
      await call('win.open', { type:'editor', path:t, title:st.name });
      return;
    }
    if (st.kind === 'device') { await deviceOpen(t, st); return; }
    if (st.kind === 'package') { await loadPackage(st.meta.spec || st.name); return; }
    if (st.kind === 'grant') { await call('perm.request', st.meta.perm || st.name); return; }
    // 普通文件：文本用编辑器窗口，二进制下载
    if (st.meta && (st.meta.mime === 'application/octet-stream' || st.meta.binary)) {
      await call('file.download', t); return;
    }
    await call('win.open', { type:'editor', path:t, title:st.name });
  }

  async function deviceOpen(path, st) {
    if (st.meta && st.meta.device === 'null') return null;
    if (st.meta && st.meta.device === 'zero') return 0;
    if (st.meta && st.meta.device === 'random') return Math.random();
    if (st.meta && st.meta.device === 'tty') return { path:'/dev/tty', write:out, read: () => call('term.readline') };
    if (st.meta && st.meta.device === 'time') return Date.now();
    return st;
  }

  async function exec(p, ...args) {
    const t = abs(p);
    const st = await fsstat(t);
    if (!st) throw new Error('exec: 不存在: ' + p);
    if (st.kind === 'app') return call('win.open', { app:st.meta.app || st.name, args });
    if (st.kind === 'func') {
      const r = await fsread(t);
      const fn = compileFunction(r.meta && r.meta.source || String(r.content), t);
      return fn(...args);
    }
    if (st.kind === 'package') return loadPackage(st.meta.spec || st.name);
    throw new Error('exec: 不是可执行对象: ' + t);
  }

  function compileFunction(src, name) {
    try {
      return new AsyncFunction('...args', 'return (async()=>{\n"use strict";\n' + src + '\n})()');
    } catch (e) { throw new Error('编译失败 ' + name + ': ' + e.message); }
  }

  /* ---- spotfs 六个 syscall（worker 侧） ----
   * c/n/a/r 直接转发；x 和 d 要落地：x 返回的是「动作描述」，
   * 由这里决定是执行 JS、开浏览器、进目录、请求权限还是结束进程。 */
  async function sptc(p, data, meta) { return call('fs.sptc', abs(p), data, meta || null); }
  async function sptn(p, opts) { return call('fs.sptn', abs(p), opts || {}); }
  async function spta(p, data) { return call('fs.spta', abs(p), data); }
  async function sptr(p) { return call('fs.sptr', abs(p)); }
  async function sptd(p) {
    const r = await call('fs.sptd', abs(p));
    if (r && r.act === 'kill') return kill(r.pid);
    return r;
  }
  /* sptm：挂载。占坑 —— 主线程那边会明确抛「还没做」，不在 worker 里假装成功。 */
  async function sptm(target, source, opts) { return call('fs.sptm', abs(target), source, opts || {}); }
  async function sptx(p, ...args) {
    const d = await call('fs.sptx', abs(p), args);
    if (!d || !d.act) return d;
    if (d.act === 'enter') { await cd(d.path); return { kind:'dir', path:d.path }; }
    if (d.act === 'js') { const fn = compileFunction(d.source, d.path); return fn(...args); }
    if (d.act === 'html') return call('win.open', { type:'browser', html:d.html, title:baseName(d.path) });
    if (d.act === 'object') return d.value;
    if (d.act === 'app') return call('win.open', { app:d.app, path:d.path, args });
    if (d.act === 'perm') return call('perm.request', d.perm);
    if (d.act === 'package') return loadPackage(d.spec);
    if (d.act === 'device') { const st = await fsstat(d.path); return deviceOpen(d.path, st); }
    return d;
  }
  /* 名字转义在主线程实现（TextEncoder 两边都有，但真相只有一份） */
  async function spotEsc(s) { return call('fs.escape', String(s == null ? '' : s)); }
  async function spotUnesc(s) { return call('fs.unescape', String(s == null ? '' : s)); }
  async function spotExport(s) { return call('fs.exportName', String(s == null ? '' : s)); }

  /* ---- 包 ---- */
  async function install(spec) { return loadPackage(spec); }
  async function uninstall(spec) {
    await call('pkg.remove', spec);
    pkgState.mods.delete(spec);
    out(ANSI.gray + '  - ' + spec + ANSI.reset + '\r\n');
  }
  async function requirePkg(spec) {
    if (pkgState.mods.has(spec)) return pkgState.mods.get(spec);
    return loadPackage(spec);
  }

  /* ---- 终端 / 窗口 / 系统 ---- */
  async function python() {
    out(ANSI.yellow + '→ 正在当前终端启动 Python（Pyodide），首次加载需要下载运行时……' + ANSI.reset + '\r\n');
    await call('term.exec', 'python');
  }
  async function spawn(code, opts) { return call('win.open', Object.assign({ type:'shell', code:code || '', title:'shell' }, opts || {})); }
  async function winOpen(opts) { return call('win.open', opts || {}); }
  async function winClose(id) { return call('win.close', id); }
  async function winList() { return call('win.list'); }
  async function agentOpen() { return call('agent.open'); }
  async function saveFile(name, content, mime) { return call('file.save', name, content, mime); }
  async function askFile(opts) { return call('file.ask', opts || {}); }
  async function fetchText(url, opts) {
    const r = await fetch(url, opts || {});
    const text = await r.text();
    return { ok:r.ok, status:r.status, headers:Object.fromEntries(r.headers), text };
  }
  async function openUrl(url) { return call('win.open', { type:'browser', url:String(url) }); }
  async function notify(msg) { return call('notify', String(msg)); }
  async function perm(name) { return call('perm.request', String(name)); }
  async function clear() { out('\x1b[2J\x1b[H'); }

  async function whoami() { out(state.user + '\r\n'); }
  async function uname() {
    const s = 'HTerMinaL ' + HT_VERSION + ' (browser; ' + (self.navigator && navigator.userAgent || 'worker') + ')';
    out(s + '\r\n');
  }
  async function date() { out(new Date().toString() + '\r\n'); }
  async function echo(...a) { out(a.join(' ') + '\r\n'); }
  async function env() {
    const o = { PWD:state.cwd, USER:state.user, SHELL:'hsb1', TERM:'xterm-256color', LANG:'zh_CN.UTF-8', HOME:'.home', HOST:'browser' };
    Object.entries(o).forEach(([k, v]) => out(k + '=' + v + '\r\n'));
  }
  async function ps() {
    const rows = await call('proc.list');
    out('  PID  ROLE      STATE     CWD             TITLE\r\n');
    rows.forEach(r => out(String(r.pid).padStart(5) + '  ' + String(r.role).padEnd(8) + '  ' + String(r.state).padEnd(8) + '  ' + String(r.cwd || '-').padEnd(15) + '  ' + (r.title || '') + '\r\n'));
  }
  async function kill(pid) {
    const ok = await call('proc.kill', Number(pid));
    out((ok ? ANSI.green + '已终止 ' : ANSI.red + '没有这个进程 ') + pid + ANSI.reset + '\r\n');
  }

  /* 清空一切。真正的活在主线程（要处理 IndexedDB 连接、caches、SW），
   * 这里只负责喊一声。以前 README 让用户「终端里敲 nuke()」，但 Worker 里根本没这个函数，
   * 敲下去是 `nuke is not defined` —— 这个洞一直没人发现。 */
  async function nuke() {
    out(ANSI.yellow + '清除全部本地数据：确认后文件系统、依赖缓存、历史、设置都会没，然后重新加载。' + ANSI.reset + '\r\n');
    await call('nuke.run').catch(() => {});
  }

  async function df() {
    const u = await call('fs.usage');
    out('Filesystem      Size    Used   Avail  Use%  Mounted\r\n');
    out('idb://hterm     ' + fmtBytes(u.quota) + '  ' + fmtBytes(u.usage) + '  ' + fmtBytes(Math.max(0, u.quota - u.usage)) + '   ' +
      (u.quota ? Math.round(u.usage / u.quota * 100) : 0) + '%  .\r\n');
    out('localStorage    ~5 MB   ' + fmtBytes(u.localStorage || 0) + '       -      -  .localstorage.\r\n');
  }
  async function mount() {
    const m = await call('fs.mounts');
    m.forEach(x => out(x.mount + ' on ' + x.path + ' type ' + x.type + '\r\n'));
  }

  async function help() {
    const lines = [
      ['', 'HTerMinaL · JSHeL 快速参考'],
      ['文件', 'ls(p)  ll(p)  cd(p)  pwd()  cat(p)  write(p,data)  mkdir(p)  rm(p,{r})  mv  cp  stat  tree  find  grep  head  tail  df  mount'],
      ['执行', 'exec(p)  open(p)  run(code)  require("pkg")  python()  exit()'],
      ['spotfs', 'c sptc(p,data)  n sptn(p,opts)  a spta(p,data)  x sptx(p)  r sptr(p)  d sptd(p)  m sptm(target,src)  —— 七个 syscall（m 是占坑）'],
      ['转义', 'spotEscape(s) 名字→-xx…；spotUnescape 还原；spotExportName 导出去掉病态字符；拖拽/上传共用 importFiles()'],
      ['窗口', 'winOpen({type,title,url,code})  spawn(code)  winList()  winClose(id)  agentOpen()  jshel()'],
      ['系统', 'saveFile(name,body)  askFile()  fetchText(url)  openUrl(url)  notify(msg)  perm(name)  ps()  kill(pid)  nuke()  clear()  history()'],
      ['DOM', 'document 与 F12 一致：querySelector / createElement / appendChild / write / innerHTML / style / classList / addEventListener'],
      ['页面', 'page.q(sel)  page.text(sel)  page.wins()  page.toast(t)  page.eval(code)←主线程原生执行'],
      ['智能体', 'agentTui.open() 进交互模式（提示符变 agent>）· agent("…") 问一句 · agentTui.stop() 中断 · agentTui.close() 退出'],
      ['hsb1', 'hsb1() 进交互式 Linux 风格 shell；hsb1("ls -la") 跑一行；hsb1 里 help 看命令表'],
      ['hsb2', '可选组件（WASM + FreeBSD + v86）：有 GPL 相关风险，默认不加载；hsb2() 启动，hsb2.stop()/clear()/status() 管理'],
      ['真相', 'spotfs：节点对象图，不是 ext4（没有 inode、没有权限位）。.home 是家，.bin 放函数，.app 是应用，.dev 是设备，.proc 是线程，.pkg 是包，.savefile 是“保存到本机”。'],
      ['提示', 'JSHeL 是纯 JS 求值环境（和浏览器控制台一致）：提示符固定为 JSHeL> ，没有「当前目录」；函数名不会自动执行，`ls` 只求值为函数对象，`ls()` 才调用。Linux 命令请 hsb1()。'],
    ];
    for (const [k, v] of lines) {
      if (!k) { out(ANSI.bold + ANSI.cyan + v + ANSI.reset + '\r\n'); continue; }
      out(ANSI.yellow + k.padEnd(6, ' ') + ANSI.reset + v + '\r\n');
    }
  }

  async function historyList() {
    state.history.forEach((h, i) => out(String(i + 1).padStart(4) + '  ' + h + '\r\n'));
  }

  async function exit(code) {
    state.running = false;
    post({ t:'exit', code:code || 0 });
    throw EXIT;
  }

  async function run(code) {
    return execute(String(code));
  }

  /* ---- 执行器 ---- */

  async function execute(raw) {
    let code = raw;
    if (!code.trim()) return;
    // 反斜杠续行
    while (/\\\s*$/.test(code)) {
      const next = await askLine('... ');
      if (next === null) break;
      code = code.replace(/\\\s*$/, '') + '\n' + next;
    }
    let value, error = null;
    /* DOM 预取：把代码里写死的选择器一次拉回来，让
     * `document.querySelector('#x').innerHTML` 这种同步读能拿到值。
     * 不改变语义，只是把「读」提前做掉。 */
    try { await prefetchDom(code); } catch (e) {}
    try {
      /* 求值只有一条路：HTScript.run（和智能体的 js 工具同一份）。
       * 交互层这里只管「续行、DOM 预取、打印」。 */
      value = await HTScript.run(code);
      /* 不做「裸命令自动调用」：JSHeL 只按真实 JS 求值，
       * `ls` 得到函数对象本身，`ls()` 才是调用。 */
      state.last = value;
    } catch (e) {
      if (e === EXIT) throw e;
      error = e;
      state.lastError = e;
      const msg = e && e.message || String(e);
      writeErr((e && e.name ? e.name + ': ' : '') + msg + '\r\n');
      /* 只加一句指路的话，不改变「这一行是按 JS 求值的」这个事实。
       * 以前这里是偷偷把 `ls -la` 当 shell 跑掉，那才叫不可预测。 */
      /* 敲了 shell 命令却没进 shell：SyntaxError（`ls -la`）和 ReferenceError
       * （`nano x`）都会发生。这里只补一句指路，不改变求值方式。 */
      if (e instanceof SyntaxError || e instanceof ReferenceError) {
        const first = String(code).trim().split(/[\s|;>]+/)[0] || '';
        const gone = /^(apt|ping|bash|sh|zsh|su|sudo|chmod|npm|pip|logout)$/.test(first);
        const known = typeof COMPAT !== 'undefined' && COMPAT.commands[first];
        if (first && (gone || known)) {
          out(ANSI.gray + '提示：' + first + ' 是 hsb1 命令。hsb1() 进 shell，或 hsb1(' + JSON.stringify(String(code).trim()) + ')。' + ANSI.reset + '\r\n');
        }
      }
      if (e && e.stack) {
        const st = String(e.stack).split('\n').slice(1, 5).filter(l => !/^\s*at (new AsyncFunction|execute|LineEditor)/.test(l));
        if (st.length) out(ANSI.gray + st.join('\r\n') + ANSI.reset + '\r\n');
      }
      if (self.__agentMode) post({ t:'agent-error', error:{ name:e && e.name, message:msg, stack:e && e.stack } });
    }
    if (error && state.running) {
      // 不把错误值当作结果
    } else if (value !== undefined && state.running) {
      out(inspect(value, 0) + '\r\n');
    }
    return { value, error };
  }

  // 在 shell 里等待一行（用于续行 / 设备读取）
  function askLine(prompt) {
    return new Promise(resolve => {
      const prev = self.__shell && self.__shell.editor;
      const ed = new LineEditor({
        prompt, onSubmit: async (line) => { finish(line); },
        onEOF: () => finish(null), history: state.history, onHistory: saveHistory,
        cols: () => state.cols, rows: () => state.rows
      });
      const finish = (v) => {
        ed.closed = true;
        if (self.__shell) self.__shell.editor = prev;
        resolve(v);
      };
      if (self.__shell) self.__shell.editor = ed;
      ed.start();
    });
  }

  /* ---- 补全 ---- */
  async function complete(before) {
    const m = before.match(/([^\s()\[\]{}'"`,;]*)$/);
    const frag = m ? m[1] : '';
    const head = before.slice(0, before.length - frag.length);
    let candidates = [];
    if (/^\.?(?:[\w\u4e00-\u9fa5-]*\.)*[\w\u4e00-\u9fa5-]*$/.test(frag) && (frag.startsWith('.') || before.trim() === frag || /\b(ls|cd|cat|open|exec|rm|stat)\s*\(?['"]?$/.test(head))) {
      try {
        const slash = frag.lastIndexOf('.');
        const dirPart = slash >= 0 ? frag.slice(0, slash) : '';
        const namePart = slash >= 0 ? frag.slice(slash + 1) : frag;
        const dir = await call('fs.resolve', dirPart || state.cwd);
        const rows = await fsls(dir);
        candidates = rows.filter(r => r.name.toLowerCase().startsWith(namePart.toLowerCase()))
          .map(r => ({ name:r.name + (r.kind === 'dir' ? '.' : ''), value:(slash >= 0 ? frag.slice(0, slash + 1) : '') + r.name + (r.kind === 'dir' ? '.' : '') }));
      } catch (e) {}
    } else {
      const keys = new Set(Object.getOwnPropertyNames(globalThis));
      candidates = [...keys].filter(k => k.toLowerCase().startsWith(frag.toLowerCase()) && !k.startsWith('__'))
        .slice(0, 80).map(k => ({ name:k, value:k }));
    }
    if (candidates.length === 1) return { value:head + candidates[0].value, candidates };
    return { candidates, value:undefined };
  }

  /* ---- 组装全局 API ---- */
  const api = {
    // 文件
    ls, ll, dir:ls, cd, pwd, cat, write:writeFile, writeFile, readFile:fsread, listDir:fsls, append:async (p, d) => {
      const r = await fsread(abs(p)).catch(() => ({ content:'' }));
      return fswrite(abs(p), String(r.content || '') + String(d));
    },
    mkdir, rm, mv, cp, stat, exists, tree, find, head, tail, grep, open, exec, run, du, df, mount,
    /* spotfs 六个 syscall（canonical）+ 名字转义 */
    sptc, sptn, spta, sptr, sptx, sptd, sptm,
    spotEscape: spotEsc, spotUnescape: spotUnesc, spotExportName: spotExport,
    // 包
    install, uninstall, require:requirePkg, pkg:{ install, remove:uninstall, list:() => call('pkg.list'), require:requirePkg },
    // 窗口 / 系统
    python, py:python, spawn, winOpen, winClose, winList, agentOpen,
    saveFile, askFile, fetchText, openUrl, notify, perm, requestPermission:perm,
    /* 别名：README 第 11 节那张表里用的是长名字（remove / move / copy / openWindow …），
     * 但实现里叫 rm / mv / cp / winOpen。两边对不上，用户照着 README 敲就是 undefined。
     * 这里把长名字补齐，短名字保留——两套都能用。 */
    remove:rm, move:mv, copy:cp,
    openWindow:winOpen, closeWindow:winClose, listWindows:winList,
    openURL:openUrl,
    threads:{ list:() => call('proc.list'), kill },
    settings:{
      get:(k) => call('settings.get', k),
      set:(k, v) => call('settings.set', String(k), v),
      all:() => call('settings.all')
    },
    whoami, uname, date, echo, env, ps, kill, nuke, clear, history:historyList, help, exit,
    sleep:(ms) => new Promise(r => setTimeout(r, ms)),
    uuid:() => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2)),
    // 内建对象
    console:con,
    fs:{ read:fsread, write:fswrite, list:fsls, remove:fsrm, mkdir:fsmkdir, stat:fsstat, move:fsmv, copy:fscp, resolve:norm,
         sptc, sptn, spta, sptr, sptx, sptd, sptm, spotEscape: spotEsc, spotUnescape: spotUnesc, spotExportName: spotExport },
    term:{ write:out, writeln:(s) => out(s + '\r\n'), clear, columns:() => ctx.cols, rows:() => ctx.rows },
    envVars:{},
    __state:state
  };
  api.__complete = complete;
  api.hterm = api;
  api.global = globalThis;
  return api;
}


/* ============================================================================
 * Worker 侧的 DOM / window 代理
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 *
 * 目标只有一个：**让 `document` 就是 F12 里的那个 `document`**。
 * 不是「安全的子集」，不是「差不多能用」——用户的原话是
 * 「哪怕把页面破坏掉也必须执行」，所以这里没有一层「为你好」的拦截。
 *
 *   真做的：
 *     document.write('<h1>x</h1>')   真的 document.write，整页清空也照做
 *     document.body.innerHTML = 'x'  真的写宿主 body
 *     el.textContent = 'y'           真的赋值，**不**补发 input/change（原生也不发）
 *     el.style.color = 'red'         真的改样式
 *     document.createElement/append  真节点，真插进页面
 *     el.addEventListener(...)       真注册在主线程，事件异步回放到 Worker
 *
 *   物理上做不到的（跨线程，不是偷懒）：
 *     同步读取总有「最后一次快照」的延迟；写永远立刻生效。
 *     要 100% 同步语义用 page.eval('…') —— 那段代码在主线程跑，就是 F12 本身。
 * ==========================================================================*/

const DOMC = {
  root: null,            // 最近一次 snap 的结果
  nodes: new Map(),      // ref -> desc
  bySel: new Map(),      // 选择器 -> desc（预取填充）
  lists: new Map(),      // 选择器 -> desc[]
  proxies: new Map(),    // ref -> Proxy
  refSeq: 0,
  listeners: new Map(),  // id -> { type, fn, sel }
  chosen: new Map(),     // 回调函数 -> listener id
  newRef() { return '\u0001w' + (++this.refSeq); },
  clear() { this.nodes.clear(); this.bySel.clear(); this.lists.clear(); this.proxies.clear(); }
};

const HTML_NS = '[object HTMLElement]';
const camel2kebab = (s) => String(s).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
const kebab2camel = (s) => String(s).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function refOf(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  if (x.__ref) return x.__ref;
  return null;
}

/* ---------------------------------------------------------------- 元素句柄 */
function nodeProxy(ref) {
  if (!ref) return null;
  if (DOMC.proxies.has(ref)) return DOMC.proxies.get(ref);
  const st = { __ref: ref };
  const D = () => DOMC.nodes.get(ref) || null;
  const c = (op, ...args) => callDom(op, ref, ...args);

  const styleProxy = () => {
    const d = D();
    const cs = Object.assign({}, (d && d.computed) || {});
    const set = (p, v) => {
      const key = camel2kebab(p);
      cs[key] = String(v);
      callDom('setProp', ref, 'style.' + p, String(v));
    };
    return new Proxy({}, {
      get(t, p) {
        if (typeof p === 'symbol') return undefined;
        if (p === 'cssText') return Object.keys(cs).map(k => k + ':' + cs[k]).join('; ');
        if (p === 'setProperty') return (n, v) => set(n, v);
        if (p === 'getPropertyValue') return (n) => cs[String(n)] || '';
        if (p === 'removeProperty') return (n) => { delete cs[String(n)]; callDom('setProp', ref, 'style.' + kebab2camel(n), ''); };
        return cs[camel2kebab(p)] || '';
      },
      set(t, p, v) { if (typeof p === 'symbol') return true; set(p, v); return true; },
      has(t, p) { return camel2kebab(p) in cs; },
      ownKeys() { return Object.keys(cs); },
      getOwnPropertyDescriptor(t, p) { return { value: cs[camel2kebab(p)] || '', enumerable: true, configurable: true }; }
    });
  };

  const classListFor = () => {
    const d = D();
    const arr = () => String((D() && D().cls) || '').split(/\s+/).filter(Boolean);
    return {
      add: (...cs) => { for (const k of cs) callDom('addClass', ref, String(k)); const a = arr(); for (const k of cs) if (!a.includes(k)) a.push(k); if (D()) D().cls = a.join(' '); },
      remove: (...cs) => { for (const k of cs) callDom('removeClass', ref, String(k)); if (D()) D().cls = arr().filter(x => !cs.includes(x)).join(' '); },
      toggle: (k, force) => { const has = arr().includes(k); const on = force === undefined ? !has : !!force; callDom('toggleClass', ref, String(k), on); if (D()) D().cls = (on ? [...arr(), k] : arr().filter(x => x !== k)).filter((v, i, s) => s.indexOf(v) === i).join(' '); return on; },
      contains: (k) => arr().includes(k),
      replace: (a, b) => { const x = arr(); const i = x.indexOf(a); if (i < 0) return false; x[i] = b; callDom('setProp', ref, 'className', x.join(' ')); if (D()) D().cls = x.join(' '); return true; },
      item: (i) => arr()[i] || null,
      forEach: (fn) => arr().forEach(fn),
      get length() { return arr().length; },
      get value() { return (D() && D().cls) || ''; },
      toString() { return (D() && D().cls) || ''; }
    };
  };

  const datasetFor = () => new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      const d = D();
      return (d && d.attrs && d.attrs['data-' + camel2kebab(p)]) || undefined;
    },
    set(t, p, v) { if (typeof p === 'symbol') return true; callDom('setAttr', ref, 'data-' + camel2kebab(p), String(v)); const d = D(); if (d) { d.attrs = d.attrs || {}; d.attrs['data-' + camel2kebab(p)] = String(v); } return true; },
    deleteProperty(t, p) { callDom('rmAttr', ref, 'data-' + camel2kebab(p)); return true; },
    has(t, p) { const d = D(); return !!(d && d.attrs && ('data-' + camel2kebab(p)) in d.attrs); },
    ownKeys() { const d = D(); return Object.keys((d && d.attrs) || {}).filter(k => k.startsWith('data-')).map(k => kebab2camel(k.slice(5))); },
    getOwnPropertyDescriptor(t, p) { return { enumerable: true, configurable: true, value: datasetFor()[p] }; }
  });

  const kids = () => { const d = D(); return (d && d.children) || []; };
  const sibling = (dir) => {
    const d = D(); if (!d || !d.parent) return null;
    const sibs = (DOMC.nodes.get(d.parent) || {}).children || [];
    const i = sibs.indexOf(ref);
    if (i < 0) return null;
    return sibs[i + dir] ? nodeProxy(sibs[i + dir]) : null;
  };

  const M = {
    /* 老 API（自定义的，保留，别处还在用） */
    text: () => (D() ? (D().text || '') : ''),
    html: () => (D() ? (D().html != null ? D().html : '') : ''),
    attr: (n) => { const d = D(); return d && d.attrs ? (d.attrs[String(n)] ?? null) : null; },
    rect: () => { const d = D(); return d ? { ...d.rect } : { x:0, y:0, w:0, h:0 }; },
    exists: () => !!D(),
    setText: (v) => { callDom('setText', ref, String(v)); if (D()) D().text = String(v); },
    setHtml: (v) => { callDom('setHtml', ref, String(v)); if (D()) D().html = String(v); },
    setValue: (v) => { callDom('setProp', ref, 'value', v); if (D()) D().value = v; },

    /* 原生 API */
    click: () => { callDom('click', ref); },
    focus: () => { callDom('focus', ref); },
    blur: () => { callDom('blur', ref); },
    remove: () => { callDom('remove', ref); },
    getAttribute: (n) => { const d = D(); return d && d.attrs && String(n) in d.attrs ? d.attrs[String(n)] : null; },
    setAttribute: (n, v) => { callDom('setAttr', ref, String(n), String(v)); const d = D(); if (d) { d.attrs = d.attrs || {}; d.attrs[String(n)] = String(v); } },
    removeAttribute: (n) => { callDom('rmAttr', ref, String(n)); const d = D(); if (d && d.attrs) delete d.attrs[String(n)]; },
    hasAttribute: (n) => { const d = D(); return !!(d && d.attrs && String(n) in d.attrs); },
    toggleAttribute: (n, force) => { const has = M.hasAttribute(n); const on = force === undefined ? !has : !!force; if (on) M.setAttribute(n, ''); else M.removeAttribute(n); return on; },
    getAttributeNames: () => Object.keys((D() && D().attrs) || {}),
    appendChild: (child) => { const r = refOf(child); if (r) callDom('append', ref, r); return child; },
    append: (...nodes) => { for (const n of nodes) { if (typeof n === 'string') callDom('appendHtml', ref, n); else { const r = refOf(n); if (r) callDom('append', ref, r); } } },
    prepend: (...nodes) => { for (const n of nodes) { if (typeof n === 'string') callDom('prependHtml', ref, n); else { const r = refOf(n); if (r) callDom('prepend', ref, r); } } },
    insertBefore: (child, before) => { const r = refOf(child); if (r) callDom('insertBefore', ref, r, before ? refOf(before) : null); return child; },
    removeChild: (child) => { const r = refOf(child); if (r) callDom('removeChild', ref, r); return child; },
    replaceChild: (n, o) => { callDom('replaceChild', ref, refOf(n), refOf(o)); return o; },
    insertAdjacentHTML: (pos, html) => { callDom('insertHtml', ref, String(pos), String(html)); },
    insertAdjacentText: (pos, txt) => { callDom('insertHtml', ref, String(pos), String(txt).replace(/[&<>]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m]))); },
    cloneNode: (deep) => { const r = DOMC.newRef(); callDom('cloneAs', ref, r, !!deep); return nodeProxy(r); },
    contains: (other) => { const d = D(); const r = refOf(other); if (!d || !r) return false; return d.children && d.children.includes(r); },
    matches: (sel) => new Promise(res => call('dom.op', 'matches', [ref, String(sel)]).then(v => res(!!v)).catch(() => res(false))),
    closest: (sel) => new Promise(res => call('dom.op', 'closest', [ref, String(sel)]).then(v => res(v ? nodeProxy(v) : null)).catch(() => res(null))),
    querySelector: (sel) => { const r = DOMC.newRef(); callDom('queryInAs', ref, r, String(sel)); return nodeProxy(r); },
    querySelectorAll: (sel) => {
      const arr = [];
      call('dom.op', 'allIn', [ref, String(sel), DOMC.newRef()]).then(list => {
        for (const d of (list && list.items) || []) { DOMC.nodes.set(d.ref, d); arr.push(nodeProxy(d.ref)); }
      }).catch(() => {});
      return arr;
    },
    getElementsByTagName: (t) => M.querySelectorAll(String(t)),
    getElementsByClassName: (c2) => M.querySelectorAll('.' + String(c2).trim().split(/\s+/).join('.')),
    getBoundingClientRect: () => {
      const d = D(); const r = (d && d.rect) || { x:0, y:0, w:0, h:0 };
      callDom('rectRefresh', ref);
      return { x:r.x, y:r.y, width:r.w, height:r.h, top:r.y, left:r.x, right:r.x + r.w, bottom:r.y + r.h, toJSON() { return this; } };
    },
    getClientRects: () => [M.getBoundingClientRect()],
    scrollIntoView: () => { callDom('callMethod', ref, 'scrollIntoView', []); },
    setAttributeNS: (ns, n, v) => M.setAttribute(n, v),
    addEventListener: (type, fn) => {
      if (typeof fn !== 'function') return;
      const key = ref + '|' + type + '|' + DOMC.listeners.size;
      const id = (++DOMC.seqcounter) || (DOMC.seqcounter = 1);
      DOMC.listeners.set(id, { type: String(type), fn, sel: ref });
      DOMC.chosen.set(fn, id);
      callDom('listen', ref, String(type)).then(real => {
        const L = DOMC.listeners.get(id);
        if (L) L.real = real;
      }).catch(() => {});
    },
    removeEventListener: (type, fn) => {
      const id = DOMC.chosen.get(fn);
      if (!id) return;
      const L = DOMC.listeners.get(id);
      if (L && L.real) call('dom.op', 'unlisten', [L.real]).catch(() => {});
      DOMC.listeners.delete(id);
      DOMC.chosen.delete(fn);
    },
    dispatchEvent: (ev) => { callDom('dispatch', ref, (ev && ev.type) || 'click', (ev && ev.detail)); return true; }
  };
  DOMC.seqcounter = DOMC.seqcounter || 0;

  const handler = {
    get(t, k) {
      if (k === '__ref') return ref;
      if (typeof k === 'symbol') {
        if (k === Symbol.toPrimitive) return () => '[object HTMLUnknownElement]';
        if (k === Symbol.toStringTag) return 'HTMLElement';
        return undefined;
      }
      if (k === 'then') return undefined;          // 别让 await el 挂死
      if (k === 'toJSON') return () => ({ __ref: ref });
      if (k in M) return M[k];
      const d = D();
      /* 真属性 */
      switch (k) {
        case 'tagName': return d ? String(d.tag).toUpperCase() : '';
        case 'localName': return d ? d.tag : '';
        case 'nodeName': return d ? (d.nodeName || String(d.tag).toUpperCase()) : '';
        case 'nodeType': return 1;
        case 'nodeValue': return null;
        case 'isConnected': return !!(d && d.connected !== false);
        case 'innerHTML': return d ? (d.html != null ? d.html : '') : '';
        case 'outerHTML': return d ? (d.outer != null ? d.outer : '') : '';
        case 'textContent':
        case 'innerText': return d ? (d.text || '') : '';
        case 'value': return d && d.value !== undefined ? d.value : '';
        case 'checked': return !!(d && d.checked);
        case 'selected': return !!(d && d.selected);
        case 'id': return d ? (d.id || '') : '';
        case 'className': return d ? (d.cls || '') : '';
        case 'classList': return classListFor();
        case 'style': return styleProxy();
        case 'dataset': return datasetFor();
        case 'attributes': return Object.entries((d && d.attrs) || {}).map(([n, v]) => ({ name:n, value:v, nodeName:n, nodeValue:v }));
        case 'children':
        case 'childNodes': return kids().map(r => nodeProxy(r));
        case 'childElementCount': return kids().length;
        case 'firstChild':
        case 'firstElementChild': return kids()[0] ? nodeProxy(kids()[0]) : null;
        case 'lastChild':
        case 'lastElementChild': { const a = kids(); return a.length ? nodeProxy(a[a.length - 1]) : null; }
        case 'nextSibling':
        case 'nextElementSibling': return sibling(1);
        case 'previousSibling':
        case 'previousElementSibling': return sibling(-1);
        case 'parentNode':
        case 'parentElement': return d && d.parent ? nodeProxy(d.parent) : null;
        case 'ownerDocument': return globalThis.document;
        case 'offsetWidth':
        case 'clientWidth': return d ? d.rect.w : 0;
        case 'offsetHeight':
        case 'clientHeight': return d ? d.rect.h : 0;
        case 'offsetLeft': return d ? d.rect.x : 0;
        case 'offsetTop': return d ? d.rect.y : 0;
        case 'scrollTop': return 0;
        case 'scrollLeft': return 0;
        case 'scrollWidth': return d ? d.rect.w : 0;
        case 'scrollHeight': return d ? d.rect.h : 0;
        case 'hidden': return !!(d && d.attrs && 'hidden' in d.attrs);
        case 'disabled': return !!(d && d.attrs && 'disabled' in d.attrs);
        case 'form': return null;
        case 'files': return null;
        case 'src':
        case 'href':
        case 'alt':
        case 'title':
        case 'type':
        case 'name':
        case 'placeholder':
        case 'htmlFor':
        case 'target':
          return d && d.attrs ? (d.attrs[k === 'htmlFor' ? 'for' : k] ?? '') : '';
        default: break;
      }
      /* 兜底：属性 → 计算样式 */
      if (d && d.attrs && k in d.attrs) return d.attrs[k];
      if (d && d.computed && k in d.computed) return d.computed[k];
      return undefined;
    },
    set(t, k, v) {
      if (typeof k === 'symbol') return true;
      if (k === 'innerHTML') { callDom('setHtml', ref, String(v)); const d = D(); if (d) d.html = String(v); return true; }
      if (k === 'outerHTML') { callDom('setOuter', ref, String(v)); return true; }
      if (k === 'textContent' || k === 'innerText') { callDom('setText', ref, String(v)); const d = D(); if (d) d.text = String(v); return true; }
      if (k === 'className') { callDom('setProp', ref, 'className', String(v)); const d = D(); if (d) d.cls = String(v); return true; }
      if (k === 'id') { callDom('setProp', ref, 'id', String(v)); const d = D(); if (d) d.id = String(v); return true; }
      if (k === 'style') { callDom('setProp', ref, 'style', String(v)); return true; }
      if (k === 'value') { callDom('setProp', ref, 'value', v); const d = D(); if (d) d.value = v; return true; }
      if (k === 'checked') { callDom('setProp', ref, 'checked', !!v); const d = D(); if (d) d.checked = !!v; return true; }
      if (k === 'hidden' || k === 'disabled' || k === 'selected') {
        if (v) callDom('setAttr', ref, k, ''); else callDom('rmAttr', ref, k);
        const d = D(); if (d) { d.attrs = d.attrs || {}; if (v) d.attrs[k] = ''; else delete d.attrs[k]; }
        return true;
      }
      if (/^on[a-z]/.test(k)) {
        if (typeof v === 'function') { const type = k.slice(2); t.__on = t.__on || {}; if (!t.__on[type]) M.addEventListener(type, v); }
        return true;
      }
      callDom('setProp', ref, k, (v && typeof v === 'object') ? String(v) : v);
      const d = D(); if (d && d.attrs) d.attrs[k] = String(v);
      return true;
    },
    has(t, k) {
      if (typeof k === 'symbol') return false;
      const d = D();
      return k in M || (d && d.attrs && k in d.attrs) || ['innerHTML','textContent','id','className','tagName','style','classList','value'].includes(k);
    },
    deleteProperty(t, k) { if (typeof k === 'string') M.removeAttribute(k); return true; },
    ownKeys(t) {
      const d = D();
      const base = Object.keys((d && d.attrs) || {});
      return [...new Set([...base, 'id', 'className', 'tagName', 'innerHTML', 'textContent', 'children', 'parentNode', 'style', 'classList'])];
    },
    getOwnPropertyDescriptor(t, k) { return { enumerable: true, configurable: true, value: handler.get(t, k) }; }
  };

  const p = new Proxy(st, handler);
  DOMC.proxies.set(ref, p);
  return p;
}

/* callDom：所有元素操作的统一出口。ref 会作为第一个参数传下去。 */
function callDom(op, ref, ...args) {
  return call('dom.op', op, [ref, ...args]).catch(() => null);
}

/* ---------------------------------------------------------------- 执行前预取
 * 从代码文本里抠出选择器，一次拉回来，这样
 *   document.querySelector('#x').innerHTML
 * 在 Worker 里能同步拿到值（不用 await）。
 * 不改变任何语义——只是把「读」提前做了。 */
async function prefetchDom(code) {
  if (!code || typeof code !== 'string') return;
  if (!/\b(document|window|page|localStorage|getComputedStyle)\b/.test(code)) return;
  /* 不要默认把 body/html 塞进来：deep 快照带 innerHTML，整页可能是几 MB，
   * 每条命令都拉一遍会把 REPL 拖到几百毫秒。只有代码里真出现才拉。 */
  const sels = new Set();
  const listSels = new Set();
  const wantDeep = /innerHTML|outerHTML|textContent|innerText/.test(code);
  if (wantDeep) { sels.add('body'); sels.add('head'); sels.add('html'); }
  else {
    if (/\bdocument\.body\b/.test(code)) sels.add('body');
    if (/\bdocument\.head\b/.test(code)) sels.add('head');
    if (/documentElement|\bdocument\.html\b/.test(code)) sels.add('html');
  }
  const re = /(querySelectorAll|querySelector|getElementById|closest)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
  let m;
  while ((m = re.exec(code))) {
    const kind = m[1], sel = m[3];
    if (!sel) continue;
    if (kind === 'getElementById') sels.add('#' + sel.replace(/[^\w-]/g, '\\$&'));
    else if (kind === 'querySelectorAll') listSels.add(sel);
    else sels.add(sel);
  }
  /* page.q('…') / page.el('…') 也是选择器，别漏 */
  const re2 = /page\.(?:q|el|text|html|attr|exists|click|setText|setValue|setAttr)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  while ((m = re2.exec(code))) { if (m[2]) sels.add(m[2]); }
  /* 裸的 document.body / document.head 之类靠 body/head 兜住 */
  try {
    const snap = await call('dom.op', 'snap', []);
    if (!snap) return;
    DOMC.root = snap;
    for (const k of ['doc', 'html', 'head', 'body', 'active']) {
      const d = snap[k];
      if (d && d.ref) { DOMC.nodes.set(d.ref, d); }
    }
    if (snap.body) DOMC.bySel.set('body', snap.body);
    if (snap.head) DOMC.bySel.set('head', snap.head);
    if (snap.html) DOMC.bySel.set('html', snap.html);
    DOMC.bySel.set('documentElement', snap.html);
    DOMC.bySel.set(':root', snap.html);
    DOMC.bySel.set('body', snap.body);
  } catch (e) {}
  const one = [...sels];
  const many = [...listSels];
  if (!one.length && !many.length) return;
  try {
    const got = await call('dom.op', 'prefetch', [one, many]);
    for (const sel of Object.keys(got || {})) {
      const v = got[sel];
      if (!v) { DOMC.bySel.set(sel, null); continue; }
      if (v.__list) {
        DOMC.lists.set(sel, v.items || []);
        for (const d of v.items || []) DOMC.nodes.set(d.ref, d);
      } else {
        if (v.ref) DOMC.nodes.set(v.ref, v);
        DOMC.bySel.set(sel, v);
      }
    }
  } catch (e) {}
}

/* ---------------------------------------------------------------- document */
function makeDocument() {
  const c = (op, ...args) => call('dom.op', op, args);
  const docRef = '\u0001doc';

  const elsFromSel = (sel) => {
    const d = DOMC.bySel.get(sel);
    if (d && d.ref) return nodeProxy(d.ref);
    const r = DOMC.newRef();
    call('dom.op', 'queryAs', [r, String(sel)]).then(x => { if (x && x.ref) { DOMC.nodes.set(x.ref, x); DOMC.bySel.set(sel, x); } }).catch(() => {});
    return nodeProxy(r);
  };

  const document = {
    /* ---- 元信息 ---- */
    get title() { return (DOMC.root && DOMC.root.title) || ''; },
    set title(v) { c('setTitle', String(v)); if (DOMC.root) DOMC.root.title = String(v); },
    get readyState() { return (DOMC.root && DOMC.root.readyState) || 'complete'; },
    get URL() { return (DOMC.root && DOMC.root.url) || ''; },
    get documentURI() { return this.URL; },
    get baseURI() { return this.URL; },
    get domain() { try { return new URL(this.URL).hostname; } catch (e) { return ''; } },
    get referrer() { return ''; },
    get cookie() { return (DOMC.root && DOMC.root.cookie) || ''; },
    set cookie(v) { c('setCookie', String(v)); if (DOMC.root) DOMC.root.cookie = String(v); },
    get characterSet() { return 'UTF-8'; },
    get charset() { return 'UTF-8'; },
    get contentType() { return 'text/html'; },
    get hidden() { return false; },
    get visibilityState() { return 'visible'; },
    get dir() { return 'ltr'; },
    hasFocus: () => true,

    /* ---- 树根 ---- */
    get documentElement() { return elsFromSel('html'); },
    get body() { return elsFromSel('body'); },
    get head() { return elsFromSel('head'); },
    get activeElement() { return DOMC.root && DOMC.root.active ? nodeProxy(DOMC.root.active.ref) : elsFromSel('body'); },
    get scrollingElement() { return elsFromSel('html'); },
    get children() { const h = DOMC.root && (DOMC.root.html || DOMC.root.doc); return h ? [nodeProxy(h.ref)] : []; },

    /* ---- 查询 ---- */
    querySelector: (sel) => { try { return elsFromSel(String(sel)); } catch (e) { throw new Error('querySelector: ' + sel + ' 不是有效选择器'); } },
    querySelectorAll: (sel) => {
      const key = String(sel);
      const cached = DOMC.lists.get(key);
      const arr = [];
      if (cached) for (const d of cached) arr.push(nodeProxy(d.ref));
      else {
        call('dom.op', 'all', [key, 300, true]).then(list => {
          DOMC.lists.set(key, (list && list.items) || []);
          for (const d of (list && list.items) || []) {
            DOMC.nodes.set(d.ref, d);
            if (!arr.some(x => x.__ref === d.ref)) arr.push(nodeProxy(d.ref));
          }
        }).catch(() => {});
      }
      arr.item = (i) => arr[i] || null;
      return arr;
    },
    getElementById: (id) => elsFromSel('#' + String(id).replace(/[^\w\u00a0-\uffff-]/g, '\\$&')),
    getElementsByClassName: (cls) => document.querySelectorAll('.' + String(cls).trim().split(/\s+/).join('.')),
    getElementsByTagName: (tag) => document.querySelectorAll(String(tag) === '*' ? '*' : String(tag)),
    getElementsByName: (n) => document.querySelectorAll('[name="' + String(n).replace(/"/g, '\\"') + '"]'),
    elementFromPoint: (x, y) => { const r = DOMC.newRef(); call('dom.op', 'fromPoint', [r, x, y]).catch(() => {}); return nodeProxy(r); },

    /* ---- 创建 ---- */
    createElement: (tag, opts) => {
      const r = DOMC.newRef();
      let props = null, html = null;
      if (typeof opts === 'string') html = opts;
      else if (opts && typeof opts === 'object') props = opts;
      call('dom.op', 'createAs', [r, String(tag), props, html]).catch(() => {});
      return nodeProxy(r);
    },
    createElementNS: (ns, tag) => document.createElement(String(tag).replace(/^.*:/, '')),
    createTextNode: (t) => {
      const r = DOMC.newRef();
      call('dom.op', 'createTextAs', [r, String(t == null ? '' : t)]).catch(() => {});
      return nodeProxy(r);
    },
    createDocumentFragment: () => {
      const r = DOMC.newRef();
      call('dom.op', 'createFragmentAs', [r]).catch(() => {});
      return nodeProxy(r);
    },
    createComment: (t) => document.createTextNode(''),
    importNode: (n, deep) => { const r = DOMC.newRef(); call('dom.op', 'cloneAs', [refOf(n), r, !!deep]).catch(() => {}); return nodeProxy(r); },

    /* ---- 真·write ---- */
    /* 返回 undefined，和浏览器一样。它会清空文档——这是浏览器行为，不拦。 */
    write(...parts) {
      const html = parts.map(x => String(x == null ? '' : x)).join('');
      call('dom.op', 'docWrite', [html]).then(() => { DOMC.clear(); }).catch(() => {});
    },
    writeln(...parts) {
      const html = parts.map(x => String(x == null ? '' : x)).join('') + '\n';
      call('dom.op', 'docWriteln', [html]).then(() => { DOMC.clear(); }).catch(() => {});
    },
    open() { call('dom.op', 'docOpen', []).then(() => DOMC.clear()).catch(() => {}); return this; },
    close() { call('dom.op', 'docClose', []).catch(() => {}); },

    /* ---- 事件 ---- */
    addEventListener: (type, fn) => { if (typeof fn === 'function') addWorkerListener(docRef, String(type), fn); },
    removeEventListener: (type, fn) => { removeWorkerListener(fn); },
    dispatchEvent: (ev) => { call('dom.op', 'dispatch', [docRef, (ev && ev.type) || 'click', ev && ev.detail]).catch(() => {}); return true; },

    /* ---- HTerMinaL 扩展（不是 DOM 标准，但保留兼容） ---- */
    __snap: () => DOMC.root,
    get __html() { return (DOMC.root && DOMC.root.html && DOMC.root.html.text) || ''; }
  };

  /* document.location 与 window.location 是同一个对象 */
  return document;
}

/* ---------------------------------------------------------------- 监听表 */
function addWorkerListener(sel, type, fn) {
  const id = ++DOMC.seq;
  DOMC.listeners.set(id, { type, fn, sel });
  DOMC.chosen.set(fn, id);
  call('dom.op', 'listen', [sel, type]).then(real => {
    const L = DOMC.listeners.get(id);
    if (L) L.real = real;
  }).catch(() => {});
}
function removeWorkerListener(fn) {
  const id = DOMC.chosen.get(fn);
  if (!id) return;
  const L = DOMC.listeners.get(id);
  if (L && L.real != null) call('dom.op', 'unlisten', [L.real]).catch(() => {});
  DOMC.listeners.delete(id);
  DOMC.chosen.delete(fn);
}
/* 主线程转过来的事件：按 listener id 找到 Worker 里的函数并调用。 */
function dispatchWorkerEvent(msg) {
  const L = DOMC.listeners.get(Number(msg.id));
  if (!L || typeof L.fn !== 'function') return;
  const e = msg.ev || {};
  const target = e.target && e.target.ref ? nodeProxy(e.target.ref) : null;
  const ev = {
    type: e.type,
    target,
    currentTarget: target,
    bubbles: true, cancelable: true, defaultPrevented: !!e.defaultPrevented,
    key: e.key, code: e.code, repeat: !!e.repeat,
    clientX: e.clientX, clientY: e.clientY, button: e.button,
    value: e.value, checked: e.checked,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
  try { L.fn.call(target, ev); } catch (err) { out(ANSI.red + '[listener] ' + (err && err.message || err) + ANSI.reset + '\r\n'); }
}

/* ---------------------------------------------------------------- 安装 */
function installDomProxy(call_) {
  const c = (op, ...args) => call_('dom.op', op, args);
  /* 原生 API 不走 dom.op（那一层只认 DOM 操作，也不该认识 window 方法） */
  const nat = (name, args) => call_('native', name, args);
  const document = makeDocument();

  /* localStorage：同步读快照、异步写回。和真的一样，写立刻能读到。 */
  let lsSnap = Object.create(null);
  const lsRefresh = () => c('ls.all').then(o => { lsSnap = Object.assign(Object.create(null), o || {}); }).catch(() => {});
  lsRefresh();
  const localStorage = {
    getItem: (k) => (String(k) in lsSnap ? lsSnap[String(k)] : null),
    setItem: (k, v) => { lsSnap[String(k)] = String(v); c('ls.set', String(k), String(v)).catch(() => {}); },
    removeItem: (k) => { delete lsSnap[String(k)]; c('ls.rm', String(k)).catch(() => {}); },
    key: (i) => Object.keys(lsSnap)[i] || null,
    get length() { return Object.keys(lsSnap).length; },
    clear: () => { for (const k of Object.keys(lsSnap)) delete lsSnap[k]; c('ls.clear').catch(() => {}); },
    __refresh: lsRefresh,
    __snapshot: () => ({ ...lsSnap })
  };

  /* page：HTerMinaL 给智能体 / 脚本用的高层封装。不是 DOM 标准，但好用。 */
  const page = {
    title: () => c('title'),
    url: () => c('url'),
    ready: () => c('readyState'),
    q: (sel) => document.querySelector(sel),
    all: (sel, n) => c('all', sel, n || 300, true),
    text: (sel) => { const el = document.querySelector(sel); return el ? el.textContent : null; },
    html: (sel) => { const el = document.querySelector(sel); return el ? el.innerHTML : null; },
    attr: (sel, n) => { const el = document.querySelector(sel); return el ? el.getAttribute(n) : null; },
    rect: (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; },
    css: (sel, props) => c('computed', sel, props),
    exists: (sel) => !!document.querySelector(sel),
    click: (sel) => { const el = document.querySelector(sel); if (el) el.click(); },
    setText: (sel, v) => { const el = document.querySelector(sel); if (el) el.textContent = v; },
    setValue: (sel, v) => { const el = document.querySelector(sel); if (el) el.value = v; },
    setAttr: (sel, n, v) => { const el = document.querySelector(sel); if (el) el.setAttribute(n, v); },
    el: (sel) => document.querySelector(sel),
    toast: (t) => c('toast', t),
    ask: (title, body) => c('dialog', title, body),
    wins: () => c('wins'),
    win: (opts) => c('openWindow', opts),
    shot: (sel, opts) => call_('shot.page', sel || null, opts || {}),
    show: (title, html, opts) => c('openWindow', Object.assign({ type:'browser', title, html }, opts || {})),
    snap: () => DOMC.root,
    sync: () => prefetchDom('document.body.innerText'),
    /* 100% 原生同步：在主线程跑。这是「想和 F12 完全一样」时的唯一确切答案。 */
    async eval(code) {
      const r = await c('evalPage', String(code));
      if (r && r.__error) { const e = new Error(r.message); e.name = r.name || 'Error'; throw e; }
      return r ? r.value : undefined;
    }
  };

  /* getComputedStyle：读快照里的 computed，未命中就触发一次刷新。 */
  const getComputedStyle = (el) => {
    const ref = refOf(el);
    const d = ref ? DOMC.nodes.get(ref) : null;
    const cs = Object.assign({}, (d && d.computed) || {});
    return new Proxy({}, {
      get(t, p) {
        if (typeof p === 'symbol') return undefined;
        if (p === 'getPropertyValue') return (n) => cs[String(n)] || '';
        if (p === 'getPropertyPriority') return () => '';
        if (p === 'item') return (i) => Object.keys(cs)[i] || '';
        if (p === 'length') return Object.keys(cs).length;
        const key = camel2kebab(p);
        if (key in cs) return cs[key];
        if (ref) callDom('computedRefresh', ref);
        return '';
      }
    });
  };

  const matchMedia = (q) => {
    const query = String(q || '');
    const w = (DOMC.root && DOMC.root.w) || 1280;
    const h = (DOMC.root && DOMC.root.h) || 800;
    const dark = !!(DOMC.root && DOMC.root.dark);
    let m = true;
    const mx = query.match(/max-width:\s*(\d+)px/i); if (mx) m = m && w <= +mx[1];
    const mn = query.match(/min-width:\s*(\d+)px/i); if (mn) m = m && w >= +mn[1];
    const mxh = query.match(/max-height:\s*(\d+)px/i); if (mxh) m = m && h <= +mxh[1];
    const mnh = query.match(/min-height:\s*(\d+)px/i); if (mnh) m = m && h >= +mnh[1];
    if (/prefers-color-scheme:\s*dark/i.test(query)) m = m && dark;
    if (/prefers-color-scheme:\s*light/i.test(query)) m = m && !dark;
    if (/prefers-reduced-motion:\s*reduce/i.test(query)) m = false;
    return {
      media: query, matches: m, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      dispatchEvent() { return true; }
    };
  };

  let rafSeq = 0;
  const rafMap = new Map();
  const requestAnimationFrame = (fn) => {
    const id = ++rafSeq;
    const t = setTimeout(() => { rafMap.delete(id); try { if (typeof fn === 'function') fn(performance.now()); } catch (e) {} }, 16);
    rafMap.set(id, t);
    return id;
  };
  const cancelAnimationFrame = (id) => { const t = rafMap.get(id); if (t != null) { clearTimeout(t); rafMap.delete(id); } };

  const history = {
    get length() { return 1; },
    get state() { return null; },
    back() {}, forward() {}, go() {},
    pushState(state, title, url) { if (url) c('navReplace', String(url)).catch(() => {}); },
    replaceState(state, title, url) { if (url) c('navReplace', String(url)).catch(() => {}); }
  };

  const locationShim = {
    get href() { return (DOMC.root && DOMC.root.url) || ''; },
    set href(v) { c('nav', String(v)).catch(() => {}); },
    get origin() { try { return new URL(this.href).origin; } catch (e) { return ''; } },
    get protocol() { try { return new URL(this.href).protocol; } catch (e) { return ''; } },
    get host() { try { return new URL(this.href).host; } catch (e) { return ''; } },
    get hostname() { try { return new URL(this.href).hostname; } catch (e) { return ''; } },
    get port() { try { return new URL(this.href).port; } catch (e) { return ''; } },
    get pathname() { try { return new URL(this.href).pathname; } catch (e) { return ''; } },
    get search() { try { return new URL(this.href).search; } catch (e) { return ''; } },
    get hash() { try { return new URL(this.href).hash; } catch (e) { return ''; } },
    get searchParams() { try { return new URL(this.href).searchParams; } catch (e) { return new URLSearchParams(); } },
    assign(u) { c('nav', String(u)).catch(() => {}); },
    replace(u) { c('navReplace', String(u)).catch(() => {}); },
    reload() { c('reload').catch(() => {}); },
    toString() { return this.href; }
  };

  const windowShim = {
    document, localStorage, page,
    get location() { return locationShim; },
    get innerWidth() { return (DOMC.root && DOMC.root.w) || 0; },
    get innerHeight() { return (DOMC.root && DOMC.root.h) || 0; },
    get outerWidth() { return this.innerWidth; },
    get outerHeight() { return this.innerHeight; },
    get devicePixelRatio() { return (DOMC.root && DOMC.root.dpr) || 1; },
    get scrollX() { return (DOMC.root && DOMC.root.sx) || 0; },
    get scrollY() { return (DOMC.root && DOMC.root.sy) || 0; },
    get pageXOffset() { return this.scrollX; },
    get pageYOffset() { return this.scrollY; },
    scrollTo(x, y) { const n = typeof x === 'object' && x ? x : { left: x, top: y }; return nat('scrollTo', [{ left:n.left || 0, top:n.top || 0, behavior:(n.behavior || 'auto') }]); },
    scrollBy(dx, dy) { const n = typeof dx === 'object' && dx ? dx : { left: dx, top: dy }; return nat('scrollBy', [{ left:n.left || 0, top:n.top || 0, behavior:(n.behavior || 'auto') }]); },
    getComputedStyle, matchMedia,
    /* ---- 原生 API：一律转回主线程调真的，不在 Worker 里另造一个 ----
     *
     * 以前 alert 变成一条 toast、confirm 变成自绘对话框、open 变成内部窗口，
     * 那是「设计行为」，不是浏览器行为。现在全部走 native.* RPC，
     * 主线程直接执行 window.alert / window.confirm / window.prompt / window.open，
     * 连文案、按钮、焦点、拦截规则都由浏览器自己决定。
     *
     * 唯一的硬限制：Worker 里没有同步跨线程通道（要 SharedArrayBuffer，
     * 那需要 COOP/COEP，file:// 打开时必然没有）。所以 alert / print / close 这类
     * 「没有返回值」的调用语义完全一致；confirm / prompt 的返回值只能是 Promise，
     * 必须 await —— 这是物理限制，不是我们在替你设计。 */
    alert: (m) => { nat('alert', [m == null ? '' : String(m)]).catch(() => {}); },
    confirm: (m) => nat('confirm', [m == null ? '' : String(m)]),
    prompt: (m, d) => nat('prompt', [m == null ? '' : String(m), d == null ? '' : String(d)]),
    print: () => { nat('print', []).catch(() => {}); },
    open: (u, target, feat) => nat('open', [String(u == null ? '' : u), target == null ? '_blank' : String(target), feat == null ? '' : String(feat)]),
    close: () => { nat('close', []).catch(() => {}); },
    focus: () => { nat('focus', []).catch(() => {}); },
    blur: () => { nat('blur', []).catch(() => {}); },
    stop: () => { nat('stop', []).catch(() => {}); },
    addEventListener: (t, fn) => { if (typeof fn === 'function') addWorkerListener('\u0001win', String(t), fn); },
    removeEventListener: (t, fn) => removeWorkerListener(fn),
    dispatchEvent: () => true,
    history,
    get screen() { return { width: this.innerWidth, height: this.innerHeight, availWidth: this.innerWidth, availHeight: this.innerHeight, colorDepth: 24, pixelDepth: 24 }; },
    requestAnimationFrame, cancelAnimationFrame,
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    get performance() { return { now: () => performance.now() }; }
  };

  /* document.location 与 window.location 必须是同一个对象（浏览器里就是这样） */
  try { Object.defineProperty(document, 'location', { get: () => locationShim, configurable: true }); } catch (e) {}
  try { Object.defineProperty(document, 'defaultView', { get: () => globalThis, configurable: true }); } catch (e) {}
  try { Object.defineProperty(document, 'compatMode', { get: () => 'CSS1Compat', configurable: true }); } catch (e) {}

  return { page, document, localStorage, windowShim, locationShim };
}


/* ---------------------------------------------------------------- Shell 启动 */
async function bootShell(init) {
  const history = init.history || (await call('history.get').catch(() => [])) || [];
  historyCache = history;
  let cwd = init.cwd || '.home';

  /* 先把主线程的 DOM 接过来：之后 window / document / page / localStorage 都能用 */
  let DOMX = null;
  try {
    DOMX = installDomProxy(call);
    /* 全部用 getter 挂：innerWidth / location.href 这类值会随快照变化，
     * 一次性 value 拷贝会让它们永远停在启动那一刻。 */
    globalThis.window = globalThis;
    const KEYS = ['document','localStorage','page','location','history',
      'alert','confirm','prompt','print','open','close','focus','blur','stop',
      'getComputedStyle','matchMedia',
      'innerWidth','innerHeight','outerWidth','outerHeight','devicePixelRatio',
      'scrollX','scrollY','pageXOffset','pageYOffset','scrollTo','scrollBy','screen',
      'requestAnimationFrame','cancelAnimationFrame',
      'addEventListener','removeEventListener','dispatchEvent'];
    for (const k of KEYS) {
      try { Object.defineProperty(globalThis, k, { get: () => DOMX.windowShim[k], configurable: true }); } catch (e) {}
    }
    /* 在 F12 里 top/parent/frames 都等于 window（非 iframe 页面） */
    for (const k of ['top', 'parent', 'frames']) {
      try { Object.defineProperty(globalThis, k, { get: () => globalThis, configurable: true }); } catch (e) {}
    }
    /* navigator 不覆盖：WorkerNavigator 的 userAgent / language / hardwareConcurrency
     * 本来就是真的，之前那份假对象是错的。 */
    prefetchDom('document.body.innerText');
  } catch (e) {
    globalThis.window = globalThis;
    globalThis.page = null;
  }
  globalThis.console = {
    log: (...a) => out(fmtArgs(a) + '\r\n'),
    info: (...a) => out(ANSI.blue + fmtArgs(a) + ANSI.reset + '\r\n'),
    warn: (...a) => out(ANSI.yellow + fmtArgs(a) + ANSI.reset + '\r\n'),
    error: (...a) => out(ANSI.red + fmtArgs(a) + ANSI.reset + '\r\n'),
    debug: (...a) => out(ANSI.gray + fmtArgs(a) + ANSI.reset + '\r\n'),
    dir: (o) => out(inspect(o, 1) + '\r\n'),
    table: (o) => out(inspect(o, 1) + '\r\n'),
    clear: () => out('\x1b[2J\x1b[H'),
    trace: (...a) => out(ANSI.gray + fmtArgs(a) + '\r\n' + new Error().stack + ANSI.reset + '\r\n'),
    time: () => {}, timeEnd: () => {}, assert: () => {}
  };
  /* print 不是「往终端打印」的别名：浏览器里 window.print() 是打印对话框。
   * 以前这里把它改成了终端输出，属于抢注。要往终端输出请用 console.log。 */
  globalThis.exit = (code) => { post({ t:'exit', code:code || 0 }); throw EXIT; };

  let ctx;
  const api = makeShell({ cwd, history, cols:init.cols, rows:init.rows });
  ctx = { editor:null };
  /* 逐个赋值，不要 Object.assign：Worker 的 open/location 是只读访问器，
   * 一次 assign 撞上就整个失败（表现为 shell 起不来）。 */
  for (const k of Object.keys(api)) {
    try { globalThis[k] = api[k]; }
    catch (e) { try { Object.defineProperty(globalThis, k, { value: api[k], writable:true, configurable:true }); } catch (e2) {} }
  }
  /* history 既是 JSHeL 的命令历史函数，也要能当 History 对象用 */
  try {
    const h0 = api.history;
    h0.length = 1; h0.state = null;
    h0.back = () => {}; h0.forward = () => {}; h0.go = () => {};
    h0.pushState = (st, ti, u) => { if (u) call('dom.op', 'navReplace', [String(u)]).catch(() => {}); };
    h0.replaceState = h0.pushState;
    globalThis.history = h0;
  } catch (e) {}

  /* 三种模式并列，看提示符就知道自己在哪一层：
   *   `JSHeL> `          JSHeL（纯 JS 求值；固定提示符，不显示当前目录）
   *   `/home/user $ `    hsb1（只当 shell 命令行）
   *   `agent> `          智能体 TUI（整行发给智能体）
   */
  const AGENT_PROMPT = ANSI.cyan + 'agent' + ANSI.reset + '> ';

  /* 把内部「点分路径」渲染成 ext4 风格的真实路径，专给 hsb1 提示符用：
   *   .            /              .home           /home/user
   *   .home.notes  /home/user/notes              .bin            /bin
   * 这样 hsb1 的提示符看起来就像真 Linux（/home/user $），而不是 .home $ 这种让人犯晕的形式。 */
  function dispPath(p) {
    if (!p || p === '.') return '/';
    if (p === '.home') return '/home/user';
    if (p.startsWith('.home.')) return '/home/user/' + p.slice('.home.'.length).replace(/\./g, '/');
    return '/' + p.replace(/^\./, '').replace(/\./g, '/');
  }

  const editor = new LineEditor({
    prompt: () => {
      if (api.__state.mode === 'agent') return AGENT_PROMPT;
      if (api.__state.mode === 'hsb1') return dispPath(api.__state.cwd) + ' $ ';
      /* JSHeL 固定提示符：不显示当前目录，力求和真的 JS 控制台一致。 */
      return 'JSHeL> ';
    },
    /* 折行要用真实的列数/行数，不能写死 80×24 */
    cols: () => api.__state.cols,
    rows: () => api.__state.rows,
    history,
    onHistory: saveHistory,
    onTab: (before) => api.__complete(before),
    /* Ctrl+C 在 agent 模式里= 中断当前这一轮（智能体那边的 stop），
     * 而不是打一行「同步执行无法中断」。 */
    onInterrupt: () => {
      if (api.__state.mode !== 'agent') return false;
      agentTui.stop();
      return true;
    },
    /* Ctrl+D 在 agent 模式里= 退出 agent，回到原来那一层，不关终端 */
    onCtrlD: () => {
      if (api.__state.mode !== 'agent') return false;
      agentTui.close();
      out('\r\n');
      editor.reopen();
      return true;
    },
    onSubmit: async (line) => {
      if (!line.trim()) return;
      /* 三条完全分开的路，中间没有「猜一下这行是什么」：
       *   agent → 整行发给智能体（不认 JS，也不认 shell）
       *   hsb1  → 只当 shell 命令行（`1+1` 是「命令未找到」）
       *   jshel → 只当 JS 求值（`ls -la` 就是语法错误，不会被执行）
       * 以前是「首词命中命令表就当 shell」，于是同一行代码的行为取决于命令表里有没有同名命令，
       * 完全不可预测。分家之后，看提示符就知道自己在哪一层。 */
      if (api.__state.mode === 'agent') {
        await agentTui.line(line);
        return;
      }
      if (api.__state.mode === 'hsb1') {
        const r = await COMPAT.execLine(line);
        if (r && r.exit) throw EXIT;
        return;
      }
      await api.run(line);
    },
    onEOF: () => { post({ t:'exit', code:0 }); },
  });
  /* ---------------------------------------------------------------- hsb1（Linux 风格 shell）
   * 把命令执行需要的上下文交给 COMPAT：fs 走 RPC、cwd 走 state、输出走 out。
   * 只有 mode === 'hsb1' 时整行才交给它；JSHeL 那一侧一行 shell 语法都不认。
   * 提示符会变成 `路径 $ `，一层一层可嵌套。
   */

  /* ---------------------------------------------------------------- TUI 智能体
   * 在终端里用智能体：不占窗口，直接打字。
   *
   * 关键点：**open() 是真的切模式**，不是打印个横幅就完事。
   * 以前只打横幅、mode 还是 jshel，于是下一行立刻回到 `.home>`——
   * 用户看到的就是「进去一下就自己退出来」。现在 mode 变成 'agent'，
   * 提示符变 `agent> `，后面每一行都发给智能体，直到 :q / Ctrl+D。
   *
   *   agentTui.open()    进入交互模式
   *   agent('…')         问一句（不带参数 = 进模式）
   *   agentTui.stop()    中断当前轮，并清空队列
   *   agentTui.close()   退出，回到进来之前那一层
   */
  const AGENT_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  /* 折行宽度统一走 charWidth：以前这里另写了一份「哪些区段算 2 列」，
   * 和行编辑器那份的边界值不一样（少了 0x2329/0x232a），同一段文字在
   * 「打字时」和「回答时」折在不同位置。一套规则就够了。 */
  function agentWidth(s) { return strWidth(s); }

  function agentWrap(text, indent, width) {
    const pad = ' '.repeat(indent || 0);
    const max = Math.max(20, (width || 80) - (indent || 0));
    const outLines = [];
    for (const raw of String(text == null ? '' : text).replace(/\r/g, '').split('\n')) {
      if (!raw) { outLines.push(''); continue; }
      let cur = '', w = 0;
      for (const ch of raw) {
        const cw = agentWidth(ch);
        if (w + cw > max) { outLines.push(pad + cur); cur = ''; w = 0; }
        cur += ch; w += cw;
      }
      outLines.push(pad + cur);
    }
    return outLines.join('\r\n');
  }

  const agentTui = {
    on: false,
    _back: 'jshel',
    _q: [],
    _busy: false,
    _spin: null,
    _t0: 0,

    open() {
      if (this.on) {
        out(ANSI.gray + '（已经在 agent 里了；:q 退出，:stop 中断）' + ANSI.reset + '\r\n');
        return undefined;
      }
      this.on = true;
      /* 记住从哪一层进来的：hsb1 里进来就回 hsb1，否则回 JSHeL。
       * 只记一个值而不是布尔——布尔表达不了「原来在第几层」。 */
      this._back = api.__state.mode === 'hsb1' ? 'hsb1' : 'jshel';
      api.__state.mode = 'agent';
      editor.promptStr = AGENT_PROMPT;

      const w = Math.max(24, Math.min(72, (api.__state.cols || 80) - 2));
      const rule = '─'.repeat(Math.max(4, w - 9));
      out('\r\n' + ANSI.cyan + '── HarTMLes ' + rule + ANSI.reset + '\r\n');
      out(ANSI.gray + agentWrap('直接输入任务，Enter 发送。:q 退出 · :stop 中断 · :help 命令 · Ctrl+C 中断当前轮 · Ctrl+D 退出', 2, api.__state.cols) + ANSI.reset + '\r\n');
      out(ANSI.cyan + '─'.repeat(w) + ANSI.reset + '\r\n');
      /* 接上历史，并明说接上了——否则刷新后一片空白，用户会以为对话丢了 */
      call('agent.status').then(st => {
        if (st && st.messages) out(ANSI.gray + agentWrap('已接上历史会话：' + st.messages + ' 条消息', 2, api.__state.cols) + ANSI.reset + '\r\n');
      }).catch(() => {});
      /* 不返回值：JSHeL 会把表达式的值打印出来，返回 'agent' 会在横幅下面
       * 多出一个孤零零的 "agent"，看着像报错。 */
      return undefined;
    },

    /* 一行的入口：先认本地命令，再交给模型。本地命令用 : 开头，
     * 不和正常说话抢词（"exit" / "quit" 也认，那是终端里的肌肉记忆）。 */
    async line(text) {
      const s = String(text == null ? '' : text).trim();
      if (!s) return '';
      if (/^(:q|:quit|:exit|\/q|\/quit|\/exit|exit|quit)$/i.test(s)) { this.close(); return ''; }
      if (/^(:help|\/help)$/i.test(s)) { this.helpOut(); return ''; }
      if (/^(:stop|\/stop)$/i.test(s)) { await this.stop(); return ''; }
      if (/^(:clear|\/clear)$/i.test(s)) { out('\x1b[2J\x1b[H'); return ''; }
      if (/^(:new|\/new)$/i.test(s)) {
        try { await call('agent.reset'); out(ANSI.gray + '已新建会话（旧会话仍在 IndexedDB 里）' + ANSI.reset + '\r\n'); }
        catch (e) { out(ANSI.red + '! ' + (e && e.message || e) + ANSI.reset + '\r\n'); }
        return '';
      }
      return await this._run(s);
    },

    helpOut() {
      const rows = [
        ['直接打字', 'Enter 发送，整行交给智能体'],
        [':stop', '中断当前这一轮'],
        [':new', '清空上下文，开一段新会话'],
        [':clear', '清屏（不删历史）'],
        [':q', '退出 agent，回到进来之前那一层'],
        ['Ctrl+C', '中断当前轮（等同于 :stop）'],
        ['Ctrl+D', '退出（等同于 :q）'],
        ['↑ / ↓', '翻命令历史']
      ];
      out('\r\n' + ANSI.cyan + 'agent 里的命令' + ANSI.reset + '\r\n');
      for (const [k, v] of rows) {
        out('  ' + ANSI.yellow + k.padEnd(10) + ANSI.reset + ANSI.gray + v + ANSI.reset + '\r\n');
      }
      out('\r\n');
    },

    _startSpin() {
      this._stopSpin();
      this._t0 = Date.now();
      let i = 0;
      out(ANSI.gray + '  ' + AGENT_FRAMES[0] + ' 思考中…' + ANSI.reset);
      this._spin = setInterval(() => {
        i = (i + 1) % AGENT_FRAMES.length;
        const sec = ((Date.now() - this._t0) / 1000).toFixed(0);
        out('\r\x1b[K' + ANSI.gray + '  ' + AGENT_FRAMES[i] + ' 思考中… ' + sec + 's' + ANSI.reset);
      }, 110);
    },
    _stopSpin() {
      if (!this._spin) return;
      clearInterval(this._spin);
      this._spin = null;
      out('\r\x1b[K');
    },

    async _run(text) {
      const t = String(text == null ? '' : text).trim();
      if (!t) return '';
      /* 用户那一行是行编辑器回显的，这里不再重复打印，直接出结果 */
      this._busy = true;
      this._startSpin();
      let r;
      try {
        r = await call('agent.turn', t);
      } catch (e) {
        this._stopSpin();
        this._busy = false;
        out(ANSI.red + '! ' + (e && e.message || e) + ANSI.reset + '\r\n');
        return '';
      }
      this._stopSpin();
      this._busy = false;

      const msgs = (r && r.messages) || [];
      let tools = 0, printed = 0;
      for (const m of msgs) {
        if (m.role === 'assistant' && m.content) {
          out(agentWrap(m.content, 2, api.__state.cols) + '\r\n');
          printed++;
        } else if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
          printed++;
          for (const tc of m.tool_calls) {
            const name = (tc.function && tc.function.name) || tc.name || 'tool';
            const args = String((tc.function && tc.function.arguments) || tc.args || '').replace(/\s+/g, ' ');
            out(ANSI.gray + agentWrap('→ ' + name + ' ' + args.slice(0, 120), 2, api.__state.cols) + ANSI.reset + '\r\n');
          }
        } else if (m.role === 'tool') {
          tools++; printed++;
          const body = String(m.content || '').replace(/\r?\n/g, ' ⏎ ').slice(0, 180);
          out(ANSI.gray + agentWrap('← ' + (m.name || 'tool') + ': ' + body, 2, api.__state.cols) + ANSI.reset + '\r\n');
        } else if (m.role === 'system') {
          /* 重复防护的警告备注：只给用户看，不进模型请求 */
          printed++;
          out(ANSI.yellow + agentWrap('⚠ ' + String(m.content || ''), 2, api.__state.cols) + ANSI.reset + '\r\n');
        } else if (m.role === 'error') {
          printed++;
          out(ANSI.red + agentWrap('! ' + String(m.content || ''), 2, api.__state.cols) + ANSI.reset + '\r\n');
        }
      }
      if (!printed) out(ANSI.gray + '  （没有输出）' + ANSI.reset + '\r\n');

      const sec = ((Date.now() - this._t0) / 1000).toFixed(1);
      out(ANSI.gray + '  ─ ' + sec + 's' + (tools ? ' · ' + tools + ' 次工具调用' : '') + ANSI.reset + '\r\n\r\n');
      return (r && r.text) || '';
    },

    async send(text) {
      /* 不带参数 = 进交互模式；带参数 = 就问这一句，不改变模式 */
      if (text == null || String(text).trim() === '') return this.open();
      if (this._busy) return await this.queue(text);
      return await this._run(text);
    },
    queue(text) {
      return new Promise((resolve) => {
        this._q.push({ text: String(text == null ? '' : text), resolve });
        this._drain();
      });
    },
    async _drain() {
      if (this._busy) return;
      while (this._q.length) {
        const item = this._q.shift();
        try { item.resolve(await this._run(item.text)); }
        catch (e) { item.resolve(''); }
      }
    },
    async stop() {
      this._q.splice(0).forEach(i => i.resolve && i.resolve(''));
      try { await call('agent.stop'); } catch (e) {}
      out(ANSI.yellow + '■ 已请求停止当前轮' + ANSI.reset + '\r\n');
      return true;
    },
    status() { return call('agent.status'); },
    close() {
      if (!this.on) { out(ANSI.gray + 'agent 没有在运行' + ANSI.reset + '\r\n'); return false; }
      this.on = false;
      this._q.splice(0).forEach(i => i.resolve && i.resolve(''));
      this._stopSpin();
      this._busy = false;
      /* 回原来那一层：hsb1 进的就回 hsb1，否则回 JSHeL。
       * 提示符由 promptText() 重算，调用方（submit 的 finally / onCtrlD）负责补上。 */
      api.__state.mode = this._back === 'hsb1' ? 'hsb1' : 'jshel';
      editor.promptStr = editor.promptText();
      out(ANSI.gray + '已退出 agent（对话在 IndexedDB ht-agent，窗口版看到的是同一段）' + ANSI.reset + '\r\n');
      return true;
    }
  };
  globalThis.agentTui = agentTui;
  globalThis.agent = (text) => agentTui.send(text);

  /* ---------------------------------------------------------------- 嵌套 shell
   * 「JSHeL 打开它自己」：新开一个终端窗口，cwd 默认继承当前目录。
   */
  const shell = {
    open(cwd) { return call('shell.open', cwd || api.__state.cwd, true); },
    here() { return api.__state.cwd; },
    cd: (p) => api.cd(p),
    exec: (code) => api.run(code),
    term: api
  };
  globalThis.shell = shell;
  globalThis.jshel = shell.open;

  /* hsb1 —— JSHeL 里唯一通往 Linux 风格命令的入口（原名 hsl、hsl1，现统一为 hsb1；老名字不再支持）。
   *
   *   hsb1()            进交互层（可嵌套；exit 弹回上一层，最外层回到 JSHeL）
   *   hsb1('ls -la')    跑一行，输出直接进终端
   *   await hsb1.run(x) 跑一行但不打印，返回 { code, out, err }
   *
   * 这样 JSHeL 这一侧永远是纯 JS：不会因为你敲了 `ls -la` 就被悄悄当成 shell。
   * 注意：必须写 hsb1()；裸敲 hsb1 只会被当成普通 JS 标识符求值。 */
  function hsb1(cmd) {
    if (cmd === undefined || cmd === null) {
      /* 只打印横幅，不返回值：hsb1() 不该在下面多出一个 "1" */
      const d = COMPAT.hsbPush();
      out(ANSI.gray + 'hsb1 · 第 ' + d + ' 层 · help 看命令，exit 退出这一层' + ANSI.reset + '\r\n');
      return undefined;
    }
    return COMPAT.execLine(String(cmd)).then(() => undefined);
  }
  hsb1.run = (cmd) => COMPAT.execLine(String(cmd));
  globalThis.hsb1 = hsb1;

  /* hsb2 —— WASM + v86 + FreeBSD 12.0 的真实入口（可选组件，用户已明确要求实现）。
   * 这里只发一条 RPC 让主线程开窗口：v86 需要 DOM / WASM，Worker 里跑不了。
   * 关键：不敲 hsb2() 就永远不会执行到这里，页面也就永远不会去碰那些 CDN 资源。 */
  globalThis.hsb2 = (opts) => {
    out(ANSI.yellow + '⚠ hsb2 · 可选组件：WASM + v86 + FreeBSD 12.0' + ANSI.reset + '\r\n');
    out(ANSI.gray + COMPAT.hsb2Notice() + ANSI.reset + '\r\n');
    out(ANSI.gray + '正在打开 hsb2 窗口 …（从现在起才经 CDN 下载组件，并缓存到 IndexedDB）' + ANSI.reset + '\r\n');
    call('hsb2.open', opts || {}).catch(e =>
      out(ANSI.red + 'hsb2 启动失败：' + String(e && e.message || e) + ANSI.reset + '\r\n'));
    return undefined;
  };
  hsb2.stop = () => call('hsb2.stop');
  hsb2.clear = () => call('hsb2.clear');
  hsb2.status = () => call('hsb2.status');

  COMPAT.attach({
    out: (t) => out(t),
    call,
    state: api.__state,
    api,
    editor,
    version: HT_VERSION,
    getCwd: () => api.__state.cwd,
    setCwd: (p) => { api.__state.cwd = p; post({ t:'cwd', path:p }); },
    get cols() { return api.__state.cols || 80; },
    get rows() { return api.__state.rows || 24; },
    /* 模式切换只改 state.mode + 重画提示符。真实的「第几层」在 COMPAT 的栈里，
     * 这里不存第二份状态——两份状态一定会不同步。 */
    setMode: (m) => { api.__state.mode = m; },
    /* 切层之后由 COMPAT 调：不打印、只重画，避免和调用方的换行重复。
     * 这里**不要**手动把 _rows 清零——reopen() 靠它判断屏上还有没有旧块，
     * 清了就擦不掉，于是 hsb1 进出层时会出现两个提示符并排。 */
    kick: () => { editor.reopen(); },
    get onEditorResize() { return editor._onResize || null; },
    set onEditorResize(fn) { editor._onResize = fn || null; }
  });

  out('\x1b[?2004h');

  // 启动横幅必须在提示符之前
  if (init.banner !== false) {
    out(ANSI.gray + 'HTerMinaL · JSHeL · ' + new Date().toLocaleString('zh-CN') + ANSI.reset + '\r\n');
    out(ANSI.gray + '输入 help() 查看命令；一切皆文件。Linux 命令请先 hsb1()；真实 FreeBSD 用 hsb2()（可选，按需下载）。' + ANSI.reset + '\r\n\r\n');
  }
  editor.start();

  self.__shell = { api, editor, state:api.__state };
  if (init.code) {
    editor.enqueueText(init.code);
  }
  // 自动加载包（后台）
  autoLoadPackages();
  post({ t:'ready' });
}

/* ---------------------------------------------------------------- Python(Pyodide) REPL */
const PYODIDE_VERSION = '0.26.4';
const PYODIDE_CDNS = [
  'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/',
  'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/',
  'https://unpkg.com/pyodide@' + PYODIDE_VERSION + '/'
];

async function bootPython(init) {
  const history = init.history || [];
  let py = null, ps1 = '>>> ', ps2 = '... ';
  let more = false;
  let ready = false;

  out(ANSI.gray + 'Python (Pyodide ' + PYODIDE_VERSION + ') 正在加载，首次约 10 MB……' + ANSI.reset + '\r\n');

  let lastErr = null;
  for (const base of PYODIDE_CDNS) {
    try {
      importScripts(base + 'pyodide.js');
      py = await loadPyodide({ indexURL: base });
      break;
    } catch (e) { lastErr = e; }
  }
  if (!py) {
    writeErr('Python 运行时加载失败：' + (lastErr && lastErr.message || lastErr) + '\r\n');
    out(ANSI.yellow + '请检查网络 / CDN 是否可达，或按 Ctrl+D 返回 shell。' + ANSI.reset + '\r\n');
    post({ t:'ready' });
    return;
  }

  const nl = (s) => {
    s = String(s);
    if (!/\n$/.test(s)) s += '\n';
    return s.replace(/\r?\n/g, '\r\n');
  };
  py.setStdout({ batched: (s) => out(nl(s)) });
  py.setStderr({ batched: (s) => out(ANSI.red + nl(s) + ANSI.reset) });

  await py.runPythonAsync(`
import sys, code, builtins
_ht_console = code.InteractiveConsole(locals=globals())
def _ht_push(line):
    return _ht_console.push(line)
def _ht_input(*a, **k):
    raise RuntimeError("input() 在当前 Python 环境中不可用：请改用 askFile()/askLine() 或预置变量")
builtins.input = _ht_input
`);

  const version = py.runPython('sys.version.split()[0]');
  out(ANSI.green + 'Python ' + version + ' on Pyodide' + ANSI.reset + '\r\n');
  out(ANSI.gray + '输入 exit() 或 Ctrl+D 返回 shell。' + ANSI.reset + '\r\n');
  /* 说清楚一件事：Pyodide 跑在同一个 Worker 里，没有 SharedArrayBuffer 就没有中断通道，
   * `while True: pass` 会把整个终端卡死（Ctrl+C 也救不回来，只能刷新页面）。
   * 与其让用户以为按键坏了，不如先把代价写在脸上。 */
  out(ANSI.gray + '注意：同步死循环无法中断（Ctrl+C 也不行），卡住了只能刷新页面。' + ANSI.reset + '\r\n\r\n');
  ready = true;
  post({ t:'ready' });

  const push = (line) => {
    try {
      const r = py.globals.get('_ht_push')(line);
      more = !!r;
      return more;
    } catch (e) {
      out(ANSI.red + String(e.message || e) + ANSI.reset + '\r\n');
      more = false;
      return false;
    }
  };

  const editor = new LineEditor({
    prompt: () => more ? ps2 : ps1,
    history,
    onHistory: saveHistory,
    cols: () => Number(init.cols) || 80,
    rows: () => Number(init.rows) || 24,
    onSubmit: async (line) => {
      if (!ready) return;
      if (!more && /^\s*(exit|quit)\s*\(\s*\)\s*$/.test(line)) {
        throw EXIT;
      }
      push(line);
    },
    onEOF: () => post({ t:'exit', code:0 }),
  });
  editor.start();
  self.__py = { editor, py };
}

/* ---------------------------------------------------------------- RPC 返回与主循环 */
self.onmessage = async (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (m.t === 'rpc-result') {
    const p = rpcPending.get(m.id);
    if (!p) return;
    rpcPending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else {
      const err = new Error(m.error && m.error.message || 'rpc failed');
      if (m.error && m.error.stack) err.stack = m.error.stack;
      err.rpc = true;
      p.reject(err);
    }
    return;
  }
  if (m.t === 'init') {
    try {
      HT_VERSION = m.version || HT_VERSION;
      /* 渲染层的宽度表：先于任何折行/提示符绘制生效 */
      if (m.wc && m.wc.w2 && m.wc.w0) { WC2 = m.wc.w2; WC0 = m.wc.w0; }
      if (m.role === 'python') await bootPython(m);
      else await bootShell(m);
    } catch (e) {
      writeErr('启动失败：' + (e && e.stack || e) + '\r\n');
      post({ t:'exit', code:1 });
    }
    return;
  }
  if (m.t === 'dom-event') {
    /* 主线程把捕获到的真实事件回放到 Worker：页面上 addEventListener('click')
     * 的回调就是在这里被调用的。注意它是**异步**的——跨线程的代价，
     * preventDefault() 改不了已经发生的事。 */
    try { dispatchWorkerEvent(m); } catch (e) {}
    return;
  }
  if (m.t === 'in') {
    const ed = self.__shell && self.__shell.editor || self.__py && self.__py.editor;
    if (ed) ed.feed(m.data);
    return;
  }
  if (m.t === 'resize') {
    if (self.__shell) {
      self.__shell.state.cols = m.cols || self.__shell.state.cols;
      self.__shell.state.rows = m.rows || self.__shell.state.rows;
    }
    const ed = self.__shell && self.__shell.editor || self.__py && self.__py.editor;
    /* TUI（vim/nano）正在前台时不能重绘提示符，否则会把全屏画面擦掉；
     * 但全屏应用自己需要重画（否则终端一改尺寸，画面就被拉歪）。 */
    if (ed && ed.raw) { if (ed._onResize) { try { ed._onResize(); } catch (e) {} } }
    else if (ed) {
      /* 尺寸一变，xterm 会把内容 reflow，旧块的坐标全失效。
       * 不能拿旧 _rows 去上移擦除——那样只会擦错行。
       * 但也不能什么都不清就重画：旧提示符还在这一行上，新的一画就变成
       * 「JSHeL> abcJSHeL> abc」。清掉光标所在这一行再重画，单行输入正好
       * 对齐；折行的输入最坏留一行残影，也好过两个提示符并排。
       * 正在等输出（agent 回答、命令执行）时屏上没有输入块，画出来只会插在
       * 输出中间——那时只归零坐标，等结束时的 reopen() 补提示符。 */
      ed._rows = 0; ed._curRow = 0;
      if (!ed.busy) {
        out('\r\x1b[2K');
        ed.promptStr = ed.promptText();
        ed.redraw();
      }
    }
    return;
  }
  if (m.t === 'terminate') {
    self.close();
    return;
  }
  if (m.t === 'eval' && self.__shell) {
    const id = m.id;
    try {
      const r = await self.__shell.api.run(m.code);
      post({ t:'eval-result', id, ok:!r.error, value:r.error ? undefined : r.value, error:r.error ? String(r.error.message || r.error) : undefined });
    } catch (e) {
      post({ t:'eval-result', id, ok:false, error:String(e && e.message || e) });
    }
  }
};
