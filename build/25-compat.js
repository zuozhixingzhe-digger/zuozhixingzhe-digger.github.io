/* ============================================================================
 * HTerMinaL · hsb1（迷你 shell + coreutils 子集 + vim/nano + fastfetch）
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这里没有任何 GPL/AGPL 代码：命令是按 POSIX 行为重新实现的，命名沿用
 * 通用命令名（ls / grep / sed…），实现与任何发行版的源码无关。
 * vim / nano 是「同名精简编辑器」，不是真的 vim/nano，不支持插件与 vimscript。
 *
 * 用法：JSHeL 里敲 `hsb1()` 进入（提示符变成 `/home/user $ `），`exit` 回到 JSHeL。
 * 也可以在 JSHeL 里敲 `await hsb1('ls -la')` 跑一行。原命令名 hsl / hsl1 已统一为 hsb1，老名字不再支持。
 *
 * JSHeL 本身**不认** shell 语法：`ls -la` 在 JSHeL 里就是语法错误，不会被执行。
 * 两套东西彻底分开，才不会出现「这一行到底是 JS 还是 shell」的猜测。
 *
 * hsb2 是可选组件：def('hsb2') 只在用户主动敲命令时才让主线程加载 WASM + FreeBSD。
 * 真身是 v86 0.5.473（BSD-2-Clause）+ FreeBSD 12.0，全部经 CDN 按需加载并缓存到
 * IndexedDB；本项目不分发任何相关源码 / 二进制，许可证原文见 licenses/。
 * ==========================================================================*/

