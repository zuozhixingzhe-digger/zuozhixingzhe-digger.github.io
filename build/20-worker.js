/* ============================================================================
 * hterminal · worker runtime
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。此文件被内联进 index.html，作为 Blob Worker 运行。
 * 职责：JS shell 执行、行编辑、历史、补全、包加载、Python(Pyodide) REPL。
 * 一切文件/窗口/权限操作都通过 RPC 交给主线程的“环境”。
 * ==========================================================================*/
'use strict';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** 版本号由主线程的 init 消息注入（前端唯一来源是 30-core.js 的 HT_VERSION）。
 *  注意：这里必须是模块级变量——每个 shell 的 `state` 是闭包里的，模块级代码读不到。 */
let HT_VERSION = '0.0.0.0';

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

/** 终端显示宽度：CJK / 全角算 2，组合字符算 0。够用即可。 */
function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200b || (cp >= 0x0300 && cp <= 0x036f) || cp === 0xfeff) continue;
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)) w += 2;
    else w += 1;
  }
  return w;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function inspect(v, depth, seen) {
  depth = depth || 0; seen = seen || new Set();
  const t = typeof v;
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (t === 'string') return depth === 0 ? v : JSON.stringify(v);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
  if (t === 'symbol') return v.toString();
  if (t === 'function') {
    const src = Function.prototype.toString.call(v).replace(/\s+/g, ' ').trim();
    return ANSI.cyan + (src.length > 90 ? src.slice(0, 87) + '…' : src) + ANSI.reset;
  }
  if (v instanceof Error) return (v.stack || (v.name + ': ' + v.message));
  if (v instanceof Promise) return 'Promise { <pending> }';
  if (seen.has(v)) return ANSI.gray + '[Circular]' + ANSI.reset;
  if (depth > 4) return ANSI.gray + '…' + ANSI.reset;
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const items = v.slice(0, 60).map(x => inspect(x, depth + 1, seen));
      return '[ ' + items.join(', ') + (v.length > 60 ? ', … ' + (v.length - 60) + ' more' : '') + ' ]';
    }
    if (v instanceof Map) return 'Map(' + v.size + ') { ' + [...v].slice(0, 30).map(([k, x]) => inspect(k, depth + 1, seen) + ' => ' + inspect(x, depth + 1, seen)).join(', ') + ' }';
    if (v instanceof Set) return 'Set(' + v.size + ') { ' + [...v].slice(0, 30).map(x => inspect(x, depth + 1, seen)).join(', ') + ' }';
    if (v instanceof Date) return v.toISOString();
    if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + ')';
    if (ArrayBuffer.isView(v)) return v.constructor.name + '(' + v.length + ') [' + Array.from(v.slice(0, 20)).join(', ') + ']';
    if (typeof v === 'object' && v.constructor && v.constructor.name && v.constructor.name !== 'Object') {
      const keys = Object.keys(v);
      return v.constructor.name + ' { ' + keys.slice(0, 30).map(k => k + ': ' + inspect(v[k], depth + 1, seen)).join(', ') + (keys.length > 30 ? ', …' : '') + ' }';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{ ' + keys.slice(0, 50).map(k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + inspect(v[k], depth + 1, seen)).join(', ') + (keys.length > 50 ? ', …' : '') + ' }';
  } catch (e) { return ANSI.gray + '[uninspectable]' + ANSI.reset; }
  finally { seen.delete(v); }
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
  }
  promptText() { return typeof this.o.prompt === 'function' ? this.o.prompt() : (this.o.prompt || '> '); }
  start() {
    this.promptStr = this.promptText();
    out(this.promptStr);
  }
  setBusy(b) { this.busy = b; }
  redraw() {
    if (this.closed) return;
    const p = this.promptStr || this.promptText();
    out('\r\x1b[2K' + p + this.buf);
    const tail = strWidth(this.buf.slice(this.cur));
    if (tail > 0) out('\x1b[' + tail + 'D');
  }
  insert(text) {
    text = text.replace(/\r\n?/g, '\n');
    if (text.includes('\n')) {
      const merged = (this.buf + text).replace(/\n+$/, '');
      this.buf = ''; this.cur = 0;
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
    if (this.cur === this.buf.length) out(text);
    else this.redraw();
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
  move(d) {
    const next = Math.max(0, Math.min(this.buf.length, this.cur + d));
    if (next === this.cur) return;
    const a = this.buf.slice(Math.min(this.cur, next), Math.max(this.cur, next));
    const w = strWidth(a);
    if (w > 0) out('\x1b[' + w + (d > 0 ? 'C' : 'D'));
    this.cur = next;
  }
  home() { if (this.cur) { out('\x1b[' + strWidth(this.buf.slice(0, this.cur)) + 'D'); this.cur = 0; } }
  end() { if (this.cur < this.buf.length) { out('\x1b[' + strWidth(this.buf.slice(this.cur)) + 'C'); this.cur = this.buf.length; } }
  clearLine() { this.buf = ''; this.cur = 0; this.redraw(); }
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
    this.buf = ''; this.cur = 0; this.histIdx = this.history.length; this.draft = '';
    out('\r\n');
    if (line.trim()) {
      if (this.history[this.history.length - 1] !== line) {
        this.history.push(line);
        if (this.history.length > 500) this.history.shift();
        if (this.o.onHistory) { try { this.o.onHistory(this.history); } catch (e) {} }
      }
    }
    this.busy = true;
    try {
      await this.o.onSubmit(line);
    } catch (e) {
      if (e === EXIT) { this.closed = true; if (this.o.onEOF) this.o.onEOF(); return; }
      writeErr((e && (e.stack || e.message)) || String(e));
      out('\r\n');
    } finally {
      this.busy = false;
      if (!this.closed) { this.promptStr = this.promptText(); out(this.promptStr); }
    }
  }
  async submitText(text) {
    if (this.closed) return;
    out('\r\n');
    this.busy = true;
    try { await this.o.onSubmit(text); }
    catch (e) {
      if (e === EXIT) { this.closed = true; if (this.o.onEOF) this.o.onEOF(); return; }
      writeErr((e && (e.stack || e.message)) || String(e));
      out('\r\n');
    } finally {
      this.busy = false;
      if (!this.closed) { this.promptStr = this.promptText(); out(this.promptStr); }
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
  feed(data) {
    if (this.closed) return;
    if (this.busy) {
      if (data.includes('\x03')) { this.interrupted = true; out('^C\r\n'); writeErr('（同步执行无法中断；若是异步任务，请等待其检查 hterm.interrupted）\r\n'); }
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
      if (ch === '\x03') { i += 1; out('^C\r\n'); this.clearLine(); this.promptStr = this.promptText(); out(this.promptStr); continue; }
      if (ch === '\x04') { i += 1; if (!this.buf) { this.closed = true; out('\r\n'); if (this.o.onEOF) this.o.onEOF(); } else this.delete(); continue; }
      if (ch === '\x0c') { i += 1; out('\x1b[2J\x1b[H'); this.promptStr = this.promptText(); this.redraw(); continue; }
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
const AUTO_CALL = new Set(['help','ls','ll','pwd','clear','df','mount','ps','whoami','uname','date','env','history','exit','python','py']);

function makeShell(ctx) {
  const state = {
    cwd: ctx.cwd || '.home',
    user: ctx.user || 'human',
    started: Date.now(),
    running: true,
    history: ctx.history || [],
    last: undefined,
    lastError: null
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
    const s = 'hterminal ' + HT_VERSION + ' (browser; ' + (self.navigator && navigator.userAgent || 'worker') + ')';
    out(s + '\r\n');
  }
  async function date() { out(new Date().toString() + '\r\n'); }
  async function echo(...a) { out(a.join(' ') + '\r\n'); }
  async function env() {
    const o = { PWD:state.cwd, USER:state.user, SHELL:'jshel', TERM:'xterm-256color', LANG:'zh_CN.UTF-8', HOME:'.home', HOST:'browser' };
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
      ['', 'hterminal · JSHeL 快速参考'],
      ['文件', 'ls(p)  ll(p)  cd(p)  pwd()  cat(p)  write(p,data)  mkdir(p)  rm(p,{r})  mv  cp  stat  tree  find  grep  head  tail  df  mount'],
      ['执行', 'exec(p)  open(p)  run(code)  require("pkg")  python()  exit()'],
      ['窗口', 'winOpen({type,title,url,code})  spawn(code)  winList()  winClose(id)  agentOpen()'],
      ['系统', 'saveFile(name,body)  askFile()  fetchText(url)  openUrl(url)  notify(msg)  perm(name)  ps()  kill(pid)  clear()  history()'],
      ['真相', '一切皆文件。.home 是你的家，.bin 放函数，.app 是应用，.dev 是设备，.proc 是线程，.pkg 是包。'],
      ['提示', '表达式直接回车即可；多行用反斜杠续行；Ctrl+C 取消行；Ctrl+D 退出。'],
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
  function hoist(code) {
    return code.split('\n').map(line => {
      let m = line.match(/^(\s*)(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/);
      if (m && !/[,]/.test(m[4].replace(/[,({\[]/g, ''))) {
        return m[1] + 'globalThis.' + m[3] + ' = ' + m[4] + ';';
      }
      let f = line.match(/^(\s*)(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (f) return m2(f, line);
      return line;
    }).join('\n');
  }
  function m2(f, line) {
    return f[1] + 'globalThis.' + f[3] + ' = ' + (f[2] || '') + 'function ' + f[3] + '(' + line.slice(f[0].length);
  }

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
    const isDecl = /^\s*(?:const|let|var|function|async\s+function|class)\b/.test(code);
    try {
      // 声明优先走语句模式（并提升到全局，保证 REPL 里后续还能用）；
      // 其余先按表达式求值，失败再当语句块——这就是控制台“回显最后一个值”的语义。
      let done = false;
      if (!isDecl) {
        try {
          const f = new AsyncFunction('return (' + code + '\n)');
          value = await f.call(globalThis);
          done = true;
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
      if (!done) {
        const f = new AsyncFunction('"use strict";\n' + hoist(code));
        value = await f.call(globalThis);
      }
      // shell 习惯：裸命令名（help / ls / pwd ...）自动调用
      const bare = code.trim();
      if (typeof value === 'function' && /^[A-Za-z_$][\w$]*$/.test(bare) && AUTO_CALL.has(bare)) {
        value = await value();
      }
      state.last = value;
    } catch (e) {
      if (e === EXIT) throw e;
      error = e;
      state.lastError = e;
      const msg = e && e.message || String(e);
      writeErr((e && e.name ? e.name + ': ' : '') + msg + '\r\n');
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
        onEOF: () => finish(null), history: state.history, onHistory: saveHistory
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
    // 包
    install, uninstall, require:requirePkg, pkg:{ install, remove:uninstall, list:() => call('pkg.list'), require:requirePkg },
    // 窗口 / 系统
    python, py:python, spawn, winOpen, winClose, winList, agentOpen,
    saveFile, askFile, fetchText, openUrl, notify, perm, requestPermission:perm,
    whoami, uname, date, echo, env, ps, kill, clear, history:historyList, help, exit,
    sleep:(ms) => new Promise(r => setTimeout(r, ms)),
    uuid:() => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2)),
    // 内建对象
    console:con,
    fs:{ read:fsread, write:fswrite, list:fsls, remove:fsrm, mkdir:fsmkdir, stat:fsstat, move:fsmv, copy:fscp, resolve:norm },
    term:{ write:out, writeln:(s) => out(s + '\r\n'), clear, columns:() => ctx.cols, rows:() => ctx.rows },
    envVars:{},
    __state:state
  };
  api.__complete = complete;
  api.hterm = api;
  api.global = globalThis;
  return api;
}

/* ---------------------------------------------------------------- Shell 启动 */
async function bootShell(init) {
  const history = init.history || (await call('history.get').catch(() => [])) || [];
  historyCache = history;
  let cwd = init.cwd || '.home';

  // 注入 console
  globalThis.window = globalThis;
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
  globalThis.print = (...a) => out(fmtArgs(a) + '\r\n');
  globalThis.exit = (code) => { post({ t:'exit', code:code || 0 }); throw EXIT; };

  let ctx;
  const api = makeShell({ cwd, history, cols:init.cols, rows:init.rows });
  ctx = { editor:null };
  Object.assign(globalThis, api);

  const editor = new LineEditor({
    prompt: () => (init.prompt || '> '),
    history,
    onHistory: saveHistory,
    onTab: (before) => api.__complete(before),
    onSubmit: async (line) => {
      if (!line.trim()) return;
      try { await api.run(line); }
      catch (e) {
        if (e === EXIT) throw e;
        throw e;
      }
    },
    onEOF: () => { post({ t:'exit', code:0 }); },
  });
  out('\x1b[?2004h');

  // 启动横幅必须在提示符之前
  if (init.banner !== false) {
    out(ANSI.gray + 'hterminal · JSHeL · ' + new Date().toLocaleString('zh-CN') + ANSI.reset + '\r\n');
    out(ANSI.gray + '输入 help() 查看命令；一切皆文件。' + ANSI.reset + '\r\n\r\n');
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
  out(ANSI.gray + '输入 exit() 或 Ctrl+D 返回 shell。' + ANSI.reset + '\r\n\r\n');
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
      if (m.role === 'python') await bootPython(m);
      else await bootShell(m);
    } catch (e) {
      writeErr('启动失败：' + (e && e.stack || e) + '\r\n');
      post({ t:'exit', code:1 });
    }
    return;
  }
  if (m.t === 'in') {
    const ed = self.__shell && self.__shell.editor || self.__py && self.__py.editor;
    if (ed) ed.feed(m.data);
    return;
  }
  if (m.t === 'resize') {
    const ed = self.__shell && self.__shell.editor || self.__py && self.__py.editor;
    if (ed) { ed.promptStr = ed.promptText(); ed.redraw(); }
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
