/* ============================================================================
 * hterminal · Linux 兼容层（迷你 shell + coreutils 子集 + vim/nano）
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这里没有任何 GPL/AGPL 代码：命令是按 POSIX 行为重新实现的，命名沿用
 * 通用命令名（ls / grep / sed…），实现与任何发行版的源码无关。
 * vim / nano 是「同名精简编辑器」，不是真的 vim/nano，不支持插件与 vimscript。
 *
 * 用法：`zsh` 进入原生模式（提示符变成 `.home% `），`exit` 回到 JSHeL。
 * 也可以在 JSHeL 里直接敲 `ls -la`、`cat a.txt | grep x`。
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
    if (name === 'SHELL') return IO.state.mode === 'zsh' ? '/bin/zsh' : 'jshel';
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

  /* ---------------------------------------------------------------- 路径 */
  async function realPath(p) {
    // 交给主线程的 normPath（同一套 . / ~ / @ 规则）
    return IO.call('fs.resolve', p);
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

  def('pwd', async () => ({ out: IO.getCwd() + '\n' }), '当前目录');

  def('cd', async (a) => {
    const t = a[0] || '.home';
    const s = await IO.call('fs.stat', t).catch(() => null);
    if (!s) return { code: 1, err: 'cd: 没有这个目录: ' + t + '\n' };
    if (s.kind !== 'dir') return { code: 1, err: 'cd: 不是目录: ' + t + '\n' };
    IO.setCwd(s.path);
    return {};
  }, '切换目录');

  function longFmt(rows) {
    return rows.map(r => {
      const k = ({ dir:'d', file:'-', func:'x', app:'a', device:'v', package:'p', grant:'!', proc:'&', link:'l', object:'o', blob:'b' })[r.kind] || '?';
      const size = String(r.size || 0).padStart(7);
      const mt = new Date(r.mtime || Date.now()).toISOString().slice(5, 16).replace('T', ' ');
      const color = ({ dir:CYAN, func:YELLOW, app:MAGENTA, device:BLUE, package:GREEN })[r.kind] || '';
      return `${k}rw-r--r--  ${size}  ${mt}  ${color}${r.name}${color ? R : ''}`;
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

  def('whoami', async () => ({ out: (IO.state.user || 'human') + '\n' }), '当前用户');
  def('hostname', async () => ({ out: 'browser\n' }), '主机名');

  def('uname', async (a) => {
    if (a.includes('-a')) return { out: 'hterminal ' + IO.version + ' browser jshel xterm\n' };
    return { out: 'hterminal\n' };
  }, '系统信息');

  def('env', async () => {
    const o = { PWD: IO.getCwd(), HOME:'.home', USER:IO.state.user, SHELL:IO.state.mode === 'zsh' ? '/bin/zsh' : 'jshel', TERM:'xterm-256color' };
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
    return { out: `${YELLOW}${n}${R}\n\n  ${c.desc || '（无说明）'}\n\n  ${DIM}这是 hterminal 内置的同名精简实现，不是 GNU coreutils 原版。${R}\n` };
  }, '内置手册');

  def('less', async (a, stdin) => ({ out: stdin, page: true }), '分页查看');
  def('more', async (a, stdin) => ({ out: stdin, page: true }), '分页查看');

  def('diff', async (a) => {
    if (a.length < 2) return { code: 1, err: 'diff: 需要两个文件\n' };
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

  /* ---------------------------------------------------------------- 编辑器 */
  function makeEditor(filePath, mode) {
    const isVim = mode === 'vim' || mode === 'vi';
    const st = {
      lines: [''], row: 0, col: 0, top: 0, left: 0,
      dirty: false, mode: isVim ? 'normal' : 'edit',
      msg: '', cmd: '', quit: false, path: filePath, pend: null,
      clipboard: '', undo: [], search: ''
    };
    const W = () => Math.max(20, (IO.cols || 80));
    const H = () => Math.max(4, (IO.rows || 24) - 2);

    function render() {
      const w = W(), h = H();
      let s = ESC + '[?25l' + ESC + '[H';
      // 顶部留一行给状态
      s += ESC + '[2m' + (' ' + (st.path || '[No Name]') + (st.dirty ? ' [+]' : '') + '   ' + (isVim ? st.mode.toUpperCase() : 'NANO')).padEnd(w - 1) + ESC + '[0m' + '\r\n';
      for (let i = 0; i < h; i++) {
        const ln = st.top + i;
        const text = st.lines[ln] === undefined ? (ln === st.lines.length ? '~' : '') : st.lines[ln];
        const vis = text.slice(st.left, st.left + w - 1);
        s += vis + ESC + '[K';
        if (i < h - 1) s += '\r\n';
      }
      // 状态栏
      s += '\r\n' + ESC + '[7m' + (st.msg || (isVim ? '  -- ' + (st.mode === 'insert' ? '插入' : '普通') + ' --' : '  ^O 保存  ^X 退出')) .slice(0, w - 1).padEnd(w - 1) + ESC + '[0m';
      // 光标
      const cy = st.row - st.top, cx = Math.min(st.col - st.left, w - 1);
      s += ESC + `[${cy + 2};${cx + 1}H` + ESC + '[?25h';
      IO.out(s);
    }

    function clamp() {
      st.row = Math.max(0, Math.min(st.lines.length - 1, st.row));
      st.col = Math.max(0, Math.min(st.lines[st.row].length, st.col));
      const h = H();
      if (st.row < st.top) st.top = st.row;
      if (st.row >= st.top + h) st.top = st.row - h + 1;
      if (st.col < st.left) st.left = st.col;
      if (st.col > st.left + W() - 2) st.left = st.col - W() + 2;
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

    async function handle(data) {
      let i = 0;
      while (i < data.length) {
        const seq = data.slice(i, i + 6);
        let key = null, step = 1;
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
          render(); continue;
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

      const editing = !isVim || st.mode === 'insert';

      if (key === 'ESC') { if (isVim) { st.mode = 'normal'; st.col = Math.max(0, st.col - 1); } return false; }
      if (key === 'UP') { st.row--; return false; }
      if (key === 'DOWN') { st.row++; return false; }
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
        if (k === 'Q') return quitNow();
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
      IO.out(ESC + '[?25h' + ESC + '[?1049l');
      if (IO.editor) IO.editor.setRaw(null);
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
        } catch (e) { st.lines = ['']; }
        IO.out(ESC + '[?1049h' + ESC + '[2J');
        if (IO.editor) IO.editor.setRaw((d) => { handle(d); });
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

  def('zsh', async () => {
    IO.state.mode = 'zsh';
    IO.kick();
    return { out: DIM + '已进入 zsh 兼容模式：支持管道、重定向、通配符、变量、alias。exit 回到 JSHeL。' + R + '\n' };
  }, '进入 zsh 兼容模式');
  def('bash', async () => CMDS.zsh.fn(), '同 zsh');
  def('sh', async () => CMDS.zsh.fn(), '同 zsh');

  def('exit', async () => {
    if (IO.state.mode === 'zsh') { IO.state.mode = 'jshel'; IO.kick(); return { out: DIM + '已退出 zsh，回到 JSHeL。' + R + '\n' }; }
    return { exit: true };
  }, '退出当前 shell');

  def('logout', async () => CMDS.exit.fn(), '退出');
  def('su', async () => ({ err: 'su: 单用户环境\n', code: 1 }), '');
  def('sudo', async (a) => {
    if (!a.length) return { code: 1, err: 'sudo: 需要命令\n' };
    return execCommandTokens(lex(a.join(' ')), '', { sudo:true });
  }, '以当前用户执行（本环境无权限模型）');

  def('apt', async () => ({ err: 'apt: 本终端用 npm 生态，请用 `install <包名>` 或 install_pkg\n', code: 1 }), '');
  def('npm', async (a) => {
    if (a[0] === 'install' || a[0] === 'i') return { out: '用 hterm.pkg.install("' + (a[1] || '') + '")\n' };
    return { err: 'npm: 只支持 install <pkg>（走 CDN）\n', code: 1 };
  }, '');
  def('pip', async () => ({ err: 'pip: 请在 python() 里用 pyodide 的 micropip\n', code: 1 }), '');
  def('ping', async () => ({ err: 'ping: 浏览器不允许 ICMP\n', code: 1 }), '');
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

  /* 不认识的名字：先看是不是 JS 全局函数（保持 JSHeL 的能力） */
  async function tryExternal(name, args, stdin) {
    const fn = IO.api && IO.api[name];
    if (typeof fn === 'function') {
      try {
        const v = await fn(...args);
        return { code: 0, out: v === undefined ? '' : String(v) + '\n' };
      } catch (e) { return { code: 1, err: name + ': ' + (e.message || e) + '\n' }; }
    }
    return { code: 127, err: name + ': 命令未找到（试 `help` 看内置命令）\n' };
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

  /* 判断这一行是不是 shell 命令（而不是 JS 表达式） */
  /* 一行到底是「shell 命令」还是「JS 表达式」？
   *
   * 判定顺序很重要：**先看第一个词是不是命令**，再看有没有 shell 语法。
   * 早期版本优先看 `| ; >`，结果 `mkdir("a"); write("b")` 这种一句里带分号的 JS
   * 被整行当成 shell，报「命令未找到」——这就是用户看到的那个 bug。
   */
  function isShellLine(line) {
    const s = String(line || '').trim();
    if (!s) return false;
    const m = s.match(/^([A-Za-z_][\w.-]*)/);
    if (!m) return false;
    const name = m[1];
    if (!CMDS[name]) return false;
    const rest = s.slice(name.length);

    /* 函数调用、成员访问、赋值、比较：都是 JS，别抢。
     * 注意成员访问必须**紧贴**（ls.home / ls[0]），不能允许空格——
     * `ls .home` 里的 `.home` 是点分路径参数，不是属性访问。
     * 早期写成 /^\s*\./ 就把所有 `cmd .path` 都判成 JS 了，
     * 于是 `ls .home` 变成求值 `ls.home`（undefined），一行输出都没有。 */
    if (/^\s*\(/.test(rest)) return false;
    if (/^\./.test(rest) || /^\[/.test(rest)) return false;
    if (/^\s*=[^=]/.test(rest)) return false;
    if (/^\s*([+\-*/%]<|\?\?|\|\||&&)\s/.test(rest)) return false;
    return true;
  }

  function attach(io) {
    IO = io;
    ENV.PATH = '/bin:/usr/bin';
    ENV.TERM = 'xterm-256color';
    ENV.HOME = '.home';
  }

  return {
    attach, execLine, isShellLine, commands: CMDS, lex,
    editor: makeEditor,
    get ENV() { return ENV; }
  };
})();
