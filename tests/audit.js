/* 能力审计：在 JSHeL 里逐项验证「原生 JS / DOM 到底能不能跑」。
 * 用法：spawn(<本文件内容>) 或者把它放进 .bin 里 exec。
 * 输出以 OK / FAIL / ERR 开头，便于机器统计。 */
(async () => {
  const rows = [];
  const push = (s) => { rows.push(s); };
  async function T(name, fn) {
    try {
      const v = await fn();
      if (v === false) push('FAIL ' + name);
      else push('OK   ' + name + (typeof v === 'string' ? ' :: ' + v : ''));
    } catch (e) {
      push('ERR  ' + name + ' :: ' + (e && e.message || e));
    }
  }

  /* ---- 语言核心 ---- */
  await T('BigInt 运算', () => (2n ** 128n).toString(16) === '1' + '0'.repeat(32));
  await T('Symbol.iterator 自定义', () => { const o = { *[Symbol.iterator]() { yield 1; yield 2; } }; return [...o].join() === '1,2'; });
  await T('Generator 双向', () => { function* g() { const x = yield 1; yield x * 2; } const it = g(); it.next(); return it.next(21).value === 42; });
  await T('async generator', async () => { async function* g() { yield 1; yield 2; } let s = 0; for await (const v of g()) s += v; return s === 3; });
  await T('Proxy 拦截', () => { const p = new Proxy({}, { get: (t, k) => k === 'x' ? 7 : 0 }); return p.x === 7; });
  await T('Reflect', () => Reflect.ownKeys({ a: 1 }).includes('a'));
  await T('WeakRef', () => { const o = {}; const w = new WeakRef(o); return w.deref() === o; });
  await T('structuredClone', () => { const o = { a: [1, 2], d: new Date(0) }; const c = structuredClone(o); return c.a !== o.a && c.d.getTime() === 0; });
  await T('class 私有字段', () => { class A { #x = 1; get x() { return this.#x; } } return new A().x === 1; });
  await T('static 块', () => { class B { static v; static { this.v = 9; } } return B.v === 9; });
  await T('可选链 / 空值合并', () => ({ a: null }).a?.b ?? 'dflt' === 'dflt');
  await T('顶层 await', async () => (await Promise.resolve(5)) === 5);
  await T('Promise.withResolvers', async () => { const { promise, resolve } = Promise.withResolvers(); resolve(3); return await promise === 3; });
  await T('Array.fromAsync', async () => { const a = await Array.fromAsync((async function* () { yield 1; yield 2; })()); return a.length === 2; });
  await T('Object.groupBy', () => { const g = Object.groupBy([1, 2, 3, 4], n => n % 2 ? 'odd' : 'even'); return g.odd.length === 2; });
  await T('Array.prototype.at', () => [1, 2, 3].at(-1) === 3);
  await T('String.toWellFormed', () => typeof ''.toWellFormed === 'function');
  await T('RegExp 命名捕获', () => /(?<y>\d{4})-(?<m>\d{2})/.exec('2026-11').groups.y === '2026');
  await T('RegExp 后行断言', () => /(?<=\$)\d+/.exec('$42')[0] === '42');
  await T('RegExp Unicode 属性', () => /\p{Script=Han}/u.test('汉'));
  await T('Error.cause', () => { const e = new Error('x', { cause: 42 }); return e.cause === 42; });
  await T('AggregateError', () => new AggregateError([1], 'm').errors.length === 1);
  await T('Intl.NumberFormat', () => new Intl.NumberFormat('zh-CN').format(1234567).replace(/,/g, '').includes('1234567'));
  await T('Intl.DateTimeFormat', () => new Intl.DateTimeFormat('zh-CN').format(new Date(0)).length > 0);
  await T('Intl.Segmenter 分词', () => [...new Intl.Segmenter('zh', { granularity: 'word' }).segment('汉字编码')].length >= 2);
  await T('TypedArray 视图', () => new Uint8Array(new Uint16Array([258]).buffer)[0] === 2);
  await T('DataView 大小端', () => new DataView(new ArrayBuffer(4)).getUint32(0, true) === 0);
  await T('SharedArrayBuffer', () => typeof SharedArrayBuffer !== 'undefined');
  await T('Atomics', () => typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function');

  /* ---- 浏览器 API ---- */
  await T('TextEncoder/Decoder', () => new TextDecoder().decode(new TextEncoder().encode('汉字')) === '汉字');
  await T('btoa/atob', () => atob(btoa('hello')) === 'hello');
  await T('URL 解析', () => new URL('https://a.b/c?x=1').searchParams.get('x') === '1');
  await T('URLPattern', () => typeof URLPattern !== 'undefined');
  await T('crypto.randomUUID', () => /^[0-9a-f-]{36}$/.test(crypto.randomUUID()));
  await T('crypto.subtle.digest SHA-256', async () => {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    return Array.from(new Uint8Array(b)).slice(0, 3).join(',') === '186,120,22';
  });
  await T('crypto.subtle AES-GCM', async () => {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode('secret'));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct);
    return new TextDecoder().decode(pt) === 'secret';
  });
  await T('performance.now', () => performance.now() > 0);
  await T('performance.mark/measure', () => { performance.mark('a'); performance.mark('b'); performance.measure('ab', 'a', 'b'); return performance.getEntriesByName('ab').length > 0; });
  await T('queueMicrotask', async () => { let x = 0; queueMicrotask(() => x = 1); await null; return x === 1; });
  await T('setTimeout 真异步', async () => { const t = Date.now(); await new Promise(r => setTimeout(r, 30)); return Date.now() - t >= 20; });
  await T('AbortController', () => { const c = new AbortController(); c.abort('why'); return c.signal.aborted && c.signal.reason === 'why'; });
  await T('Blob + 文本读取', async () => new Blob(['abc']).text().then(t => t === 'abc'));
  await T('File 构造', () => new File(['x'], 'a.txt', { type: 'text/plain' }).name === 'a.txt');
  await T('fetch data: URL', async () => (await (await fetch('data:text/plain,hi')).text()) === 'hi');
  await T('Response.json', async () => (await new Response('{"a":1}').json()).a === 1);
  await T('Headers', () => new Headers({ a: '1' }).get('a') === '1'.toString());
  await T('FormData', () => { const f = new FormData(); f.append('k', 'v'); return f.get('k') === 'v'; });
  await T('ReadableStream', async () => { const s = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); } }); let n = 0; for await (const _ of s) n++; return n === 1; });
  await T('CompressionStream gzip', async () => {
    if (typeof CompressionStream === 'undefined') return false;
    const cs = new Blob(['hello']).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(cs).arrayBuffer();
    return buf.byteLength > 0;
  });
  await T('indexedDB', () => typeof indexedDB !== 'undefined');
  await T('localStorage 读写', () => { localStorage.setItem('__ht_audit', '1'); const v = localStorage.getItem('__ht_audit'); localStorage.removeItem('__ht_audit'); return v === '1'; });
  await T('matchMedia', () => { const m = matchMedia('(prefers-color-scheme: dark)'); return typeof m.matches === 'boolean'; });
  await T('getComputedStyle', () => getComputedStyle(document.body).getPropertyValue('background-color').length >= 0);
  await T('requestAnimationFrame', async () => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('rAF 超时')), 500); requestAnimationFrame(() => { clearTimeout(t); res(true); }); }));
  await T('dataset / getAttribute', () => { const d = document.createElement('div'); d.dataset.k = 'v'; return d.getAttribute('data-k') === 'v'; });
  await T('DOM 创建 + 挂载 + 回读', async () => {
    const d = document.createElement('div');
    d.id = '__ht_audit_el';
    d.textContent = 'hello';
    document.body.appendChild(d);
    await sleep(120);
    const got = document.getElementById('__ht_audit_el');
    const ok = got && got.textContent === 'hello';
    if (got) got.remove();
    return ok;
  });
  await T('innerHTML 解析', async () => {
    const d = document.createElement('div');
    d.innerHTML = '<b id="__ht_b">x</b>';
    document.body.appendChild(d);
    await sleep(120);
    const ok = !!document.getElementById('__ht_b');
    d.remove();
    return ok;
  });
  await T('window.getSelection', () => typeof getSelection === 'function' || typeof window.getSelection === 'function');
  await T('document.forms', () => Array.isArray([...document.forms]));
  await T('Element.closest', async () => {
    const d = document.createElement('div');
    d.id = '__ht_c';
    d.innerHTML = '<span id="__ht_s">x</span>';
    document.body.appendChild(d);
    await sleep(100);
    const s = document.getElementById('__ht_s');
    const ok = !!(s && s.closest('#__ht_c'));
    d.remove();
    return ok;
  });
  await T('事件冒泡（主线程回放）', async () => {
    const d = document.createElement('button');
    d.id = '__ht_btn';
    document.body.appendChild(d);
    let hit = 0;
    d.addEventListener('click', () => hit++);
    await sleep(120);
    d.click();
    await sleep(200);
    d.remove();
    return hit === 1;
  });
  await T('Canvas 2D', () => { const c = document.createElement('canvas'); c.width = 10; c.height = 10; const x = c.getContext('2d'); x.fillRect(0, 0, 5, 5); return x.getImageData(0, 0, 1, 1).data[3] === 255; });
  await T('OffscreenCanvas', () => { if (typeof OffscreenCanvas === 'undefined') return false; const c = new OffscreenCanvas(8, 8); return !!c.getContext('2d'); });
  await T('Image / ImageData', () => typeof ImageData !== 'undefined' && new ImageData(2, 2).data.length === 16);
  await T('WebSocket 构造', () => { if (typeof WebSocket === 'undefined') return false; try { const w = new WebSocket('ws://127.0.0.1:1'); w.close(); return true; } catch (e) { return false; } });
  await T('Worker(blob)', () => { if (typeof Worker === 'undefined') return false; const u = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' })); const w = new Worker(u); w.terminate(); URL.revokeObjectURL(u); return true; });
  await T('import(data: URL)', async () => {
    const m = await import('data:text/javascript,export default 42');
    return m.default === 42;
  });
  await T('import(blob: URL)', async () => {
    const u = URL.createObjectURL(new Blob(['export const x = 7;'], { type: 'text/javascript' }));
    const m = await import(u);
    URL.revokeObjectURL(u);
    return m.x === 7;
  });

  /* ---- REPL 语义（依赖之前行的声明） ---- */
  await T('const 持久化', () => typeof __ht_v === 'number' && __ht_v === 1);
  await T('class 持久化', () => typeof __HtK === 'function' && new __HtK().n === 2);
  await T('解构声明持久化', () => typeof __ht_d === 'number' && __ht_d === 3);
  await T('多声明持久化', () => typeof __ht_m1 === 'number' && __ht_m2 === 'number');
  await T('函数声明持久化', () => __ht_f() === 4);
  await T('console.time/timeEnd', () => { const t = Date.now(); console.time('x'); console.timeEnd('x'); return true; });

  console.log('\n===== 审计结果 =====');
  for (const r of rows) console.log(r);
  const ok = rows.filter(r => r.startsWith('OK')).length;
  console.log('汇总 ' + ok + ' / ' + rows.length + ' 通过');
  return { ok, total: rows.length };
})();
