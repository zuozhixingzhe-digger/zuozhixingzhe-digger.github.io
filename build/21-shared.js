/* ============================================================================
 * HTerMinaL · 共享求值器
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 *
 * 这一份被**两处**使用，而且必须是同一份：
 *   1) Worker 里的 JSHeL（用户敲的每一行）；
 *   2) 主线程里的智能体 `js` 工具（模型写的每一段）。
 *
 * 为什么单独抽出来：过去这两处各写各的。终端那边会 hoist 声明、会回显最后
 * 一条表达式的值；`js` 工具那边只是 `new AsyncFunction(code)()`，于是
 * `const a=1; a+1` 在终端里是 2、在工具里是 undefined，DOM 节点变成 `{}`。
 * 智能体因此得出「这个页面的 js 工具返回值不稳定」——它说得对，是我们不一致。
 *
 * 原则（README 里也写了）：**JSHeL 是桥，不是皇帝**。
 *   - JS 怎么写就怎么执行，不偷偷改语义（不把 `ls -la` 猜成 shell 命令）；
 *   - 同样的代码在两处得到同样的值；
 *   - 交互式与非交互式只差「要不要回显、要不要保留声明」，不差求值规则。
 * ==========================================================================*/

/* 颜色是可选的：worker 里有 ANSI，主线程没有（也不需要）。 */
const HSV_ANSI = (typeof ANSI !== 'undefined') ? ANSI : null;

function hsvPaint(code, s, plain) {
  if (plain || !HSV_ANSI) return String(s);
  return code + s + HSV_ANSI.reset;
}

/* Node 的 util.inspect 精简版：终端要好看，模型要能读。
 * plain = true 时不带颜色，直接给智能体。 */
function inspect(v, depth, seen, plain) {
  depth = depth || 0; seen = seen || new Set();
  const t = typeof v;
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (t === 'string') return depth === 0 ? v : JSON.stringify(v);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
  if (t === 'symbol') return v.toString();
  if (t === 'function') {
    const src = Function.prototype.toString.call(v).replace(/\s+/g, ' ').trim();
    return hsvPaint(HSV_ANSI && HSV_ANSI.cyan, src.length > 90 ? src.slice(0, 87) + '…' : src, plain);
  }
  if (v instanceof Error) return (v.stack || (v.name + ': ' + v.message));

  /* DOM 节点：直接 JSON 化是 `{}`，智能体会以为「没拿到」。给一个能认的签名。 */
  if (v && typeof v === 'object' && typeof v.nodeType === 'number' && v.nodeName) {
    const tag = String(v.nodeName).toLowerCase();
    if (v.nodeType === 3) return '#text ' + JSON.stringify(String(v.textContent || '').slice(0, 60));
    if (v.nodeType === 8) return '<!--' + String(v.textContent || '').slice(0, 60) + '-->';
    if (v.nodeType === 9) return '#document';
    const id = v.id ? '#' + v.id : '';
    const cls = (typeof v.className === 'string' && v.className.trim())
      ? '.' + v.className.trim().split(/\s+/).join('.') : '';
    const extra = [];
    if (tag === 'input' && v.type) extra.push('type=' + v.type);
    if (tag === 'a' && v.getAttribute) { const h = v.getAttribute('href'); if (h) extra.push('href=' + h); }
    return '<' + tag + id + cls + (extra.length ? ' ' + extra.join(' ') : '') + '>'
      + (plain ? '' : '');
  }

  if (v instanceof Promise) return 'Promise { <pending> }';
  if (v && v[Symbol.toStringTag] === 'Module') {
    const ks = Object.keys(v);
    return hsvPaint(HSV_ANSI && HSV_ANSI.gray, 'Module(' + ks.length + ' exports) { ' + ks.slice(0, 8).join(', ')
      + (ks.length > 8 ? ', …' : '') + ' }', plain);
  }
  if (seen.has(v)) return hsvPaint(HSV_ANSI && HSV_ANSI.gray, '[Circular]', plain);
  if (depth > 4) return hsvPaint(HSV_ANSI && HSV_ANSI.gray, '…', plain);
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const items = v.slice(0, 60).map(x => inspect(x, depth + 1, seen, plain));
      return '[ ' + items.join(', ') + (v.length > 60 ? ', … ' + (v.length - 60) + ' more' : '') + ' ]';
    }
    if (v instanceof Map) return 'Map(' + v.size + ') { ' + [...v].slice(0, 30).map(([k, x]) => inspect(k, depth + 1, seen, plain) + ' => ' + inspect(x, depth + 1, seen, plain)).join(', ') + ' }';
    if (v instanceof Set) return 'Set(' + v.size + ') { ' + [...v].slice(0, 30).map(x => inspect(x, depth + 1, seen, plain)).join(', ') + ' }';
    if (v instanceof Date) return v.toISOString();
    if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + ')';
    if (ArrayBuffer.isView(v)) return v.constructor.name + '(' + v.length + ') [' + Array.from(v.slice(0, 20)).join(', ') + ']';
    if (typeof v === 'object' && v.constructor && v.constructor.name && v.constructor.name !== 'Object') {
      const keys = Object.keys(v);
      return v.constructor.name + ' { ' + keys.slice(0, 30).map(k => k + ': ' + inspect(v[k], depth + 1, seen, plain)).join(', ') + (keys.length > 30 ? ', …' : '') + ' }';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{ ' + keys.slice(0, 50).map(k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + inspect(v[k], depth + 1, seen, plain)).join(', ') + (keys.length > 50 ? ', …' : '') + ' }';
  } catch (e) { return hsvPaint(HSV_ANSI && HSV_ANSI.gray, '[uninspectable]', plain); }
  finally { seen.delete(v); }
}