const COMPAT = (function () {
  const C = {};
  let IO = null;          // { out, err, call, state, setCwd, getCwd, editor, rows, cols }
  let ENV = Object.create(null);
  let ALIAS = Object.create(null);
  let LAST = 0;

  const ESC = '\x1b';
  const R = ESC + '[0m';
  const DIM = ESC + '[2m';
  const CYAN = ESC + '[36m';
  const BLUE = ESC + '[34m';
  const GREEN = ESC + '[32m';
  const YELLOW = ESC + '[33m';
  const RED = ESC + '[31m';
  const MAGENTA = ESC + '[35m';

  /* ---------------------------------------------------------------- 词法 */
  /* 输出 token 流：{ t:'w', v } | { t:'op', v } | { t:'redir', op, fd } */
  function lex(src) {
    const t = [];
    let i = 0, cur = '', has = false;
    const push = () => { if (has) { t.push({ t:'w', v:cur }); cur = ''; has = false; } };
    while (i < src.length) {
      const c = src[i];
      if (c === "'" ) {
        has = true;
        const j = src.indexOf("'", i + 1);
        if (j < 0) { cur += src.slice(i + 1); i = src.length; break; }
        cur += src.slice(i + 1, j);
        i = j + 1;
        continue;
      }
      if (c === '"') {
        has = true;
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) { cur += src[i + 1]; i += 2; continue; }
          cur += src[i++];
        }
        i++;
        continue;
      }
      if (c === '\\' && i + 1 < src.length) { cur += src[i + 1]; has = true; i += 2; continue; }
      if (c === ' ' || c === '\t') { push(); i++; continue; }
      if (c === '|' || c === '&' || c === ';') {
        push();
        if (c === '|' && src[i + 1] === '|') { t.push({ t:'op', v:'||' }); i += 2; continue; }
        if (c === '&' && src[i + 1] === '&') { t.push({ t:'op', v:'&&' }); i += 2; continue; }
        if (c === '|') { t.push({ t:'op', v:'|' }); i++; continue; }
        if (c === ';') { t.push({ t:'op', v:';' }); i++; continue; }
        continue;
      }
      if (c === '>' || c === '<') {
        // 2> 之类的 fd 前缀
        let fd = 1;
        const m = cur.match(/^(\d)$/);
        if (m && !has) { fd = Number(m[1]); cur = ''; has = false; }
        else push();
        if (c === '>') {
          if (src[i + 1] === '>') { t.push({ t:'redir', op:'>>', fd }); i += 2; continue; }
          if (src[i + 1] === '&') { t.push({ t:'redir', op:'>&', fd }); i += 2; continue; }
          t.push({ t:'redir', op:'>', fd }); i++; continue;
        }
        t.push({ t:'redir', op:'<', fd:0 }); i++; continue;
      }
      cur += c; has = true; i++;
    }
    push();
    return t;
  }

  /* ---------------------------------------------------------------- 展开 */
  function getVar(name) {
    if (name === '?') return String(LAST);
    if (name === 'PWD') return IO.getCwd();
    if (name === 'HOME') return '.home';
    if (name === 'USER') return IO.state.user || 'human';
    if (name === 'SHELL') return 'hsb1';
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    return ENV[name] === undefined ? '' : ENV[name];
  }
  async function expandWord(w) {
    let s = w;
    // 命令替换 $(...)：递归跑一遍迷你 shell
    if (s.includes('$(')) {
      let guard = 0;
      while (s.includes('$(') && guard++ < 8) {
        const i = s.indexOf('$(');
        let depth = 1, j = i + 2;
        while (j < s.length && depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
        const inner = s.slice(i + 2, j - 1);
        const sub = await execLine(inner, { quiet:true });
        s = s.slice(0, i) + String(sub.out || '').replace(/\n/g, ' ').trim() + s.slice(j);
      }
    }
    // 变量
    s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*|\?)\}/g, (m, n) => getVar(n));
    s = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*|\?)/g, (m, n) => getVar(n));
    s = s.replace(/^~(?=$|\/)/, '.home');
    return s;
  }

  async function glob(pattern) {
    if (!/[*?]/.test(pattern)) return [pattern];
    const dir = pattern.includes('/') ? pattern.slice(0, pattern.lastIndexOf('/')) || '/' : '.';
    const base = pattern.includes('/') ? pattern.slice(pattern.lastIndexOf('/') + 1) : pattern;
    const dirPath = fmtPath(dir);
    let rows = [];
    try { rows = await IO.call('fs.list', dirPath); } catch (e) { return [pattern]; }
    const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    const hits = rows.filter(r => re.test(r.name)).map(r => (dir === '.' ? r.name : dir.replace(/\/$/, '') + '/' + r.name));
    return hits.length ? hits.sort() : [pattern];
  }

  function fmtPath(p) {
    if (!p) return '.';
    return String(p).replace(/\/+/g, '/').replace(/(^|\/)\.(\/|$)/g, '$1');
  }

  /* ---------------------------------------------------------------- 路径
   *
   * shell 里 `ls` 列的是**当前目录**，`cat notes` 读的是**当前目录下**的 notes。
   * 但 JSHeL 的路径方言是「点分绝对路径」（.home.readme 就是根下的 home.readme），
   * 两者直接混用会出现 `cd .home.app` 之后 `ls` 还在列根目录这种事。
   *
   * 所以这里显式分流：
   *   /  ~  @  开头        → 绝对（交给主线程 normPath）
   *   .home.xxx 这种点分    → 绝对
   *   其余（裸名、./x、../x）→ 相对当前目录，改写成 normPath 认识的 @/x
   */
  /* 把内部「点分路径」渲染成 ext4 风格的真实路径，专给 hsb1 的 pwd / 提示符用。
   * 与 20-worker.js 那份同名，但 COMPAT 是独立闭包，够不着那边，这里必须自带一份。 */
  function dispPath(p) {
    if (!p || p === '.') return '/';
    if (p === '.home') return '/home/user';
    if (p.startsWith('.home.')) return '/home/user/' + p.slice('.home.'.length).replace(/\./g, '/');
    return '/' + p.replace(/^\./, '').replace(/\./g, '/');
  }

  const ABS_DOT = /^\.[A-Za-z\u4e00-\u9fff_]/;
  async function realPath(p) {
    const s = String(p == null ? '' : p).trim();
    if (!s || s === '.') return IO.getCwd();
    if (s[0] === '/' || s[0] === '~' || s[0] === '@' || ABS_DOT.test(s)) return IO.call('fs.resolve', s);
    return IO.call('fs.resolve', '@/' + s.replace(/^\.\//, ''));
  }

  async function readText(p) {
    const r = await IO.call('fs.read', p);
    if (r.kind === 'dir') throw new Error(p + ': 是一个目录');
    if (typeof r.content === 'string') return r.content;
    return String(r.content == null ? '' : r.content);
  }

  async function listRows(p) {
    return IO.call('fs.list', p);
  }

  /* 命令的输入统一成字节：参数里第一个「看起来像文件且真的存在」的当文件名，
   * 否则把参数当文本；没有参数就用管道送进来的 stdin。
   * 这样 `b64 hello` 和 `b64 readme` 都符合直觉，也不用发明 -f 开关。 */
  async function inputBytes(args, stdin) {
    const rest = (args || []).filter(x => !/^-/.test(x));
    if (rest.length) {
      let p = null;
      try { p = await realPath(rest[0]); } catch (e) { p = null; }
      if (p) {
        let st = null;
        try { st = await IO.call('fs.stat', p); } catch (e) {}
        if (st && st.kind === 'file') {
          const r = await IO.call('fs.read', p);
          if (typeof r.content === 'string') return new TextEncoder().encode(r.content);
          if (r.content instanceof ArrayBuffer) return new Uint8Array(r.content);
          return new TextEncoder().encode(String(r.content == null ? '' : r.content));
        }
      }
      return new TextEncoder().encode(rest.join(' '));
    }
    return new TextEncoder().encode(String(stdin == null ? '' : stdin));
  }

  const codec = (op, data) => IO.call('util.codec', op, data);
  const dec = (bytes) => new TextDecoder().decode(bytes);

  /* ---------------------------------------------------------------- 命令 */
  const CMDS = Object.create(null);

  function def(name, fn, desc) { CMDS[name] = { fn, desc }; }

  const outStr = (s) => (s == null ? '' : String(s));

  def('echo', async (a) => {
    let nl = true, i = 0;
    if (a[0] === '-n') { nl = false; i = 1; }
    let s = a.slice(i).join(' ');
    if (/\\[nt\\"]/.test(s)) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return { out: s + (nl ? '\n' : '') };
  }, '输出参数');

  def('printf', async (a) => {
    const f = a[0] || '';
    const rest = a.slice(1);
    let k = 0;
    const s = f.replace(/%[sdi%]/g, (m) => {
      if (m === '%%') return '%';
      const v = rest[k++];
      if (m === '%d' || m === '%i') return String(parseInt(v, 10) || 0);
      return v == null ? '' : String(v);
    }).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return { out: s };
  }, '格式化输出');

  def('pwd', async () => {
    /* hsb1 里按 ext4 风格显示真实路径，与提示符一致；JSHeL 仍给内部点分路径。 */
    const p = IO.getCwd();
    return { out: (IO.state.mode === 'hsb1' ? dispPath(p) : p) + '\n' };
  }, '当前目录');

  def('cd', async (a) => {
    /* 不带参数回 HOME（和真 shell 一样）；带参数走 realPath，所以 `cd ..` `cd bin`
     * 都是相对当前目录，而不是相对根。 */
    const raw = a[0] === undefined ? '~' : a[0];
    const t = await realPath(raw);
    const s = await IO.call('fs.stat', t).catch(() => null);
    if (!s) return { code: 1, err: 'cd: 没有这个目录: ' + raw + '\n' };
    if (s.kind !== 'dir') return { code: 1, err: 'cd: 不是目录: ' + raw + '\n' };
    IO.setCwd(s.path);
    return {};
  }, '切换目录');

  /* ls -l 的排版。**故意不是 POSIX 的 `-rw-r--r--`**：
   * 这个文件系统没有 mode 位、没有属主、没有组，也不是 ext4。
   * 画一排 rwx 只会让用户以为 chmod/chown 有意义（我们没有这些命令）。
   * 所以这里印的是真实存在的信息：类型 + 字节数 + 修改时间 + 名字。 */
  function longFmt(rows) {
    const KIND = { dir:'dir', file:'file', func:'func', app:'app', device:'dev', package:'pkg', grant:'grant', proc:'proc', link:'link', object:'obj', blob:'blob' };
    const hdr = 'kind'.padEnd(6) + 'size'.padStart(8) + '  ' + 'mtime'.padEnd(11) + '  name';
    return DIM + hdr + R + '\n' + rows.map(r => {
      const k = (KIND[r.kind] || r.kind || '?').padEnd(6);
      const size = String(r.size || 0).padStart(8);
      const mt = new Date(r.mtime || Date.now()).toISOString().slice(5, 16).replace('T', ' ');
      const color = ({ dir:CYAN, func:YELLOW, app:MAGENTA, device:BLUE, package:GREEN })[r.kind] || '';
      return `${k}${size}  ${mt}  ${color}${r.name}${color ? R : ''}`;
    }).join('\n') + '\n';
  }

  def('ls', async (a) => {
    let long = false, all = false, one = false, dirs = [];
    for (const x of a) {
      if (/^-[a-zA-Z]+$/.test(x)) {
        if (x.includes('l')) long = true;
        if (x.includes('a')) all = true;
        if (x.includes('1')) one = true;
      } else dirs.push(x);
    }
    if (!dirs.length) dirs = ['.'];
    let res = '';
    for (const d of dirs) {
      const p = await realPath(d);
      let rows;
      try { rows = await listRows(p); } catch (e) { return { code: 1, err: 'ls: 无法访问 ' + d + ': 没有那个文件或目录\n' }; }
      if (!all) rows = rows.filter(r => !String(r.name).startsWith('.'));
      if (dirs.length > 1) res += (res ? '\n' : '') + d + ':\n';
      if (long) res += longFmt(rows);
      else if (one) res += rows.map(r => r.name).join('\n') + '\n';
      else {
        const cols = Math.max(20, (IO.cols || 80) - 2);
        const width = Math.max(...rows.map(r => String(r.name).length), 1) + 2;
        const per = Math.max(1, Math.floor(cols / width));
        let line = '';
        rows.forEach((r, i) => {
          const name = String(r.name) + (r.kind === 'dir' ? '/' : '');
          const color = ({ dir:CYAN, func:YELLOW, app:MAGENTA, device:BLUE, package:GREEN })[r.kind] || '';
          line += color + name.padEnd(width) + (color ? R : '');
          if ((i + 1) % per === 0) { res += line + '\n'; line = ''; }
        });
        if (line) res += line + '\n';
      }
    }
    return { out: res || '\n' };
  }, '列出目录');

  def('ll', async (a) => CMDS.ls.fn(['-la'].concat(a)), '详细列表');
  def('dir', async (a) => CMDS.ls.fn(a), '列出目录');

  def('cat', async (a, stdin) => {
    if (!a.length) return { out: stdin };
    let s = '';
    for (const f of a) {
      const p = await realPath(f);
      try { s += await readText(p); } catch (e) { return { code: 1, err: 'cat: ' + f + ': 没有那个文件或目录\n' }; }
    }
    return { out: s.endsWith('\n') ? s : s + '\n' };
  }, '输出文件内容');

  def('head', async (a, stdin) => {
    let n = 10, files = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-n') { n = parseInt(a[++i], 10) || 10; continue; }
      if (/^-\d+$/.test(a[i])) { n = parseInt(a[i].slice(1), 10); continue; }
      files.push(a[i]);
    }
    const s = files.length ? await readText(await realPath(files[0])) : stdin;
    return { out: s.split('\n').slice(0, n).join('\n') + '\n' };
  }, '前 N 行');

  def('tail', async (a, stdin) => {
    let n = 10, files = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-n') { n = parseInt(a[++i], 10) || 10; continue; }
      if (/^-\d+$/.test(a[i])) { n = parseInt(a[i].slice(1), 10); continue; }
      files.push(a[i]);
    }
    const s = files.length ? await readText(await realPath(files[0])) : stdin;
    const lines = s.replace(/\n$/, '').split('\n');
    return { out: lines.slice(Math.max(0, lines.length - n)).join('\n') + '\n' };
  }, '后 N 行');

  def('wc', async (a, stdin) => {
    let mode = 'lwc';
    const files = [];
    for (const x of a) { if (/^-[lwc]+$/.test(x)) mode = x.slice(1); else files.push(x); }
    const s = files.length ? await readText(await realPath(files[0])) : stdin;
    const lines = s ? s.replace(/\n$/, '').split('\n') : [];
    const parts = [];
    if (mode.includes('l')) parts.push(lines.length);
    if (mode.includes('w')) parts.push((s.match(/\S+/g) || []).length);
    if (mode.includes('c')) parts.push(s.length);
    return { out: parts.join(' ').padStart(8) + (files.length ? ' ' + files[0] : '') + '\n' };
  }, '统计行/词/字节');

  def('grep', async (a, stdin) => {
    let inv = false, ignore = false, num = false, fixed = false, pat = null;
    const files = [];
    for (const x of a) {
      if (/^-[a-zA-Z]+$/.test(x)) { if (x.includes('v')) inv = true; if (x.includes('i')) ignore = true; if (x.includes('n')) num = true; if (x.includes('F')) fixed = true; continue; }
      if (pat === null) pat = x; else files.push(x);
    }
    if (pat === null) return { code: 2, err: 'grep: 缺少模式\n' };
    const re = fixed ? null : new RegExp(pat, ignore ? 'i' : '');
    let text = stdin;
    if (files.length) {
      text = '';
      for (const f of files) text += await readText(await realPath(f)).catch(() => '');
    }
    const lines = text.replace(/\n$/, '').split('\n');
    const hits = [];
    lines.forEach((l, i) => {
      const ok = re ? re.test(l) : l.includes(pat);
      if (ok !== inv) hits.push((num ? String(i + 1).padStart(4) + ':' : '') + l);
    });
    return { code: hits.length ? 0 : 1, out: hits.length ? hits.join('\n') + '\n' : '' };
  }, '按模式筛选行');

  def('sort', async (a, stdin) => {
    let rev = false, num = false, uniq = false;
    for (const x of a) { if (x === '-r') rev = true; if (x === '-n') num = true; if (x === '-u') uniq = true; }
    let lines = stdin.replace(/\n$/, '').split('\n');
    lines.sort((p, q) => num ? (parseFloat(p) || 0) - (parseFloat(q) || 0) : p.localeCompare(q));
    if (rev) lines.reverse();
    if (uniq) lines = lines.filter((v, i) => v !== lines[i - 1]);
    return { out: lines.join('\n') + '\n' };
  }, '排序');

  def('uniq', async (a, stdin) => {
    const lines = stdin.replace(/\n$/, '').split('\n');
    const res = lines.filter((v, i) => v !== lines[i - 1]);
    return { out: res.join('\n') + '\n' };
  }, '去重（相邻）');

  def('cut', async (a, stdin) => {
    let d = '\t', f = 1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-d') d = a[++i];
      else if (a[i].startsWith('-d')) d = a[i].slice(2);
      else if (a[i] === '-f') f = parseInt(a[++i], 10) || 1;
      else if (a[i].startsWith('-f')) f = parseInt(a[i].slice(2), 10) || 1;
    }
    return { out: stdin.replace(/\n$/, '').split('\n').map(l => l.split(d)[f - 1] || '').join('\n') + '\n' };
  }, '按分隔符取列');

  def('tr', async (a, stdin) => {
    const [from, to] = a;
    if (!from) return { out: stdin };
    let s = stdin;
    if (a.includes('-d')) return { out: [...s].filter(ch => !from.includes(ch)).join('') };
    const map = {};
    for (let i = 0; i < from.length; i++) map[from[i]] = to ? to[i % to.length] : from[i];
    return { out: [...s].map(ch => map[ch] || ch).join('') };
  }, '字符替换/删除');

  def('sed', async (a, stdin) => {
    let s = stdin;
    const exprs = a.filter(x => !x.startsWith('-'));
    const inPlace = a.includes('-i');
    const file = a.find(x => !x.startsWith('-') && !x.startsWith('s'));
    for (const e of exprs) {
      const m = e.match(/^s(.).*?\1(.*?)\1([gim]*)$/);
      if (!m) continue;
      const [, , pat, rep] = m;
      const re = new RegExp(pat, m[3].includes('g') ? 'gi' : 'i');
      s = s.replace(re, rep.replace(/&/g, '$&'));
    }
    if (inPlace && file) {
      const p = await realPath(file);
      await IO.call('fs.write', p, s, { mime:'text/plain' });
      return {};
    }
    return { out: s };
  }, '流编辑（替换）');

  def('awk', async (a, stdin) => {
    // 只支持 `{print $1,$2}` 这种最常见的用法
    const prog = a[0] || '';
    const m = prog.match(/^\{(.*)\}$/);
    if (!m) return { out: stdin };
    const body = m[1];
    const lines = stdin.replace(/\n$/, '').split('\n');
    const res = lines.map(line => {
      const f = line.trim().split(/\s+/);
      return body.replace(/\$(\d+)/g, (x, n) => n === '0' ? line : (f[Number(n) - 1] || ''));
    });
    return { out: res.join('\n') + '\n' };
  }, '按列处理（子集）');

  def('find', async (a) => {
    let root = '.', name = null, type = null;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-name') name = a[++i];
      else if (a[i] === '-type') type = a[++i];
      else if (!a[i].startsWith('-')) root = a[i];
    }
    const start = await realPath(root);
    const hits = [];
    const walk = async (path) => {
      let rows = [];
      try { rows = await listRows(path); } catch (e) { return; }
      for (const r of rows) {
        const okName = !name || new RegExp('^' + name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(r.name);
        const okType = !type || (type === 'd' ? r.kind === 'dir' : r.kind !== 'dir');
        if (okName && okType) hits.push(r.path);
        if (r.kind === 'dir') await walk(r.path);
      }
    };
    await walk(start);
    if (!hits.length) return { code: 1, out: '' };
    return { out: hits.join('\n') + '\n' };
  }, '查找文件');

  def('tree', async (a) => {
    const root = await realPath(a.find(x => !x.startsWith('-')) || '.');
    let s = CYAN + root + R + '\n';
    const walk = async (path, prefix, depth) => {
      if (depth < 0) return;
      let rows = [];
      try { rows = await listRows(path); } catch (e) { return; }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], last = i === rows.length - 1;
        const color = r.kind === 'dir' ? CYAN : '';
        s += prefix + (last ? '└── ' : '├── ') + color + r.name + (r.kind === 'dir' ? '/' : '') + (color ? R : '') + '\n';
        if (r.kind === 'dir') await walk(r.path, prefix + (last ? '    ' : '│   '), depth - 1);
      }
    };
    await walk(root, '', 3);
    return { out: s };
  }, '树状显示');

  def('mkdir', async (a) => {
    let err = '';
    for (const f of a.filter(x => !x.startsWith('-'))) {
      try { await IO.call('fs.mkdir', await realPath(f)); }
      catch (e) { err += 'mkdir: ' + f + ': ' + (e.message || e) + '\n'; }
    }
    return { code: err ? 1 : 0, err };
  }, '建目录');

  def('touch', async (a) => {
    for (const f of a) {
      const p = await realPath(f);
      const st = await IO.call('fs.stat', p).catch(() => null);
      if (!st) await IO.call('fs.write', p, '', { mime:'text/plain' });
    }
    return {};
  }, '建空文件');

  def('rm', async (a) => {
    let r = false, err = '';
    for (const x of a) {
      if (/^-[a-zA-Z]+$/.test(x)) { if (x.includes('r') || x.includes('R')) r = true; continue; }
      const p = await realPath(x);
      try { await IO.call('fs.remove', p, r); } catch (e) { err += 'rm: ' + x + ': ' + (e.message || e) + '\n'; }
    }
    return { code: err ? 1 : 0, err };
  }, '删除');

  def('rmdir', async (a) => CMDS.rm.fn(['-r'].concat(a)), '删空目录');
  def('unlink', async (a) => CMDS.rm.fn(a), '删除文件');

  def('cp', async (a) => {
    let r = false; const files = [];
    for (const x of a) { if (/^-[a-zA-Z]+$/.test(x)) { if (x.includes('r') || x.includes('R')) r = true; continue; } files.push(x); }
    if (files.length < 2) return { code: 1, err: 'cp: 需要源和目标\n' };
    const dst = files.pop();
    const dstat = await IO.call('fs.stat', await realPath(dst)).catch(() => null);
    let err = '';
    for (const f of files) {
      const target = dstat && dstat.kind === 'dir'
        ? await realPath(dst + '/' + f.split('/').pop())
        : await realPath(dst);
      try { await IO.call('fs.copy', await realPath(f), target); }
      catch (e) { err += 'cp: ' + f + ': ' + (e.message || e) + '\n'; }
    }
    return { code: err ? 1 : 0, err };
  }, '复制');

  def('mv', async (a) => {
    if (a.length < 2) return { code: 1, err: 'mv: 需要源和目标\n' };
    const dst = a[a.length - 1];
    const dstat = await IO.call('fs.stat', await realPath(dst)).catch(() => null);
    let err = '';
    for (const f of a.slice(0, -1)) {
      const target = dstat && dstat.kind === 'dir'
        ? await realPath(dst + '/' + f.split('/').pop())
        : await realPath(dst);
      try { await IO.call('fs.move', await realPath(f), target); }
      catch (e) { err += 'mv: ' + f + ': ' + (e.message || e) + '\n'; }
    }
    return { code: err ? 1 : 0, err };
  }, '移动/改名');

  def('ln', async (a) => CMDS.cp.fn(a), '复制（本文件系统无硬链接）');

  def('basename', async (a) => ({ out: String(a[0] || '').split('/').pop() + '\n' }), '取文件名');
  def('dirname', async (a) => {
    const p = String(a[0] || '');
    const i = p.lastIndexOf('/');
    return { out: (i <= 0 ? (i === 0 ? '/' : '.') : p.slice(0, i)) + '\n' };
  }, '取目录名');

  def('which', async (a) => {
    const r = a.map(n => CMDS[n] ? n + ': shell 内建命令' : null).filter(Boolean);
    return { code: r.length ? 0 : 1, out: r.join('\n') + (r.length ? '\n' : ''), err: r.length ? '' : 'which: 没有 ' + a.join(' ') + '\n' };
  }, '命令位置');

  def('type', async (a) => CMDS.which.fn(a), '命令类型');

  def('true', async () => ({ code: 0 }), '');
  def('false', async () => ({ code: 1 }), '');
  def(':', async () => ({ code: 0 }), '');

  def('seq', async (a) => {
    const n = a.map(Number);
    let from = 1, to = 0, step = 1;
    if (n.length === 1) to = n[0];
    else if (n.length === 2) { from = n[0]; to = n[1]; }
    else { from = n[0]; step = n[1]; to = n[2]; }
    const res = [];
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) res.push(i);
    return { out: res.join('\n') + '\n' };
  }, '数列');

  def('yes', async (a) => ({ out: (a[0] || 'y') + '\n', code: 0 }), '');

  def('date', async (a) => {
    if (a[0] === '+%s') return { out: String(Math.floor(Date.now() / 1000)) + '\n' };
    return { out: new Date().toString() + '\n' };
  }, '日期');

  /* ---------------------------------------------------------------- 数据工具
   * 和「数据」窗口共用同一套算法（主线程 util.codec）：
   * Base32 / MD5 这种「看着简单」的东西写两遍，必然有一遍是错的。
   */
  const FLAGS = (a) => a.filter(x => /^-[a-zA-Z]+$/.test(x)).join('');

  def('b64', async (a, stdin) => {
    const f = FLAGS(a), url = f.includes('u');
    if (!f.includes('d')) {
      const bytes = await inputBytes(a, stdin);
      return { out: await codec(url ? 'b64url' : 'b64', bytes) + '\n' };
    }
    const t = dec(await inputBytes(a, stdin)).trim();
    if (!t) return { out: '' };
    try { return { out: dec(await codec('unb64', t)) }; }
    catch (e) { return { code: 1, err: 'b64: ' + (e.message || e) + '\n' }; }
  }, 'Base64 编解码（-d 解，-u URL 安全）');

  def('b32', async (a, stdin) => {
    const f = FLAGS(a);
    if (!f.includes('d')) return { out: await codec('b32', await inputBytes(a, stdin)) + '\n' };
    try { return { out: dec(await codec('unb32', dec(await inputBytes(a, stdin)).trim())) }; }
    catch (e) { return { code: 1, err: 'b32: ' + (e.message || e) + '\n' }; }
  }, 'Base32 编解码（-d 解）');

  def('hex', async (a, stdin) => {
    const f = FLAGS(a);
    const bytes = await inputBytes(a, stdin);
    if (!f.includes('d')) return { out: await codec(f.includes('s') ? 'hexs' : 'hex', bytes) + '\n' };
    try { return { out: dec(await codec('unhex', dec(bytes))) }; }
    catch (e) { return { code: 1, err: 'hex: ' + (e.message || e) + '\n' }; }
  }, '十六进制编解码（-d 解，-s 带空格）');

  def('bin', async (a, stdin) => {
    const bytes = await inputBytes(a, stdin);
    if (!FLAGS(a).includes('d')) return { out: await codec('bin', bytes) + '\n' };
    try { return { out: dec(await codec('unbin', dec(bytes))) }; }
    catch (e) { return { code: 1, err: 'bin: ' + (e.message || e) + '\n' }; }
  }, '二进制编解码（-d 解）');

  def('dec', async (a, stdin) => {
    const bytes = await inputBytes(a, stdin);
    if (!FLAGS(a).includes('d')) return { out: await codec('dec', bytes) + '\n' };
    try { return { out: dec(await codec('undec', dec(bytes))) }; }
    catch (e) { return { code: 1, err: 'dec: ' + (e.message || e) + '\n' }; }
  }, '十进制大整数编解码（-d 解）');

  def('url', async (a, stdin) => {
    const bytes = await inputBytes(a, stdin);
    if (!FLAGS(a).includes('d')) return { out: await codec('url', bytes) + '\n' };
    try { return { out: dec(await codec('unurl', dec(bytes))) }; }
    catch (e) { return { code: 1, err: 'url: 不是合法的百分号编码\n' }; }
  }, 'URL 百分号编解码（-d 解）');

  def('hash', async (a, stdin) => {
    let alg = 'sha256';
    const files = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-a' || x === '--alg') { alg = String(a[++i] || 'sha256').toLowerCase(); continue; }
      if (/^-(md5|sha1|sha256|sha384|sha512)$/.test(x)) { alg = x.slice(1); continue; }
      files.push(x);
    }
    const MAP = { md5:'MD5', sha1:'SHA-1', sha256:'SHA-256', sha384:'SHA-384', sha512:'SHA-512' };
    const A = MAP[alg];
    if (!A) return { code: 1, err: 'hash: 不支持的算法 ' + alg + '（md5 / sha1 / sha256 / sha384 / sha512）\n' };
    if (!files.length) {
      return { out: (await IO.call('util.hash', A, await inputBytes([], stdin))) + '  -\n' };
    }
    /* 参数既可能是文件，也可能就是一段文字。
     * 规则：能当成文件的按文件算；全都不是文件，就把参数拼起来当文字算 ——
     * 这样 `hash abc` 得到 "abc" 的哈希，而不是一句「没有那个文件」。 */
    let out = '', missing = 0, hit = 0;
    for (const f of files) {
      let p = null;
      try { p = await realPath(f); } catch (e) { p = null; }
      let st = null;
      if (p) { try { st = await IO.call('fs.stat', p); } catch (e) {} }
      if (!st || st.kind !== 'file') { missing++; continue; }
      hit++;
      const r = await IO.call('fs.read', p);
      const bytes = typeof r.content === 'string' ? new TextEncoder().encode(r.content) : new Uint8Array(r.content);
      out += (await IO.call('util.hash', A, bytes)) + '  ' + f + '\n';
    }
    if (!hit) return { out: (await IO.call('util.hash', A, new TextEncoder().encode(files.join(' ')))) + '  -\n' };
    if (missing) return { code: 1, out, err: 'hash: ' + missing + ' 个文件不存在\n' };
    return { out };
  }, '哈希（-a md5|sha1|sha256…，可接文件或管道）');

  def('rand', async (a) => {
    let len = 16, n = 1, kind = 'hex';
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-l') len = Math.max(1, Math.min(4096, parseInt(a[++i], 10) || 16));
      else if (x === '-n') n = Math.max(1, Math.min(200, parseInt(a[++i], 10) || 1));
      else if (x === '-s') kind = String(a[++i] || 'hex');
      else if (!x.startsWith('-')) kind = x;
    }
    const pick = (max) => {
      if (max <= 0) return 0;
      const lim = Math.floor(4294967296 / max) * max;
      const b = new Uint32Array(1);
      for (;;) { crypto.getRandomValues(b); if (b[0] < lim) return b[0] % max; }
    };
    const ALPH = {
      alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      safe: 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789',
      pwd: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+',
      hex: '0123456789abcdef'
    };
    const out = [];
    for (let k = 0; k < n; k++) {
      if (kind === 'uuid') {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        out.push(h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20));
      } else if (kind === 'bytes') {
        const b = new Uint8Array(len);
        crypto.getRandomValues(b);
        out.push(await codec('b64url', b));
      } else {
        const set = ALPH[kind] || ALPH.hex;
        let s = '';
        for (let i = 0; i < len; i++) s += set[pick(set.length)];
        out.push(s);
      }
    }
    return { out: out.join('\n') + '\n' };
  }, '随机串（-l 长度 -n 条数 -s hex|alnum|safe|pwd|uuid|bytes）');

  def('uuid', async (a) => {
    const n = Math.max(1, Math.min(200, parseInt(a[0], 10) || 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      out.push(h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20));
    }
    return { out: out.join('\n') + '\n' };
  }, 'UUID v4');

  def('ts', async (a) => {
    const raw = String(a[0] == null ? '' : a[0]).trim();
    let d = null;
    if (!raw || /^now$/i.test(raw)) d = new Date();
    else if (/^\d{1,11}$/.test(raw)) d = new Date(Number(raw) * 1000);
    else if (/^\d{12,16}$/.test(raw)) d = new Date(Number(raw));
    else d = new Date(raw.replace(/\//g, '-').replace(' ', 'T'));
    if (!d || isNaN(d.getTime())) return { code: 1, err: 'ts: 看不懂 ' + raw + '\n' };
    const rows = [
      ['秒', String(Math.floor(d.getTime() / 1000))],
      ['毫秒', String(d.getTime())],
      ['ISO', d.toISOString()],
      ['本地', d.toString()],
      ['UTC', d.toUTCString()]
    ];
    const w = Math.max(...rows.map(r => r[0].length));
    return { out: rows.map(([k, v]) => k.padEnd(w) + '  ' + v).join('\n') + '\n' };
  }, '时间戳换算（默认现在）');

  def('mount', async (a) => {
    if (a[0]) {
      return { code: 1, err: 'mount: 挂载还没做（占位）。spotfs 打算被 FreeBSD 挂到 /spotfs（guest 里就是 /），现在只导出了表，没有驱动。\n' };
    }
    const ms = await IO.call('fs.mounts');
    const w = Math.max(...ms.map(m => m.path.length), 5);
    return { out: ms.map(m => m.path.padEnd(w) + '  ' + m.type.padEnd(12) + '  ' + m.mount).join('\n') + '\n' };
  }, '列出挂载点（挂载本身未实现）');

  def('tools', async () => {
    const names = ['calc', 'data', 'color', 'markdown', 'htmlapp', 'bezier', 'shot', 'image', 'urlhash', 'timer', 'recorder', 'geo', 'view3d', 'audio', 'applist'];
    const desc = {
      calc:'科学计算器', data:'数据转换', color:'调色盘', markdown:'Markdown 编辑 / 渲染',
      htmlapp:'HTML 编辑 + 实时渲染', bezier:'贝塞尔动效设计器', shot:'网页内截屏',
      image:'看图 / 修图', urlhash:'链接即状态', timer:'计时器 / 秒表', recorder:'录音机',
      geo:'定位', view3d:'3D 视图', audio:'音频播放', applist:'所有应用'
    };
    return { out: names.map(n => n.padEnd(10) + (desc[n] || '')).join('\n') + '\n' };
  }, '列出工具');

  def('tool', async (a) => {
    const name = String(a[0] || '').trim();
    if (!name) return { code: 1, err: 'tool: 用法 tool <名字>，不带参数看 tools\n' };
    const w = await IO.call('win.open', { app:name });
    if (!w) return { code: 1, err: 'tool: 没有这个工具：' + name + '\n' };
    return { out: '已打开 ' + w.title + '\n' };
  }, '打开工具窗口');

  def('whoami', async () => ({ out: (IO.state.user || 'human') + '\n' }), '当前用户');
  def('hostname', async () => ({ out: 'browser\n' }), '主机名');

  def('uname', async (a) => {
    if (a.includes('-a')) return { out: 'HTerMinaL ' + IO.version + ' browser jshel xterm\n' };
    return { out: 'HTerMinaL\n' };
  }, '系统信息');

  def('env', async () => {
    const o = { PWD: IO.getCwd(), HOME:'.home', USER:IO.state.user, SHELL:'hsb1', TERM:'xterm-256color' };
    Object.assign(o, ENV);
    return { out: Object.entries(o).map(([k, v]) => k + '=' + v).join('\n') + '\n' };
  }, '环境变量');

  def('export', async (a) => {
    for (const kv of a) {
      const i = kv.indexOf('=');
      if (i > 0) ENV[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return {};
  }, '设置环境变量');

  def('unset', async (a) => { for (const k of a) delete ENV[k]; return {}; }, '删除变量');

  def('alias', async (a) => {
    if (!a.length) return { out: Object.entries(ALIAS).map(([k, v]) => `alias ${k}='${v}'`).join('\n') + '\n' };
    const s = a.join(' ');
    const i = s.indexOf('=');
    if (i > 0) ALIAS[s.slice(0, i)] = s.slice(i + 1).replace(/^['"]|['"]$/g, '');
    return {};
  }, '别名');

  def('history', async () => {
    const h = (IO.state.history || []).slice(-40);
    return { out: h.map((v, i) => String(i + 1).padStart(4) + '  ' + v).join('\n') + '\n' };
  }, '历史');

  def('clear', async () => ({ clear: true }), '清屏');

  def('du', async (a) => {
    const p = await realPath(a[0] || '.');
    let total = 0, count = 0;
    const walk = async (path) => {
      let rows = [];
      try { rows = await listRows(path); } catch (e) { return; }
      for (const r of rows) { count++; total += r.size || 0; if (r.kind === 'dir') await walk(r.path); }
    };
    await walk(p);
    return { out: `${total}\t${count} 项\t${p}\n` };
  }, '占用空间');

  def('df', async () => {
    const u = await IO.call('fs.usage');
    return { out: 'Filesystem      Size    Used   Avail  Use%  Mounted\n' +
      'idb://hterm     ' + u.quota + '  ' + u.usage + '  ' + (u.quota - u.usage) + '   ' +
      (u.quota ? Math.round(u.usage / u.quota * 100) : 0) + '%  .\n' };
  }, '磁盘占用');

  def('ps', async () => {
    const rows = await IO.call('proc.list');
    return { out: '  PID  ROLE      STATE     CWD\n' + rows.map(r => String(r.pid).padStart(5) + '  ' + String(r.role).padEnd(8) + '  ' + String(r.state).padEnd(8) + '  ' + (r.cwd || '')).join('\n') + '\n' };
  }, '进程');

  def('kill', async (a) => {
    for (const p of a) { const ok = await IO.call('proc.kill', Number(p)); if (!ok) return { code: 1, err: 'kill: 没有这个进程 ' + p + '\n' }; }
    return {};
  }, '结束进程');

  def('man', async (a) => {
    const n = a[0];
    if (!n) return { code: 1, err: 'man: 要看哪个命令？例如 man ls\n' };
    const c = CMDS[n];
    if (!c) return { code: 1, err: 'man: 没有 ' + n + ' 的手册\n' };
    return { out: `${YELLOW}${n}${R}\n\n  ${c.desc || '（无说明）'}\n\n  ${DIM}这是 HTerMinaL 内置的同名精简实现，不是 GNU coreutils 原版。${R}\n` };
  }, '内置手册');

  def('less', async (a, stdin) => ({ out: stdin, page: true }), '分页查看');
  def('more', async (a, stdin) => ({ out: stdin, page: true }), '分页查看');

  /* 下面五条 README 一直列着、实现里却没有：敲下去会被当成 JS 表达式（`xargs is not defined`），
   * 或者更糟——`sleep 2` 落到 JS 的 sleep(ms) 上，2 毫秒就回来了。趁梳理补齐。 */
  def('sleep', async (a) => {
    const t = parseFloat(a.find(x => !x.startsWith('-')) || '0') || 0;
    await new Promise(r => setTimeout(r, Math.max(0, t) * 1000));
    return { code: 0 };
  }, '等待 N 秒');

  def('rev', async (a, stdin) => {
    const s = a.length ? await readText(await realPath(a[0])) : (stdin || '');
    return { code: 0, out: String(s).split('\n').map(l => Array.from(l).reverse().join('')).join('\n') };
  }, '逐行反转');

  def('tee', async (a, stdin) => {
    const files = a.filter(x => !x.startsWith('-'));
    for (const f of files) await IO.call('fs.write', await realPath(f), stdin || '', { mime:'text/plain' });
    return { code: 0, out: stdin || '' };
  }, '写文件同时放行');

  def('stat', async (a) => {
    if (!a.length) return { code: 1, err: 'stat: 缺少操作数\n' };
    let s = '';
    for (const f of a) {
      const p = await realPath(f);
      const st = await IO.call('fs.stat', p).catch(() => null);
      if (!st) return { code: 1, err: 'stat: 无法访问 ' + f + ': 不存在\n' };
      s += '  文件: ' + p + '\n  类型: ' + st.kind + '\n  大小: ' + (st.size || 0)
        + '\n  修改: ' + new Date(st.mtime).toLocaleString('zh-CN') + '\n';
    }
    return { code: 0, out: s };
  }, '文件元数据');

  def('xargs', async (a, stdin) => {
    const items = String(stdin || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (!items.length) return { code: 0 };
    const head = a.length ? a : ['echo'];
    let code = 0;
    for (const it of items) {
      /* 逐个跑，输出由内层 execCommandTokens 直接打到终端 */
      const r = await execCommandTokens(lex(head.concat([it]).join(' ')), '', {});
      code = (r && r.code) || 0;
    }
    return { code };
  }, '把 stdin 的每行当参数执行命令');

  def('diff', async (a) => {
    if (a.length < 2) return { code: 1, err: 'diff: 需要两个文件\n' };
    /* 不存在就报错：以前两个 readText 都 .catch(()=>'')，两个不存在的文件「没有差异」，
     * 退出码 0，脚本里根本发现不了自己写错了路径。 */
    for (const f of a.slice(0, 2)) {
      const st = await IO.call('fs.stat', await realPath(f)).catch(() => null);
      if (!st) return { code: 2, err: 'diff: ' + f + ': 没有那个文件\n' };
    }
    const p = await readText(await realPath(a[0])).catch(() => '');
    const q = await readText(await realPath(a[1])).catch(() => '');
    const A = p.split('\n'), B = q.split('\n');
    let s = '';
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      if (A[i] === B[i]) continue;
      if (A[i] !== undefined) s += RED + '< ' + A[i] + R + '\n';
      if (B[i] !== undefined) s += GREEN + '> ' + B[i] + R + '\n';
    }
    return { code: s ? 1 : 0, out: s };
  }, '比较文件');

  def('source', async (a) => {
    const s = await readText(await realPath(a[0]));
    const r = await execLine(s, { quiet:false });
    return r;
  }, '执行脚本');

  /* help 不在这里定义：JSHeL 自己有一个 help()，会把两套命令一起列出来。
   * 以前这里 def('help') 把内置的那个顶掉了，用户敲 help 只看得到兼容层，
   * 会以为 JSHeL 的函数全没了。 */

  /* help 只属于 hsb1。JSHeL 里的 help() 是另一个东西（列 JS API），
   * 两者不共享实现，也不需要抢名字——一个在 JS 命名空间里，一个在命令表里。 */
  def('help', async () => {
    const names = Object.keys(CMDS).sort();
    const w = 78;
    let s = CYAN + 'hsb1 命令' + R + DIM + '（Linux 风格的自研子集：管道/重定向/变量/通配符可用，不是完整的 POSIX shell）' + R + '\n';
    let line = '  ';
    for (const n of names) {
      const seg = n + '  ';
      if (line.length + seg.length > w) { s += line + '\n'; line = '  '; }
      line += seg;
    }
    s += line + '\n';
    s += '\n' + DIM + 'man <命令> 看单条说明 · exit 退出这一层 · hsb1 再进一层 · hsb2 启动可选组件' + R + '\n';
    return { out: s };
  }, '命令表');

  /* persona：智能体的人格提示词。
   * 刻意不进设置面板——设置页是「功能开关」，这里改的是「它怎么说话」，
   * 混在一起会让设置页变成一段很难维护的文本编辑器；而命令行本来就是改配置的地方。 */
  def('persona', async (a, stdin) => {
    const sub = String(a[0] || '').toLowerCase();
    const rest = a.slice(1).join(' ');
    if (!sub || sub === 'show' || sub === 'cat') {
      const p = await IO.call('agent.persona', 'get');
      const head = p.custom ? '' : DIM + '# 还没改过，下面是内置默认。改法：persona edit' + R + '\n';
      return { out: head + String(p.text).replace(/\n+$/, '') + '\n' };
    }
    if (sub === 'path') return { out: '.config.persona\n' };
    if (sub === 'edit') {
      await IO.call('agent.persona.edit');
      return { out: '已打开编辑器 .config.persona。保存后下一条消息生效。\n' };
    }
    if (sub === 'reset') {
      await IO.call('agent.persona', 'reset');
      return { out: '已恢复内置默认人格。\n' };
    }
    if (sub === 'set' || sub === 'append') {
      const text = rest === '-' ? stdin : rest;
      if (!String(text || '').trim()) return { code:1, err:'用法: persona ' + sub + ' <文本>（多行加引号；也可以 ... | persona set -）\n' };
      if (sub === 'set') await IO.call('agent.persona', 'set', String(text));
      else {
        const p = await IO.call('agent.persona', 'get');
        await IO.call('agent.persona', 'set', String(p.text).replace(/\n+$/, '') + '\n\n' + String(text));
      }
      return { out: '已保存。下一条消息生效。\n' };
    }
    return { code:1, err:'用法: persona [show|edit|set <文本>|append <文本>|reset|path]\n' };
  }, '查看/修改智能体人格提示词');

  /* ---------------------------------------------------------------- 系统信息 */
  /* fastfetch / neofetch：不是移植，是同名精简版。信息全部是真的，
   * 一个字段都不编（拿不到就写 n/a）。 */
  async function sysFacts() {
    let info = {};
    try { info = await IO.call('sys.info') || {}; } catch (e) {}
    let usage = { usage:0, quota:0, files:0 };
    try { usage = await IO.call('fs.usage') || usage; } catch (e) {}
    let pkgs = 0, procs = 1;
    try { pkgs = (await listRows('.pkg')).length; } catch (e) {}
    try { procs = (await IO.call('proc.list') || []).length || 1; } catch (e) {}
    const up = Math.max(0, Math.floor((Date.now() - (IO.state.started || Date.now())) / 1000));
    const upStr = up < 60 ? up + 's' : (up < 3600 ? Math.floor(up / 60) + 'm ' + (up % 60) + 's' : Math.floor(up / 3600) + 'h ' + Math.floor((up % 3600) / 60) + 'm');
    return {
      version: IO.version || '0.0.0.0',
      engine: info.engine || 'n/a',
      os: info.os || 'n/a',
      shell: 'JSHeL + hsb1',
      term: 'xterm.js · ' + IO.cols + 'x' + IO.rows,
      res: info.screen || 'n/a',
      dpr: info.dpr || 1,
      theme: info.theme || 'n/a',
      lang: info.lang || 'n/a',
      uptime: upStr,
      pkgs, procs,
      files: usage.files || 0,
      disk: ((usage.usage || 0) / 1048576).toFixed(2) + ' MB / ' + ((usage.quota || 0) / 1048576).toFixed(0) + ' MB',
      mem: info.mem || 'n/a',
      cpu: info.cores ? info.cores + ' threads' : 'n/a'
    };
  }

  const LOGO = [
    '██╗  ██╗████████╗',
    '██║  ██║╚══██╔══╝',
    '███████║   ██║   ',
    '██╔══██║   ██║   ',
    '██║  ██║   ██║   ',
    '╚═╝  ╚═╝   ╚═╝   '
  ];

  def('fastfetch', async (a) => {
    const f = await sysFacts();
    const noLogo = a.includes('--no-logo') || a.includes('-n');
    const rows = [
      ['OS', f.os],
      ['Host', 'browser · ' + f.engine],
      ['Kernel', 'JSHeL ' + f.version],
      ['Shell', f.shell],
      ['Terminal', f.term],
      ['Resolution', f.res + (f.dpr !== 1 ? ' @' + f.dpr + 'x' : '')],
      ['CPU', f.cpu],
      ['Memory', f.mem],
      ['Disk', f.disk],
      ['Files', String(f.files) + ' · ' + f.pkgs + ' pkg'],
      ['Workers', String(f.procs)],
      ['Locale', f.lang],
      ['Theme', f.theme],
      ['Uptime', f.uptime]
    ];
    const name = CYAN + 'HTerMinaL' + R + DIM + ' ' + f.version + R;
    const sep = DIM + '─'.repeat(26) + R;
    const info = [name, sep].concat(rows.map(([k, v]) => DIM + k.padEnd(10) + R + ' ' + v));
    let s = '';
    if (noLogo) {
      s = info.join('\n') + '\n';
    } else {
      const h = Math.max(LOGO.length, info.length);
      for (let i = 0; i < h; i++) {
        const left = (LOGO[i] || '').padEnd(19);
        s += YELLOW + left + R + '  ' + (info[i] || '') + '\n';
      }
    }
    return { out: s };
  }, '系统信息');
  def('neofetch', async (a) => CMDS.fastfetch.fn(a), '系统信息（别名）');

  /* ---------------------------------------------------------------- 编辑器
   *
   * 全屏应用（vim / nano）用的是终端自己的备用屏（DECSET 1049），
   * 画面完全靠「绝对定位」画出来：每一行都 `\x1b[{n};1H` 定点写，**不发换行符**。
   * 之前是拼一段带 \r\n 的字符串再从 [H 开始刷，只要内容高度等于终端高度，
   * 末尾那个 \r\n 就会把整屏顶上去一行——这就是 nano「显示不正常」的根因：
   * 标题栏被顶出屏幕、正文整体上移、光标落在错误的位置。
   *
   * 中文宽度也必须按显示宽度算（一个汉字占 2 列）：按 code unit 切片会让
   * 满屏中文的 readme 一行行错位、右边界参差。
   */
  const CW = (cp) => {
    if (cp === 0x200b || (cp >= 0x0300 && cp <= 0x036f) || cp === 0xfeff) return 0;
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
    return 1;
  };
  const dw = (s) => { let n = 0; for (const ch of String(s)) n += CW(ch.codePointAt(0)); return n; };
  function sliceW(s, max) {
    let n = 0, out = '';
    for (const ch of String(s)) { const w = CW(ch.codePointAt(0)); if (n + w > max) break; n += w; out += ch; }
    return out;
  }
  function padW(s, max) { const t = sliceW(s, max); return t + ' '.repeat(Math.max(0, max - dw(t))); }
  function skipW(s, cols) {
    let n = 0, i = 0;
    for (const ch of String(s)) { const w = CW(ch.codePointAt(0)); if (n + w > cols) break; n += w; i += ch.length; }
    return { rest: String(s).slice(i), skipped: n };
  }
  function xToCol(line, x) {
    let n = 0, i = 0;
    for (const ch of String(line)) { const w = CW(ch.codePointAt(0)); if (n + w > x) break; n += w; i += ch.length; }
    return i;
  }

  function makeEditor(filePath, mode) {
    const isVim = mode === 'vim' || mode === 'vi';
    const st = {
      lines: [''], row: 0, col: 0, top: 0, left: 0,
      dirty: false, mode: isVim ? 'normal' : 'edit',
      msg: '', cmd: '', quit: false, path: filePath, pend: null,
      clipboard: '', undo: [], search: '', forceQuit: false
    };
    const W = () => Math.max(20, (IO.cols || 80));
    const ROWS = () => Math.max(6, (IO.rows || 24));
    /* 顶栏 1 行；nano 底部两行（状态 + 快捷键），vim 一行（状态） */
    const CHROME = () => (isVim ? 2 : 3);
    const H = () => Math.max(1, ROWS() - CHROME());

    /* 反显（SGR 7）在自定义主题里不可靠：它换的是「默认前景/背景」，
     * 而默认前景在浅色主题下是纯黑，换完就是黑字压在深色条上——看不见。
     * 所以顶栏和状态栏用显式配色：灰底 + 亮白字，深浅主题都清楚。 */
    const BAR = ESC + '[100;97m';
    function render() {
      const w = W(), rows = ROWS(), h = H();
      let s = ESC + '[?25l';
      /* 顶栏 */
      const title = (isVim ? ' VIM ' : ' NANO ') + (st.path || '[No Name]') + (st.dirty ? '  [+]' : '');
      s += ESC + '[1;1H' + BAR + padW(title, w) + ESC + '[0m';
      /* 正文 */
      for (let i = 0; i < h; i++) {
        const ln = st.top + i;
        let vis;
        if (ln >= st.lines.length) vis = (ln === st.lines.length ? DIM + '~' + R : '');
        else {
          const { rest } = skipW(st.lines[ln], st.left);
          vis = sliceW(rest, w - 1);
        }
        s += ESC + '[' + (i + 2) + ';1H' + ESC + '[2K' + vis;
      }
      /* 状态栏 */
      const stat = st.msg || (isVim
        ? '  -- ' + (st.mode === 'insert' ? '插入' : st.mode === 'command' ? ':' + st.cmd : '普通') + ' --   ' + (st.row + 1) + ',' + (st.col + 1)
        : '  ' + (st.row + 1) + '/' + st.lines.length + ' 行 · ' + (st.col + 1) + ' 列');
      s += ESC + '[' + (rows - (isVim ? 0 : 1)) + ';1H' + BAR + padW(stat, w) + ESC + '[0m';
      if (!isVim) {
        /* 必须绝对定位：上一行写满了 w 列，光标处于「待换行」状态，
         * 直接接着写会先滚屏一行——这正是之前 nano 底部错位的原因。 */
        s += ESC + '[' + rows + ';1H' + BAR
          + padW('  ^O 保存   ^X 退出   ^K 剪切行   ^U 粘贴   ^G 位置', w) + ESC + '[0m';
      }
      /* 光标：按显示宽度定位，中文才不会偏 */
      const line = st.lines[st.row] || '';
      const cx = Math.max(0, Math.min(dw(line.slice(0, st.col)) - st.left, w - 1));
      const cy = st.row - st.top;
      s += ESC + '[' + (cy + 2) + ';' + (cx + 1) + 'H' + ESC + '[?25h';
      IO.out(s);
    }

    function clamp() {
      st.row = Math.max(0, Math.min(st.lines.length - 1, st.row));
      st.col = Math.max(0, Math.min(st.lines[st.row].length, st.col));
      const h = H();
      if (st.row < st.top) st.top = st.row;
      if (st.row >= st.top + h) st.top = st.row - h + 1;
      const colW = dw(st.lines[st.row].slice(0, st.col));
      if (colW < st.left) st.left = colW;
      if (colW > st.left + W() - 2) st.left = colW - W() + 2;
    }

    function insert(text) {
      st.undo.push({ lines: st.lines.slice(), row: st.row, col: st.col });
      if (st.undo.length > 80) st.undo.shift();
      const line = st.lines[st.row];
      st.lines[st.row] = line.slice(0, st.col) + text + line.slice(st.col);
      st.col += text.length;
      st.dirty = true;
    }

    async function save() {
      const p = await realPath(st.path);
      await IO.call('fs.write', p, st.lines.join('\n'), { mime:'text/plain' });
      st.dirty = false;
      st.msg = '"' + st.path + '" 已写入 ' + st.lines.join('\n').length + ' 字节';
    }

    /* 鼠标：xterm 在 DECSET 1000 + 1006 下把点击发成 \x1b[<b;x;yM。
     * 点正文就把光标移过去（点哪写哪），滚轮上下滚三行。 */
    function onMouse(btn, x, y, down) {
      const h = H();
      if (btn === 64 || btn === 65) {
        st.top += (btn === 64 ? -3 : 3);
        st.top = Math.max(0, Math.min(st.top, Math.max(0, st.lines.length - 1)));
        return;
      }
      if (!down) return;
      if (y < 2 || y > 1 + h) return;
      const row = Math.min(st.lines.length - 1, st.top + (y - 2));
      st.row = row;
      st.col = xToCol(st.lines[row] || '', Math.max(0, x - 1 + st.left));
    }

    async function handle(data) {
      let i = 0;
      while (i < data.length) {
        const seq = data.slice(i, i + 20);
        let key = null, step = 1;
        const mouse = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
        if (mouse) {
          step = mouse[0].length;
          onMouse(Number(mouse[1]) & 0x7f, Number(mouse[2]), Number(mouse[3]), mouse[4] === 'M');
          i += step;
          clamp(); render();
          continue;
        }
        if (seq.startsWith('\x1b[A') || seq.startsWith('\x1bOA')) { key = 'UP'; step = 3; }
        else if (seq.startsWith('\x1b[B') || seq.startsWith('\x1bOB')) { key = 'DOWN'; step = 3; }
        else if (seq.startsWith('\x1b[C') || seq.startsWith('\x1bOC')) { key = 'RIGHT'; step = 3; }
        else if (seq.startsWith('\x1b[D') || seq.startsWith('\x1bOD')) { key = 'LEFT'; step = 3; }
        else if (seq.startsWith('\x1b[H') || seq.startsWith('\x1bOH')) { key = 'HOME'; step = 3; }
        else if (seq.startsWith('\x1b[F') || seq.startsWith('\x1bOF')) { key = 'END'; step = 3; }
        else if (seq.startsWith('\x1b[3~')) { key = 'DEL'; step = 4; }
        else if (seq.startsWith('\x1b[5~')) { key = 'PGUP'; step = 4; }
        else if (seq.startsWith('\x1b[6~')) { key = 'PGDN'; step = 4; }
        else if (seq.startsWith('\x1b[200~')) {
          const end = data.indexOf('\x1b[201~', i);
          const txt = end > 0 ? data.slice(i + 6, end) : data.slice(i + 6);
          txt.split('\n').forEach((t, k) => { if (k) { st.lines.splice(st.row + 1, 0, ''); st.row++; st.col = 0; } insert(t); });
          i = end > 0 ? end + 6 : data.length;
          clamp(); render(); continue;
        }
        else if (data[i] === '\x1b') { key = 'ESC'; step = 1; }
        else if (data[i] === '\r' || data[i] === '\n') { key = 'ENTER'; step = 1; }
        else if (data[i] === '\x7f' || data[i] === '\b') { key = 'BS'; step = 1; }
        else if (data.charCodeAt(i) === 9) { key = 'TAB'; step = 1; }
        else if (data.charCodeAt(i) < 0x20) { key = 'C-' + String.fromCharCode(data.charCodeAt(i) + 64); step = 1; }
        else {
          const cp = data.codePointAt(i);
          key = 'CHAR:' + String.fromCodePoint(cp);
          step = cp > 0xffff ? 2 : 1;
        }
        i += step;
        const done = await onKey(key);
        if (done) return;
        clamp(); render();
      }
    }

    async function onKey(key) {
      st.msg = '';
      if (key === 'C-Q') return quitNow();
      if (st.mode === 'command') {
        if (key === 'ESC') { st.mode = 'normal'; st.cmd = ''; return false; }
        if (key === 'ENTER') {
          const c = st.cmd; st.cmd = ''; st.mode = 'normal';
          if (/^wq?$/.test(c)) { await save(); if (c !== 'w') return quitNow(); }
          else if (c === 'q') { if (st.dirty) st.msg = '有未保存的修改，用 :q! 强制退出'; else return quitNow(); }
          else if (c === 'q!') return quitNow();
          else if (/^\d+$/.test(c)) { st.row = Math.max(0, Math.min(st.lines.length - 1, Number(c) - 1)); st.col = 0; }
          else st.msg = '未知命令 :' + c;
          return false;
        }
        if (key === 'BS') { st.cmd = st.cmd.slice(0, -1); return false; }
        if (key.startsWith('CHAR:')) { st.cmd += key.slice(5); return false; }
        return false;
      }

      if (!isVim && key === 'C-O') { await save(); return false; }
      if (!isVim && key === 'C-X') { if (st.dirty && !st.forceQuit) { st.msg = '未保存！再按一次 ^X 放弃修改'; st.forceQuit = true; return false; } return quitNow(); }
      if (!isVim && key === 'C-K') { st.clipboard = st.lines.splice(st.row, 1)[0] || ''; if (!st.lines.length) st.lines = ['']; clamp(); st.dirty = true; return false; }
      if (!isVim && key === 'C-U') { st.lines.splice(st.row, 0, st.clipboard); st.dirty = true; return false; }
      /* nano 里方向键直接能移动（本来就是 edit 模式），这里只补一个 ^G 位置提示 */
      if (!isVim && key === 'C-G') { st.msg = '第 ' + (st.row + 1) + '/' + st.lines.length + ' 行 · 第 ' + (st.col + 1) + ' 列 · ' + (st.path || '[No Name]'); return false; }

      const editing = !isVim || st.mode === 'insert';

      if (key === 'ESC') { if (isVim) { st.mode = 'normal'; st.col = Math.max(0, st.col - 1); } return false; }
      if (key === 'UP' || key === 'C-UP') { st.row--; return false; }
      if (key === 'DOWN' || key === 'C-DOWN') { st.row++; return false; }
      if (key === 'LEFT') { st.col--; return false; }
      if (key === 'RIGHT') { st.col++; return false; }
      if (key === 'PGUP') { st.row -= H(); return false; }
      if (key === 'PGDN') { st.row += H(); return false; }
      if (key === 'HOME') { st.col = 0; return false; }
      if (key === 'END') { st.col = st.lines[st.row].length; return false; }

      if (key === 'ENTER') {
        const line = st.lines[st.row];
        st.lines[st.row] = line.slice(0, st.col);
        st.lines.splice(st.row + 1, 0, line.slice(st.col));
        st.row++; st.col = 0; st.dirty = true;
        return false;
      }
      if (key === 'BS') {
        if (st.col > 0) {
          const l = st.lines[st.row];
          st.lines[st.row] = l.slice(0, st.col - 1) + l.slice(st.col);
          st.col--; st.dirty = true;
        } else if (st.row > 0) {
          const prev = st.lines[st.row - 1];
          st.col = prev.length;
          st.lines[st.row - 1] = prev + st.lines[st.row];
          st.lines.splice(st.row, 1);
          st.row--; st.dirty = true;
        }
        return false;
      }
      if (key === 'DEL') {
        const l = st.lines[st.row];
        if (st.col < l.length) { st.lines[st.row] = l.slice(0, st.col) + l.slice(st.col + 1); st.dirty = true; }
        else if (st.row < st.lines.length - 1) { st.lines[st.row] = l + st.lines[st.row + 1]; st.lines.splice(st.row + 1, 1); st.dirty = true; }
        return false;
      }
      if (key === 'TAB') { insert('  '); return false; }

      if (key.startsWith('C-')) {
        const k = key.slice(2);
        if (k === 'S') { await save(); return false; }
        if (k === 'G') { st.msg = '行 ' + (st.row + 1) + '/' + st.lines.length + ' · 列 ' + (st.col + 1) + (st.path ? ' · ' + st.path : ''); return false; }
        return false;
      }
      if (!key.startsWith('CHAR:')) return false;
      const ch = key.slice(5);

      if (editing) { insert(ch); return false; }

      /* vim 普通模式 */
      if (st.pend === 'd') {
        st.pend = null;
        if (ch === 'd') {
          st.undo.push({ lines: st.lines.slice(), row: st.row, col: st.col });
          st.clipboard = st.lines[st.row];
          if (st.lines.length > 1) st.lines.splice(st.row, 1); else st.lines[0] = '';
          clamp(); st.dirty = true;
        }
        return false;
      }
      if (st.pend === 'g') { st.pend = null; if (ch === 'g') { st.row = 0; st.col = 0; } return false; }
      if (ch === 'i') { st.mode = 'insert'; return false; }
      if (ch === 'a') { st.col = Math.min(st.lines[st.row].length, st.col + 1); st.mode = 'insert'; return false; }
      if (ch === 'A') { st.col = st.lines[st.row].length; st.mode = 'insert'; return false; }
      if (ch === 'I') { st.col = 0; st.mode = 'insert'; return false; }
      if (ch === 'o') { st.lines.splice(st.row + 1, 0, ''); st.row++; st.col = 0; st.mode = 'insert'; st.dirty = true; return false; }
      if (ch === 'O') { st.lines.splice(st.row, 0, ''); st.col = 0; st.mode = 'insert'; st.dirty = true; return false; }
      if (ch === 'h') { st.col--; return false; }
      if (ch === 'l') { st.col++; return false; }
      if (ch === 'j') { st.row++; return false; }
      if (ch === 'k') { st.row--; return false; }
      if (ch === '0') { st.col = 0; return false; }
      if (ch === '$') { st.col = st.lines[st.row].length; return false; }
      if (ch === 'x') { st.lines[st.row] = st.lines[st.row].slice(0, st.col) + st.lines[st.row].slice(st.col + 1); st.dirty = true; return false; }
      if (ch === 'd') { st.pend = 'd'; return false; }
      if (ch === 'g') { st.pend = 'g'; return false; }
      if (ch === 'G') { st.row = st.lines.length - 1; st.col = 0; return false; }
      if (ch === 'y' && st.pend === null) { st.clipboard = st.lines[st.row]; st.msg = '已复制 1 行'; return false; }
      if (ch === 'p') {
        if (st.clipboard) { st.lines.splice(st.row + 1, 0, st.clipboard); st.row++; st.dirty = true; }
        return false;
      }
      if (ch === 'u') {
        const u = st.undo.pop();
        if (u) { st.lines = u.lines; st.row = u.row; st.col = u.col; st.dirty = true; }
        return false;
      }
      if (ch === ':') { st.mode = 'command'; st.cmd = ''; return false; }
      if (ch === '/') { st.msg = '搜索请用 :行号'; return false; }
      return false;
    }

    function quitNow() {
      st.quit = true;
      /* 关鼠标报告 → 离开备用屏 → 恢复光标。顺序不能反：
       * 先切回主屏再关鼠标，主屏会残留一段随鼠标移动的高亮。 */
      IO.out(ESC + '[?1000l' + ESC + '[?1006l' + ESC + '[?25h' + ESC + '[?1049l');
      if (IO.editor) IO.editor.setRaw(null);
      if (IO.onEditorResize) IO.onEditorResize = null;
      return true;
    }

    return {
      async start() {
        const p = await realPath(filePath).catch(() => filePath);
        try {
          const txt = await readText(p);
          st.lines = txt.replace(/\n$/, '').split('\n');
          if (!st.lines.length) st.lines = [''];
          st.path = filePath;
        } catch (e) { st.lines = [''], st.path = filePath; }
        /* 备用屏 + 清屏 + 开启鼠标报告（1000 点击 / 1006 SGR 坐标） */
        IO.out(ESC + '[?1049h' + ESC + '[2J' + ESC + '[?1000h' + ESC + '[?1006h' + ESC + '[1;1H');
        if (IO.editor) IO.editor.setRaw((d) => { handle(d); });
        /* 终端尺寸变了就重画：以前只有 shell 提示符会重画，全屏应用会被拉歪 */
        IO.onEditorResize = () => { if (!st.quit) { clamp(); render(); } };
        clamp(); render();
      }
    };
  }

  def('vim', async (a) => {
    const file = a.find(x => !x.startsWith('-')) || '';
    await makeEditor(file, 'vim').start();
    return { hold: true };
  }, '编辑器（vi 兼容子集）');

  def('vi', async (a) => CMDS.vim.fn(a), '编辑器');
  def('nano', async (a) => {
    const file = a.find(x => !x.startsWith('-')) || '';
    await makeEditor(file, 'nano').start();
    return { hold: true };
  }, '编辑器（易用模式）');

  /* hsb1 是一个**可嵌套**的交互层：每敲一次 hsb1 压一层，exit 弹一层。
   * 用栈而不是一个布尔开关，是因为布尔量表达不了「第 2 层退出后回到第 1 层的目录」。
   * 每一层记住进入时的 cwd，弹栈时恢复——这就是 subshell 的语义。 */
  const HSB = [];
  function hsbDepth() { return HSB.length; }
  function hsbPush() {
    HSB.push({ cwd: IO.getCwd(), env: Object.assign({}, ENV) });
    IO.setMode('hsb1');
    IO.kick();
    return HSB.length;
  }
  function hsbPop() {
    const f = HSB.pop();
    if (!f) return false;
    ENV = Object.assign(Object.create(null), f.env);
    IO.setCwd(f.cwd);
    IO.setMode(HSB.length ? 'hsb1' : 'jshel');
    IO.kick();
    return true;
  }

  def('hsb1', async () => {
    const d = hsbPush();
    return { out: DIM + 'hsb1: 第 ' + d + ' 层（exit 退出这一层）' + R + '\n' };
  }, '再进一层 hsb1（可嵌套）');

  /* ---------------------------------------------------------------- hsb2：可选组件
   * 用户已明确要求实现：WASM + v86 + 真实 FreeBSD 12.0 用户态。
   * 四条硬约束不变（风险、可选、不分发、不启动不加载），见 HSB2_NOTICE。 */
  const HSB2_NOTICE = [
    'hsb2 用 WASM（v86）在浏览器里模拟 x86，跑真实的 FreeBSD 12.0 用户态。',
    '',
    '风险与合规（请务必先读）：',
    '  · FreeBSD 及其工具链有 GPL 相关的历史遗留问题，授权情况复杂；',
    '  · 因此 hsb2 是【可选的】：可以完全不用，默认功能不受任何影响；',
    '  · 本项目【不分发】FreeBSD / v86 / WASM 相关的源码或二进制；',
    '  · 组件只在用户【主动启动 hsb2】时才经 CDN 加载，并缓存到 IndexedDB；',
    '    用户不启动，就不会下载、不会加载，也不占用任何空间；',
    '  · 第三方许可证原文见 licenses/，专门章节见 README §5.4。',
    '',
    '用法：hsb2() 启动；hsb2({cold:true}) 跳过快照走冷启动；hsb2.stop() 停止；hsb2.clear() 清缓存。'
  ].join('\n');

  def('hsb2', async (a) => {
    const cold = a.includes('--cold') || a.includes('-c');
    const r = await IO.call('hsb2.open', cold ? { cold: true } : {}, true);
    return {
      out: YELLOW + '⚠ hsb2 · 可选组件：WASM + v86 + FreeBSD 12.0' + R + '\n'
         + DIM + HSB2_NOTICE + R + '\n'
         + DIM + (r && r.reused ? '已复用 hsb2 窗口' : '已打开 hsb2 窗口') + '，组件开始按需下载。' + R + '\n'
    };
  }, '启动 hsb2（WASM + FreeBSD + v86，可选组件；有许可证风险，可选不用）');

  /* 从 hsb1 里敲 jshel：与 hsb1 对称，回到 JSHeL（弹出这一层），
   * 而不是再开一个窗口——否则会出现「敲了 jshel 却还在 HSB、还多出来一个窗口」的困惑，
   * 也正是「hsb1 打不开 jshel」的根源：hsb1 能进，jshel 却回不去（旧逻辑只会开新窗口）。
   * 想开「独立 JSHeL 窗口」（旧语义：新 worker、新环境、exit 关窗互不牵连）时显式加 -n / --new。 */
  def('jshel', async (a) => {
    const newWin = a.includes('-n') || a.includes('--new');
    const dirArg = a.find(x => x !== '-n' && x !== '--new');
    if (hsbDepth() > 0 && !newWin) {
      const d = hsbDepth();
      hsbPop();
      return { out: DIM + 'jshel: 回到 JSHeL' + (d > 1 ? '（退出第 ' + d + ' 层 hsb1）' : '') + R + '\n' };
    }
    if (hsbDepth() === 0 && !dirArg && !newWin) {
      return { out: DIM + 'jshel: 已经是 JSHeL' + R + '\n' };
    }
    /* 开一个新的独立 JSHeL 窗口，cwd 继承当前目录（可带一个目录参数） */
    let cwd = IO.getCwd();
    if (dirArg) {
      const t = await realPath(dirArg).catch(() => null);
      const s = t && await IO.call('fs.stat', t).catch(() => null);
      if (s && s.kind === 'dir') cwd = s.path;
      else return { code: 1, err: 'jshel: 不是目录: ' + dirArg + '\n' };
    }
    const r = await IO.call('shell.open', cwd, true);
    if (!r) return { code: 1, err: 'jshel: 打开窗口失败\n' };
    return { out: DIM + 'jshel: 新窗口 ' + (r.cwd || cwd) + '（独立会话，exit 关闭）' + R + '\n' };
  }, '回到 JSHeL（与 hsb1 对称）；jshel -n [目录] 开新的独立 JSHeL 窗口');

  def('exit', async () => {
    if (hsbDepth()) {
      const d = HSB.length;
      hsbPop();
      return { out: DIM + (d > 1 ? 'exit: 回到第 ' + (d - 1) + ' 层 hsb1' : 'exit: 回到 JSHeL') + R + '\n' };
    }
    return { exit: true };
  }, '退出这一层（最外层退出终端）');
  def('curl', async (a) => {
    const url = a.find(x => !x.startsWith('-'));
    if (!url) return { code: 1, err: 'curl: 需要 URL\n' };
    try {
      const r = await IO.call('agent.fetch', url);
      return { out: r.text || '' };
    } catch (e) { return { code: 1, err: 'curl: ' + (e.message || e) + '\n' }; }
  }, '取 URL 内容');
  def('wget', async (a) => {
    const r = await CMDS.curl.fn(a);
    if (r.err) return r;
    const url = a.find(x => !x.startsWith('-'));
    const name = url.split('/').pop() || 'index.html';
    await IO.call('fs.write', await realPath(name), r.out, { mime:'text/plain' });
    return { out: '已保存 ' + name + '\n' };
  }, '下载文件');

  /* ---------------------------------------------------------------- 执行 */
  function splitLists(tokens) {
    // 按 ; && || 切成若干段
    const lists = [];
    let cur = [];
    for (const t of tokens) {
      if (t.t === 'op' && (t.v === ';' || t.v === '&&' || t.v === '||')) {
        lists.push({ cmd: cur, op: t.v });
        cur = [];
      } else cur.push(t);
    }
    if (cur.length) lists.push({ cmd: cur, op: null });
    return lists;
  }

  function splitPipes(tokens) {
    const segs = [];
    let cur = { words: [], redir: [] };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.t === 'op' && t.v === '|') { segs.push(cur); cur = { words: [], redir: [] }; continue; }
      if (t.t === 'redir') {
        const target = tokens[i + 1] && tokens[i + 1].v;
        cur.redir.push({ op: t.op, fd: t.fd, target });
        i++;
        continue;
      }
      cur.words.push(t.v);
    }
    segs.push(cur);
    return segs;
  }

  async function execCommandTokens(tokens, stdin, flags) {
    const segs = splitPipes(tokens);
    let input = stdin || '';
    let last = { code: 0, out: '' };
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      let words = seg.words.slice();
      if (!words.length) continue;
      // alias
      if (ALIAS[words[0]]) words = lex(ALIAS[words[0]]).filter(x => x.t === 'w').map(x => x.v).concat(words.slice(1));
      const name = words[0];
      const args = [];
      for (const w of words.slice(1)) {
        if (/[*?]/.test(w)) args.push(...await glob(await expandWord(w)));
        else args.push(await expandWord(w));
      }
      // 输入重定向
      for (const r of seg.redir) {
        if (r.op === '<') input = await readText(await realPath(await expandWord(r.target))).catch(() => '');
      }
      const cmd = CMDS[name];
      let res;
      if (cmd) res = await cmd.fn(args, input);
      else {
        res = await tryExternal(name, args, input);
      }
      res = res || {};
      LAST = res.code || 0;
      last = res;
      if (res.hold) return res;
      if (res.err) IO.out(RED + res.err + R);
      // 输出重定向
      let stdout = res.out || '';
      const outRedir = seg.redir.find(r => r.op === '>' || r.op === '>>');
      if (outRedir) {
        const p = await realPath(await expandWord(outRedir.target));
        const prev = outRedir.op === '>>' ? await readText(p).catch(() => '') : '';
        await IO.call('fs.write', p, prev + stdout, { mime:'text/plain' });
        stdout = '';
      }
      if (res.clear) { IO.out(ESC + '[2J' + ESC + '[H'); stdout = ''; }
      if (si === segs.length - 1) {
        if (stdout) IO.out(res.page ? stdout : stdout.replace(/\n/g, '\r\n'));
      }
      input = stdout;
    }
    return last;
  }

  /* 不认识的名字：只找 `.app.<name>` 里的函数，**不**回落到 JSHeL 的 JS 函数。
   * 以前这里会去 IO.api[name] 找同名函数，于是 hsb1 里敲 `write` 就真去写文件了，
   * 两套环境又粘回一起。现在 shell 只认命令和可执行文件，像一个真的 shell。
   * 旧的 `.bin.*` 仍然认，给升级前的文件留一条路（启动时已尽量迁到 .app）。 */
  async function tryExternal(name, args) {
    for (const cand of ['.app.' + name, '.app.' + String(name).toLowerCase(),
                        '.bin.' + name, '.bin.' + String(name).toLowerCase()]) {
      const st = await IO.call('fs.stat', cand).catch(() => null);
      if (st && st.kind === 'func') {
        try {
          const v = await IO.api.exec(cand, ...args);
          return { code: 0, out: v === undefined ? '' : String(v) + '\n' };
        } catch (e) { return { code: 1, err: name + ': ' + (e.message || e) + '\n' }; }
      }
    }
    return { code: 127, err: name + ': 命令未找到（help 看命令表）\n' };
  }

  async function execLine(line, opts) {
    opts = opts || {};
    const tokens = lex(line);
    const lists = splitLists(tokens);
    let res = { code: 0, out: '' };
    for (const L of lists) {
      if (L.op === '&&' && res.code !== 0) continue;
      if (L.op === '||' && res.code === 0) continue;
      res = await execCommandTokens(L.cmd, opts.stdin || '', {});
    }
    return res;
  }

  function attach(io) {
    IO = io;
    HSB.length = 0;
    ENV.PATH = '/bin:/usr/bin';
    ENV.TERM = 'xterm-256color';
    ENV.HOME = '.home';
  }

  return {
    attach, execLine, commands: CMDS, lex,
    hsbPush, hsbPop, hsbDepth, hsb2Notice: () => HSB2_NOTICE,
    editor: makeEditor,
    get ENV() { return ENV; }
  };
})();
