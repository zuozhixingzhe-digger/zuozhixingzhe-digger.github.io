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

  /* REPL 里声明的变量要能被下一行用到。`new AsyncFunction` 每次都是新函数作用域，
   * 所以把「整行就是一条声明」的 const/let/var/function 提升到 globalThis。
   * 只处理单行、单声明的简单情形；复杂解构不碰——宁可它不持久，也不改写语义。 */
  function hoist(code) {
    return code.split('\n').map(line => {
      let m = line.match(/^(\s*)(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/);
      if (m && !/[,]/.test(m[4].replace(/[,({\[]/g, ''))) {
        return m[1] + 'globalThis.' + m[3] + ' = ' + m[4] + ';';
      }
      let f = line.match(/^(\s*)(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (f) return f[1] + 'globalThis.' + f[3] + ' = ' + (f[2] || '') + 'function ' + f[3] + '(' + line.slice(f[0].length);
      return line;
    }).join('\n');
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
        return await new AsyncFunction('return (' + src + '\n)')();
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }

    const hoisted = hoist(src);
    const withTail = tailReturn(hoisted);
    return await new AsyncFunction(withTail || ('"use strict";\n' + hoisted))();
  }

  function describe(v) { return inspect(v, 0, null, true); }

  return { run, describe, hoist, tailReturn };
})();