/* ---------------------------------------------------------------- 求值器 */
const HTScript = (() => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  /* ================================================================
   * 顶层语句扫描
   *
   * REPL 收到的常常是「一整段粘贴」，不是一行。以前按 '\n' 拆，
   * `const a = {` / `  b: 1` / `}` 会被拆成三条残句，第一条直接语法错误。
   * 这里按「括号深度 0 的 ; 或换行」切，字符串 / 模板串 / 注释 / 正则
   * 里的分隔符不算数。
   * ================================================================ */
  const REGEX_PREV = /[=(:,;[!&|?{}+\-*%<>~^]$/;
  const REGEX_WORD = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

  function topSplit(src) {
    const out = [];
    let depth = 0, i = 0, start = 0;
    let q = null, inLine = false, inBlock = false;

    const push = (end) => {
      const t = src.slice(start, end);
      if (t.trim()) out.push(t);
      start = end + 1;
    };

    for (; i < src.length; i++) {
      const ch = src[i], nx = src[i + 1];

      if (inLine) {
        if (ch === '\n') { inLine = false; if (depth === 0) push(i); }
        continue;
      }
      if (inBlock) {
        if (ch === '*' && nx === '/') { inBlock = false; i++; }
        continue;
      }
      if (q) {
        if (ch === '\\') { i++; continue; }
        if (ch === q) q = null;
        continue;
      }
      if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
      if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }

      /* 正则字面量：`/` 前面是运算符 / 行首 / return 之类才当正则。
       * 不追求 100% 精确——只要正则里的 `;` `,` 不被当成分隔符就够了。 */
      if (ch === '/' && depth >= 0) {
        const prev = src.slice(Math.max(0, i - 12), i);
        if (REGEX_PREV.test(prev.trimEnd()) || REGEX_WORD.test(prev.trimEnd()) || !prev.trim()) {
          let j = i + 1, cls = false;
          for (; j < src.length; j++) {
            const c2 = src[j];
            if (c2 === '\\') { j++; continue; }
            if (c2 === '[') cls = true;
            else if (c2 === ']') cls = false;
            else if (c2 === '/' && !cls) break;
            else if (c2 === '\n') break;
          }
          if (j < src.length && src[j] === '/') { i = j; continue; }
        }
      }

      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0 && (ch === ';' || ch === '\n')) push(i);
    }
    if (start < src.length) { const t = src.slice(start); if (t.trim()) out.push(t); }
    return out;
  }

  /* 按顶层分隔符切（用于 `const a = 1, b = 2` 和解构模式） */
  function splitTop(text, sep) {
    const out = [];
    let depth = 0, i = 0, start = 0, q = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0 && ch === sep) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
  }

  /* 找顶层 `=`（跳过 => == === >= <= != 以及属性默认值之外的情况） */
  function findTopAssign(text) {
    let depth = 0, q = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1], pv = text[i - 1];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0 && ch === '=' && nx !== '=' && nx !== '>' && pv !== '=' && pv !== '!' && pv !== '<' && pv !== '>') return i;
    }
    return -1;
  }

  /* 从一个绑定模式里取出所有「会被真正声明」的标识符。
   *   x              -> x
   *   {a, b: c}      -> a, c
   *   {a: {b}, ...r} -> b, r
   *   [x, , y = 1]   -> x, y
   * 只取第一层 + 递归解构，不处理重命名以外的花活。 */
  function bindingNames(pat) {
    pat = String(pat == null ? '' : pat).trim();
    const eq = findTopAssign(pat);
    if (eq >= 0) pat = pat.slice(0, eq).trim();
    if (!pat) return [];
    if (/^[A-Za-z_$][\w$]*$/.test(pat)) return [pat];
    if (pat[0] === '{' && pat[pat.length - 1] === '}') {
      const inner = pat.slice(1, -1).trim();
      if (!inner) return [];
      const names = [];
      for (let part of splitTop(inner, ',')) {
        part = part.trim();
        if (!part) continue;
        if (part.startsWith('...')) { names.push(...bindingNames(part.slice(3))); continue; }
        /* 顶层冒号：左边是键，右边是值模式 */
        let depth = 0, q = null, colon = -1;
        for (let i = 0; i < part.length; i++) {
          const ch = part[i];
          if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
          if (ch === '"' || ch === "'") { q = ch; continue; }
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') depth--;
          else if (ch === ':' && depth === 0) { colon = i; break; }
        }
        if (colon >= 0) names.push(...bindingNames(part.slice(colon + 1)));
        else names.push(...bindingNames(part));
      }
      return names;
    }
    if (pat[0] === '[' && pat[pat.length - 1] === ']') {
      const inner = pat.slice(1, -1);
      const names = [];
      for (const part of splitTop(inner, ',')) {
        const t = part.trim();
        if (!t) continue;
        names.push(...bindingNames(t.startsWith('...') ? t.slice(3) : t));
      }
      return names;
    }
    return [];
  }

  /* 把声明改写成「赋值到 globalThis」：
   *   const x = 1            -> globalThis.x = (1)
   *   const {a, b: c} = o    -> (() => { const {a, b: c} = (o); globalThis.a = a; globalThis.c = c; })()
   *   class A {}             -> globalThis.A = class A {}
   *   const a = 1, b = 2     -> globalThis.a = (1); globalThis.b = (2);
   *
   * 为什么不直接把 `const` 换成 `globalThis.`：解构和多声明没法逐字替换，
   * 而且 `const {a: x}` 里的 x 本来就该是新名字。 */
  function rewriteDecl(stmt) {
    const m = stmt.match(/^(\s*)(const|let|var)\s+/);
    if (!m) return stmt;
    const indent = m[1], kw = m[2];
    const rest = stmt.slice(m[0].length).replace(/;\s*$/, '');
    const parts = splitTop(rest, ',');
    const outs = [];

    for (const part of parts) {
      const raw = part.trim();
      if (!raw) continue;
      const eq = findTopAssign(raw);
      const pattern = (eq >= 0 ? raw.slice(0, eq) : raw).trim();
      const expr = eq >= 0 ? raw.slice(eq + 1).trim() : null;
      if (!pattern) continue;

      if (/^[A-Za-z_$][\w$]*$/.test(pattern)) {
        outs.push('globalThis.' + pattern + ' = ' + (expr === null ? 'undefined' : '(' + expr + ')') + ';');
        continue;
      }
      const names = bindingNames(pattern);
      if (!names.length) return stmt;         // 认不出来就整段原样执行，别乱改
      if (expr === null) return stmt;         // 解构必须带初始化
      outs.push('(() => { ' + kw + ' ' + pattern + ' = (' + expr + '); ' +
        names.map(n => 'globalThis.' + n + ' = ' + n + ';').join(' ') + ' })();');
    }
    if (!outs.length) return stmt;
    return indent + outs.join(' ');
  }

  /* 单条语句的改写。返回 { code, decl } */
  function rewriteStmt(stmt) {
    const t = stmt.trim();
    if (/^(const|let|var)\s+/.test(t)) {
      const code = rewriteDecl(stmt);
      return { code, decl: code !== stmt || true };
    }
    /* class 声明：类名是「声明」，但类体是表达式，包一层赋值即可 */
    const c = stmt.match(/^(\s*)class\s+([A-Za-z_$][\w$]*)/);
    if (c) return { code: c[1] + 'globalThis.' + c[2] + ' = class ' + c[2] + stmt.slice(c[0].length), decl: true };
    const f = stmt.match(/^(\s*)(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (f) return { code: f[1] + 'globalThis.' + f[3] + ' = ' + (f[2] || '') + 'function ' + f[3] + '(' + stmt.slice(f[0].length), decl: true };
    return { code: stmt, decl: false };
  }

  /* 兼容旧接口：只返回改写后的代码 */
  function hoist(code) { return hoistEx(code).code; }

  function hoistEx(code) {
    const stmts = topSplit(String(code));
    let allDecl = stmts.length > 0;
    const out = stmts.map(st => {
      const r = rewriteStmt(st);
      if (!r.decl) allDecl = false;
      return r.code;
    });
    return { code: out.join('\n'), allDecl };
  }

  /* 把最后一条「表达式语句」改成 return。
   *
   * 这是控制台语义的关键：`const a = 1; a + 1` 应该回显 2，而不是 undefined。
   * 做法是拿最后一行去试着编译成表达式——编译得过，说明它是表达式，包一层 return；
   * 编译不过（`}`、`if (...) {` 这类）就原样执行，别自作聪明。
   * 从后往前试若干切点，避开字符串里的分号。 */
  function tailReturn(code) {
    const src = String(code).replace(/\s+$/, '');
    const cuts = [];
    for (let i = src.length - 1; i >= 0 && cuts.length < 24; i--) {
      if (src[i] === ';' || src[i] === '\n') cuts.push(i);
    }
    for (const cut of cuts) {
      const tail = src.slice(cut + 1).trim().replace(/;$/, '');
      if (!tail) continue;
      const head = src.slice(0, cut + 1);
      try {
        new AsyncFunction('return (' + tail + ')');
        new AsyncFunction(head + '\nreturn (' + tail + ');');
        return head + '\nreturn (' + tail + ');';
      } catch (e) { /* 这个切点不行，往前再试 */ }
    }
    return null;
  }

  /* 编译时带上 sourceURL：报错堆栈里就能看到 HTRepl.js:3:7，
   * 而不是 blob:null/4b39…:2796:22 这种谁也看不懂的东西。 */
  function compile(body) {
    return new AsyncFunction(body + '\n//# sourceURL=HTRepl.js');
  }

  /* 唯一的求值入口。返回「最后一个值」，语义与浏览器控制台一致：
   *   - 先当表达式求值（支持顶层 await）；
   *   - 语法不成立再当语句块执行，并把最后一条表达式作为结果；
   *   - 抛错就抛给调用方，不吞。 */
  async function run(code) {
    const src = String(code == null ? '' : code);
    if (!src.trim()) return undefined;

    const isDecl = /^\s*(?:const|let|var|function|async\s+function|class)\b/.test(src);
    if (!isDecl) {
      try {
        return await compile('return (' + src + '\n)')();
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }

    const hx = hoistEx(src);
    /* 整段都是声明：不回显任何值（`const a = 1` 在浏览器控制台里就是 undefined） */
    if (hx.allDecl) return await compile('"use strict";' + hx.code)();
    const withTail = tailReturn(hx.code);
    return await compile(withTail || ('"use strict";' + hx.code))();
  }

  function describe(v) { return inspect(v, 0, null, true); }

  return { run, describe, hoist, tailReturn };
})();
