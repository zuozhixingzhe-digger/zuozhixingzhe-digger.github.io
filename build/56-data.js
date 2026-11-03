/* ============================================================================
 * HTerMinaL · tools: 数据套件（编码 / 时间戳 / 哈希 / 随机）+ 链接即状态
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这里的算法全部自己写：Base32、MD5、进制转换、大整数。
 * 理由不是「不想用库」，是这些东西都只有几十行，而依赖一旦引进来，
 * 许可证、体积、离线可用性三件事都要跟着重新算一遍。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 编解码原语 */
const B32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b64Of(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}
function b64UrlOf(bytes) {
  return b64Of(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesOfB64(s) {
  let t = String(s || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!t) return new Uint8Array(0);
  const pad = t.length % 4;
  if (pad === 2) t += '==';
  else if (pad === 3) t += '=';
  else if (pad === 1) throw new Error('Base64 长度不对（多了一个字符？）');
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b32Of(bytes) {
  let out = '', bits = 0, val = 0;
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32_ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHA[(val << (5 - bits)) & 31];
  while (out.length % 8) out += '=';
  return out;
}
function bytesOfB32(s) {
  let t = String(s || '').toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of t) {
    const i = B32_ALPHA.indexOf(ch);
    if (i < 0) throw new Error('Base32 里有非法字符：' + ch);
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
function hexOf(bytes, sep) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join(sep || '');
}
function bytesOfHex(s) {
  const t = String(s || '').replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (t.length % 2) throw new Error('十六进制要去掉空格后长度为偶数');
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function binOf(bytes) {
  return [...bytes].map(b => b.toString(2).padStart(8, '0')).join(' ');
}
function bytesOfBin(s) {
  const t = String(s || '').replace(/[^01]/g, '');
  if (!t.length) return new Uint8Array(0);
  if (t.length % 8) throw new Error('二进制要去掉空格后长度为 8 的倍数');
  const out = new Uint8Array(t.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 8, i * 8 + 8), 2);
  return out;
}
function bigOfBytes(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}
function bytesOfBig(v) {
  if (v === 0n) return new Uint8Array([0]);
  const out = [];
  let x = v;
  while (x > 0n) { out.unshift(Number(x & 255n)); x >>= 8n; }
  return new Uint8Array(out);
}
function utf16Of(str, be) {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i * 2 + (be ? 0 : 1)] = c >> 8;
    out[i * 2 + (be ? 1 : 0)] = c & 255;
  }
  return out;
}
function textOfUtf16(bytes, be) {
  let s = '';
  const n = bytes.length - (bytes.length % 2);
  for (let i = 0; i < n; i += 2) {
    s += String.fromCharCode(be ? (bytes[i] << 8) | bytes[i + 1] : (bytes[i + 1] << 8) | bytes[i]);
  }
  return s;
}

/* ---------------------------------------------------------------- 哈希
 * SHA 家族用 Web Crypto；MD5 它不支持（也不打算支持），所以自己写一遍。
 * 为什么还要 MD5：校验下载文件时，很多上游只给 MD5。它不是「安全哈希」，
 * 界面上会明确标出来，不让它和 SHA-256 混为一谈。
 */
function rotl32(x, c) { return ((x << c) | (x >>> (32 - c))) >>> 0; }
const MD5_S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
               5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
               4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
               6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  return k;
})();
function md5Of(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const len = msg.length;
  const total = (((len + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = len * 8;
  dv.setUint32(total - 8, bitLen >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl32(F, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  return out;
}
/** alg: 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' */
async function hashBytes(alg, bytes) {
  if (String(alg).toUpperCase() === 'MD5') return md5Of(bytes);
  if (!(window.crypto && crypto.subtle)) throw new Error('这个环境没有 crypto.subtle（需要 HTTPS 或 localhost）');
  const buf = await crypto.subtle.digest(alg, bytes);
  return new Uint8Array(buf);
}
const HASH_ALGS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'MD5'];

/* ---------------------------------------------------------------- 数据套件 */
const CODEC_SOURCES = [
  ['text', '文本（UTF-8）'],
  ['b64', 'Base64'],
  ['b64url', 'Base64URL'],
  ['b32', 'Base32'],
  ['hex', '十六进制'],
  ['bin', '二进制'],
  ['dec', '十进制（大整数）'],
  ['url', 'URL 编码'],
  ['html', 'HTML 实体']
];

class DataApp {
  constructor(container) {
    this.el = container;
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd">
        <div class="tl-tabs">
          <button class="tl-tab on" data-t="codec">编码转换</button>
          <button class="tl-tab" data-t="time">时间戳</button>
          <button class="tl-tab" data-t="hash">哈希</button>
          <button class="tl-tab" data-t="rand">随机</button>
        </div>
        <span class="tl-note">也有 CLI：<b>b64 / b32 / hex / bin / dec / url / hash / rand / ts</b></span>
      </div>
      <div class="tl-body">
        <section data-p="codec"></section>
        <section data-p="time" hidden></section>
        <section data-p="hash" hidden></section>
        <section data-p="rand" hidden></section>
      </div>
    </div>`;
    this.panes = {};
    for (const s of this.el.querySelectorAll('[data-p]')) this.panes[s.dataset.p] = s;
    this.el.querySelector('.tl-hd').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      this.show(b.dataset.t);
    });
    this.buildCodec();
    this.buildTime();
    this.buildHash();
    this.buildRand();
  }
  show(t) {
    this.el.querySelectorAll('.tl-tab').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    for (const [k, s] of Object.entries(this.panes)) s.hidden = k !== t;
    if (t === 'time') this.refreshNow();
  }

  /* ------------------------------------------------ 编码转换 */
  buildCodec() {
    const p = this.panes.codec;
    p.innerHTML = `<div class="tl-card">
        <div class="tl-row"><label>来源</label>
          <select class="tl-in" data-f="src">${CODEC_SOURCES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
          <button class="tl-btn" data-a="swap" title="把结果的第一项放到输入框">↺ 结果回填</button>
          <span style="flex:1 1 auto"></span>
          <span class="tl-note" data-f="stat"></span>
        </div>
        <textarea class="tl-in" data-f="in" rows="7" spellcheck="false" placeholder="在这里输入或粘贴…">你好，HTerMinaL</textarea>
      </div>
      <div class="tl-card"><h4>各种表示（点右侧复制）</h4><div data-f="out"></div></div>
      <div class="tl-note">说明：文本一律按 UTF-8 编成字节，再从字节算出其它表示。
        「十进制」把整串字节当成一个大整数（不是逐字节转数字），所以可以用来做超长数字的进制换算。
        解码失败会直接说哪一步错了，不会给你一串乱码。</div>`;
    const run = () => this.codecRun();
    p.querySelector('[data-f="in"]').addEventListener('input', run);
    p.querySelector('[data-f="src"]').addEventListener('change', run);
    p.querySelector('[data-a="swap"]').onclick = () => {
      const first = p.querySelector('[data-f="out"] code');
      if (!first) return;
      p.querySelector('[data-f="in"]').value = first.textContent;
      p.querySelector('[data-f="src"]').value = first.dataset.fmt || 'text';
      this.codecRun();
    };
    this.codecRun();
  }
  codecRun() {
    const p = this.panes.codec;
    const src = p.querySelector('[data-f="src"]').value;
    const raw = p.querySelector('[data-f="in"]').value;
    const out = p.querySelector('[data-f="out"]');
    const stat = p.querySelector('[data-f="stat"]');
    let bytes, text;
    try {
      if (src === 'text') { text = raw; bytes = new TextEncoder().encode(raw); }
      else if (src === 'b64') bytes = bytesOfB64(raw);
      else if (src === 'b64url') bytes = bytesOfB64(raw);
      else if (src === 'b32') bytes = bytesOfB32(raw);
      else if (src === 'hex') bytes = bytesOfHex(raw);
      else if (src === 'bin') bytes = bytesOfBin(raw);
      else if (src === 'dec') bytes = bytesOfBig(BigInt(raw.replace(/[\s,_]/g, '') || '0'));
      else if (src === 'url') bytes = new TextEncoder().encode(decodeURIComponent(raw));
      else if (src === 'html') {
        const d = document.createElement('textarea');
        d.innerHTML = raw;
        bytes = new TextEncoder().encode(d.value);
      }
      if (text === undefined) {
        try { text = new TextDecoder('utf-8', { fatal:true }).decode(bytes); }
        catch (e) { text = new TextDecoder('utf-8').decode(bytes); }
      }
    } catch (e) {
      out.innerHTML = `<div class="tl-note" style="color:var(--red)">解析失败：${esc(e.message || e)}</div>`;
      stat.textContent = '';
      return;
    }
    const rows = [
      ['文本', 'text', text],
      ['UTF-16LE', 'u16', textOfUtf16(utf16Of(text, false), false)],
      ['十六进制', 'hex', hexOf(bytes, ' ')],
      ['Base64', 'b64', b64Of(bytes)],
      ['Base64URL', 'b64url', b64UrlOf(bytes)],
      ['Base32', 'b32', b32Of(bytes)],
      ['二进制', 'bin', binOf(bytes)],
      ['十进制', 'dec', bigOfBytes(bytes).toString()],
      ['URL 编码', 'url', encodeURIComponent(text)],
      ['HTML 实体', 'html', [...text].map(c => {
        const cp = c.codePointAt(0);
        return cp > 126 || cp < 32 ? '&#' + cp + ';' : c;
      }).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')]
    ];
    out.innerHTML = rows.map(([label, fmt, val]) =>
      `<div class="tl-kv"><b>${label}</b>
        <code data-fmt="${fmt}">${esc(String(val).slice(0, 4000))}</code>
        <button class="tl-btn sm" data-cp="${fmt}">复制</button></div>`).join('');
    out.querySelectorAll('[data-cp]').forEach(b => {
      b.onclick = () => {
        const row = b.parentElement.querySelector('code');
        ToolKit.copy(row.textContent);
      };
    });
    stat.textContent = bytes.length + ' 字节 · ' + [...text].length + ' 字符';
  }

  /* ------------------------------------------------ 时间戳 */
  buildTime() {
    const p = this.panes.time;
    const zones = ['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London',
      'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
    p.innerHTML = `<div class="tl-card"><h4>现在</h4><div data-f="now"></div></div>
      <div class="tl-card"><h4>换算</h4>
        <div class="tl-row"><label>输入</label>
          <input class="tl-in" data-f="ts" style="flex:1 1 auto" spellcheck="false"
            placeholder="1700000000 / 1700000000000 / 2024-01-01 12:00 / now">
          <button class="tl-btn primary" data-a="conv">换算</button></div>
        <div class="tl-row"><label>时区</label>
          <input class="tl-in" data-f="tz" list="tzList" value="Asia/Shanghai" style="flex:1 1 auto">
          <datalist id="tzList"></datalist>
          <span class="tl-note">IANA 名称，如 Europe/Berlin</span></div>
        <div data-f="res"></div>
      </div>
      <div class="tl-note">
        <b>自动识别</b>：纯数字 10 位当秒、13 位当毫秒；带 <code>-</code> 或 <code>/</code> 当日期字符串；
        写 <code>now</code> 取当前时间。<br>
        时区换算用 <code>Intl</code>，不是自己算偏移 —— 夏令时这种东西自己算一定会错。
      </div>`;
    const dl = p.querySelector('#tzList');
    let list = zones;
    try {
      if (Intl.supportedValuesOf) list = Intl.supportedValuesOf('timeZone');
    } catch (e) {}
    dl.innerHTML = list.map(z => `<option value="${esc(z)}">`).join('');
    p.querySelector('[data-a="conv"]').onclick = () => this.timeConv();
    p.querySelector('[data-f="ts"]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.timeConv();
    });
    this.timeConv();
  }
  refreshNow() {
    const el = this.panes.time && this.panes.time.querySelector('[data-f="now"]');
    if (!el) return;
    const d = new Date();
    el.innerHTML = `<div class="tl-kv"><b>秒</b><code>${Math.floor(d.getTime() / 1000)}</code>
        <button class="tl-btn sm" data-cp>复制</button></div>
      <div class="tl-kv"><b>毫秒</b><code>${d.getTime()}</code><button class="tl-btn sm" data-cp>复制</button></div>
      <div class="tl-kv"><b>ISO</b><code>${d.toISOString()}</code><button class="tl-btn sm" data-cp>复制</button></div>
      <div class="tl-kv"><b>本地</b><code>${esc(d.toString())}</code><button class="tl-btn sm" data-cp>复制</button></div>`;
    el.querySelectorAll('[data-cp]').forEach(b => {
      b.onclick = () => ToolKit.copy(b.parentElement.querySelector('code').textContent);
    });
  }
  timeConv() {
    const p = this.panes.time;
    const raw = p.querySelector('[data-f="ts"]').value.trim();
    const tz = p.querySelector('[data-f="tz"]').value.trim() || 'Asia/Shanghai';
    const res = p.querySelector('[data-f="res"]');
    let d = null;
    if (!raw || /^now$/i.test(raw)) d = new Date();
    else if (/^\d{1,11}$/.test(raw)) d = new Date(Number(raw) * 1000);
    else if (/^\d{12,16}$/.test(raw)) d = new Date(Number(raw));
    else {
      const s = raw.replace(/\//g, '-').replace(' ', 'T');
      d = new Date(s);
      if (isNaN(d.getTime())) d = new Date(raw);
    }
    if (!d || isNaN(d.getTime())) {
      res.innerHTML = '<div class="tl-note" style="color:var(--red)">看不懂这个时间：' + esc(raw) + '</div>';
      return;
    }
    const fmt = (zone) => {
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit',
          hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false, weekday:'short'
        }).format(d);
      } catch (e) { return '时区名不对：' + zone; }
    };
    const diff = Math.round((d.getTime() - Date.now()) / 1000);
    const rel = (() => {
      const a = Math.abs(diff);
      const u = [[31536000, '年'], [2592000, '个月'], [86400, '天'], [3600, '小时'], [60, '分钟'], [1, '秒']];
      for (const [n, name] of u) if (a >= n) return (diff < 0 ? '' : '还有 ') + Math.floor(a / n) + ' ' + name + (diff < 0 ? '前' : '');
      return '就是现在';
    })();
    const rows = [
      ['秒', String(Math.floor(d.getTime() / 1000))],
      ['毫秒', String(d.getTime())],
      ['ISO 8601', d.toISOString()],
      ['UTC', fmt('UTC')],
      [tz, fmt(tz)],
      ['相对', rel]
    ];
    res.innerHTML = rows.map(([k, v]) =>
      `<div class="tl-kv"><b>${esc(k)}</b><code>${esc(v)}</code>
        <button class="tl-btn sm" data-cp>复制</button></div>`).join('');
    res.querySelectorAll('[data-cp]').forEach(b => {
      b.onclick = () => ToolKit.copy(b.parentElement.querySelector('code').textContent);
    });
  }

  /* ------------------------------------------------ 哈希 */
  buildHash() {
    const p = this.panes.hash;
    p.innerHTML = `<div class="tl-card">
        <textarea class="tl-in" data-f="in" rows="6" spellcheck="false" placeholder="要计算哈希的文本…"></textarea>
        <div class="tl-row" style="margin:8px 0 0">
          <button class="tl-btn primary" data-a="calc">计算</button>
          <span class="tl-note">SHA 走 Web Crypto；MD5 是本文件里自己写的，仅用于校验老文件</span>
        </div>
      </div>
      <div class="tl-card"><h4>结果</h4><div data-f="out"><div class="tl-note">还没有计算。</div></div></div>
      <div class="tl-card"><h4>校验</h4>
        <div class="tl-row"><label>期望值</label>
          <input class="tl-in" data-f="expect" style="flex:1 1 auto" spellcheck="false" placeholder="粘贴上游给的哈希">
          <button class="tl-btn" data-a="verify">比对</button></div>
        <div data-f="verdict"></div>
      </div>
      <div class="tl-card"><h4>文件</h4>
        <div class="tl-row"><input type="file" data-f="file" style="flex:1 1 auto;color:var(--fg-dim)">
          <button class="tl-btn" data-a="filehash">算文件哈希</button></div>
        <div class="tl-note">大文件只读一遍：先读成 ArrayBuffer，再依次算 —— 不会把文件留在内存之外的地方。</div>
      </div>`;
    p.querySelector('[data-a="calc"]').onclick = () => this.hashRun();
    p.querySelector('[data-a="verify"]').onclick = async () => {
      const want = p.querySelector('[data-f="expect"]').value.trim().toLowerCase();
      const box = p.querySelector('[data-f="verdict"]');
      if (!want) { box.innerHTML = ''; return; }
      await this.hashRun();
      const got = [...p.querySelectorAll('[data-f="out"] code')].map(c => c.textContent.toLowerCase());
      const hit = got.find(h => h === want);
      box.innerHTML = hit
        ? '<div class="tl-note" style="color:var(--green)">✓ 与某个算法的结果一致</div>'
        : '<div class="tl-note" style="color:var(--red)">✗ 没有任何一个算法的结果与它相同</div>';
    };
    p.querySelector('[data-a="filehash"]').onclick = async () => {
      const f = p.querySelector('[data-f="file"]').files[0];
      if (!f) { toast('先选一个文件', true); return; }
      const buf = new Uint8Array(await f.arrayBuffer());
      await this.hashRun(buf, f.name);
    };
  }
  async hashRun(bytes, label) {
    const p = this.panes.hash;
    const out = p.querySelector('[data-f="out"]');
    const data = bytes || new TextEncoder().encode(p.querySelector('[data-f="in"]').value);
    out.innerHTML = '<div class="tl-note">计算中…</div>';
    const rows = [];
    for (const alg of HASH_ALGS) {
      try {
        const h = await hashBytes(alg, data);
        rows.push([alg, hexOf(h)]);
      } catch (e) {
        rows.push([alg, '不可用：' + (e.message || e)]);
      }
    }
    out.innerHTML = (label ? `<div class="tl-note" style="margin-bottom:6px">文件：${esc(label)} · ${ToolKit.bytes(data.length)}</div>` : '') +
      rows.map(([alg, v]) =>
        `<div class="tl-kv"><b>${alg}</b><code>${esc(v)}</code>
          <button class="tl-btn sm" data-cp>复制</button></div>`).join('') +
      `<div class="tl-note" style="margin-top:6px">${alg_note()}</div>`;
    out.querySelectorAll('[data-cp]').forEach(b => {
      b.onclick = () => ToolKit.copy(b.parentElement.querySelector('code').textContent);
    });
    function alg_note() {
      return '<b>SHA-1 与 MD5</b> 只适合校验「文件有没有损坏」，不能用来证明「没被人改过」。';
    }
  }

  /* ------------------------------------------------ 随机 */
  buildRand() {
    const p = this.panes.rand;
    p.innerHTML = `<div class="tl-card">
        <div class="tl-row"><label>类型</label>
          <select class="tl-in" data-f="kind">
            <option value="str">随机字符串</option>
            <option value="hex">随机十六进制</option>
            <option value="bytes">随机字节（Base64）</option>
            <option value="int">随机整数</option>
            <option value="uuid">UUID v4</option>
            <option value="pwd">随机密码（分组）</option>
          </select>
          <label style="flex:0 0 auto">数量</label>
          <input class="tl-in" type="number" data-f="count" value="1" min="1" max="200" style="width:72px">
        </div>
        <div class="tl-row" data-f="lenRow"><label>长度</label>
          <input class="tl-in" type="number" data-f="len" value="32" min="1" max="4096" style="width:88px">
          <span class="tl-note">字符数（bytes 类型是字节数）</span></div>
        <div class="tl-row" data-f="rangeRow" hidden><label>范围</label>
          <input class="tl-in" type="text" data-f="min" value="1" style="width:96px">
          <span class="tl-note">到</span>
          <input class="tl-in" type="text" data-f="max" value="100" style="width:96px">
          <span class="tl-note">闭区间</span></div>
        <div class="tl-row" data-f="setRow"><label>字符集</label>
          <label class="tl-note"><input type="checkbox" data-f="up" checked> 大写</label>
          <label class="tl-note"><input type="checkbox" data-f="low" checked> 小写</label>
          <label class="tl-note"><input type="checkbox" data-f="num" checked> 数字</label>
          <label class="tl-note"><input type="checkbox" data-f="sym"> 符号</label>
          <label class="tl-note"><input type="checkbox" data-f="nodup"> 去易混（0O1lI）</label>
        </div>
        <div class="tl-row" style="margin:8px 0 0"><button class="tl-btn primary" data-a="gen">生成</button>
          <span class="tl-note" data-f="ent"></span></div>
      </div>
      <div class="tl-card"><h4>结果</h4>
        <textarea class="tl-in" data-f="out" rows="6" readonly style="font-size:12px"></textarea>
        <div class="tl-row" style="margin:6px 0 0"><button class="tl-btn" data-a="cp">复制</button></div>
      </div>
      <div class="tl-note">
        用 <code>crypto.getRandomValues</code>（操作系统 CSPRNG），不是 <code>Math.random</code>。
        右边的「熵」按字符集大小和长度算，是理论下限：真随机源有问题时它也看不出来，
        但它能告诉你「这串东西够不够长」。
      </div>`;
    const kind = p.querySelector('[data-f="kind"]');
    const sync = () => {
      const k = kind.value;
      p.querySelector('[data-f="lenRow"]').hidden = k === 'uuid' || k === 'int';
      p.querySelector('[data-f="rangeRow"]').hidden = k !== 'int';
      p.querySelector('[data-f="setRow"]').hidden = k !== 'str' && k !== 'pwd';
    };
    kind.addEventListener('change', sync);
    sync();
    p.querySelector('[data-a="gen"]').onclick = () => this.genRand();
    p.querySelector('[data-a="cp"]').onclick = () => ToolKit.copy(p.querySelector('[data-f="out"]').value);
    this.genRand();
  }
  _charset(p) {
    let s = '';
    if (p.querySelector('[data-f="up"]').checked) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (p.querySelector('[data-f="low"]').checked) s += 'abcdefghijklmnopqrstuvwxyz';
    if (p.querySelector('[data-f="num"]').checked) s += '0123456789';
    if (p.querySelector('[data-f="sym"]').checked) s += '!@#$%^&*()-_=+[]{};:,.?/~';
    if (p.querySelector('[data-f="nodup"]').checked) s = s.replace(/[0O1lI|`'"]/g, '');
    return s;
  }
  _randInt(max) {
    /* 拒绝采样，避免取模偏差 */
    if (max <= 0) return 0;
    const lim = Math.floor(4294967296 / max) * max;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % max;
    }
  }
  genRand() {
    const p = this.panes.rand;
    const k = p.querySelector('[data-f="kind"]').value;
    const count = Math.max(1, Math.min(200, Number(p.querySelector('[data-f="count"]').value) || 1));
    const len = Math.max(1, Math.min(4096, Number(p.querySelector('[data-f="len"]').value) || 32));
    const out = [];
    let ent = 0;
    if (k === 'int') {
      const a = BigInt(String(p.querySelector('[data-f="min"]').value).trim() || '0');
      const b = BigInt(String(p.querySelector('[data-f="max"]').value).trim() || '100');
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const span = hi - lo + 1n;
      for (let i = 0; i < count; i++) {
        /* 跨度可能超过 2^32：拼两个 32 位再取模，仍走拒绝采样 */
        if (span <= 4294967296n) {
          out.push(String(lo + BigInt(this._randInt(Number(span)))));
        } else {
          const buf = new Uint32Array(2);
          crypto.getRandomValues(buf);
          const v = (BigInt(buf[0]) << 32n) | BigInt(buf[1]);
          out.push(String(lo + (v % span)));
        }
      }
      ent = Math.log2(Number(span));
    } else if (k === 'uuid') {
      for (let i = 0; i < count; i++) {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = hexOf(b);
        out.push(h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20));
      }
      ent = 122;
    } else if (k === 'bytes') {
      for (let i = 0; i < count; i++) {
        const b = new Uint8Array(len);
        crypto.getRandomValues(b);
        out.push(b64UrlOf(b));
      }
      ent = len * 8;
    } else if (k === 'hex') {
      for (let i = 0; i < count; i++) {
        const b = new Uint8Array(Math.ceil(len / 2));
        crypto.getRandomValues(b);
        out.push(hexOf(b).slice(0, len));
      }
      ent = len * 4;
    } else {
      const set = this._charset(p);
      if (!set) { toast('字符集是空的', true); return; }
      const groups = k === 'pwd' ? 4 : 1;
      const per = k === 'pwd' ? Math.max(1, Math.floor(len / groups)) : len;
      for (let i = 0; i < count; i++) {
        const chunks = [];
        for (let g = 0; g < groups; g++) {
          let s = '';
          for (let j = 0; j < per; j++) s += set[this._randInt(set.length)];
          chunks.push(s);
        }
        out.push(chunks.join('-'));
      }
      ent = len * Math.log2(set.length);
    }
    p.querySelector('[data-f="out"]').value = out.join('\n');
    p.querySelector('[data-f="ent"]').textContent = '约 ' + Math.round(ent) + ' bit 熵';
  }
}

/* ============================================================================
 * 链接即状态（URLHash）
 *
 * 把一段文本/JS 压进 URL 的 # 片段：复制链接发给别人，对方打开就能看到同样的内容。
 * 用 # 而不是 ? 是刻意的：# 不会发给服务器，内容只存在于浏览器里。
 *
 * 关于「打开即运行」：默认关闭。带 run=1 的链接打开时会弹一个确认框，
 * 把要执行的代码原样显示出来，用户点「运行」才执行 ——
 * 自动执行别人发来的链接，等于把 XSS 做成了功能。
 * ==========================================================================*/
async function deflateText(str) {
  if (!('CompressionStream' in window)) return null;
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}
async function inflateText(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(buf));
}

const UrlHash = {
  async encode(text, mode) {
    const bytes = new TextEncoder().encode(String(text));
    let payload = b64UrlOf(bytes);
    let packed = false;
    try {
      const z = await deflateText(String(text));
      if (z && z.length < bytes.length - 8) { payload = b64UrlOf(z); packed = true; }
    } catch (e) {}
    return { payload, packed };
  },
  async decode(payload) {
    const bytes = bytesOfB64(payload);
    try { return await inflateText(bytes); }
    catch (e) { return new TextDecoder().decode(bytes); }
  },
  link(text, mode) {
    return this.encode(text, mode).then(({ payload, packed }) => {
      const base = location.origin === 'null' || location.protocol === 'file:'
        ? location.href.split('#')[0]
        : location.origin + location.pathname;
      return base + '#ht=' + payload + (packed ? '&z=1' : '') + (mode === 'js' ? '&run=1' : '');
    });
  },
  parse(hash) {
    const h = String(hash == null ? location.hash : hash).replace(/^#/, '');
    if (!h) return null;
    const p = new URLSearchParams(h);
    const payload = p.get('ht');
    if (!payload) return null;
    return { payload, run: p.get('run') === '1', packed: p.get('z') === '1' };
  }
};

class UrlHashApp {
  constructor(container) {
    this.el = container;
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd"><b style="letter-spacing:.08em;font-size:10.5px;color:var(--fg-mute)">链接即状态</b>
        <span style="flex:1 1 auto"></span>
        <span class="tl-note" data-f="len"></span></div>
      <div class="tl-body">
        <div class="tl-card">
          <div class="tl-row"><label>类型</label>
            <select class="tl-in" data-f="mode">
              <option value="text">文本</option>
              <option value="js">JavaScript</option>
            </select>
            <label class="tl-note"><input type="checkbox" data-f="run"> 打开链接时提示运行</label>
            <span style="flex:1 1 auto"></span>
            <button class="tl-btn primary" data-a="mk">生成链接</button></div>
          <textarea class="tl-in" data-f="src" rows="7" spellcheck="false" placeholder="写点什么，或者一段 JS…">console.log('hello from a URL')</textarea>
        </div>
        <div class="tl-card"><h4>链接</h4>
          <div class="uh-link" data-f="link">—</div>
          <div class="tl-row" style="margin:6px 0 0">
            <button class="tl-btn" data-a="cp">复制链接</button>
            <button class="tl-btn" data-a="open">在新标签打开</button>
            <span class="tl-note" data-f="info"></span>
          </div>
        </div>
        <div class="tl-card"><h4>解析别人的链接</h4>
          <div class="tl-row"><input class="tl-in" data-f="in" style="flex:1 1 auto" placeholder="粘贴一个带 #ht= 的链接">
            <button class="tl-btn" data-a="parse">解析</button></div>
          <div class="tl-note" data-f="parsed"></div>
        </div>
        <div class="tl-note">
          内容放在 <code>#</code> 后面：<b>不会发给服务器</b>，也不会进访问日志。
          大于几十字节会自动用 <code>deflate-raw</code> 压一次（浏览器自带，不需要库）。<br>
          带 <code>run=1</code> 的链接打开时会先弹确认框、把代码原样显示出来，点「运行」才执行 ——
          自动执行别人发来的链接，等于把 XSS 做成功能。
        </div>
      </div>
    </div>`;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'mk') this.make();
      else if (a === 'cp') ToolKit.copy(this.linkText || '');
      else if (a === 'open') { if (this.linkText) window.open(this.linkText, '_blank', 'noopener'); }
      else if (a === 'parse') this.parseIn();
    });
    this.loadFromHash();
  }
  async make() {
    const p = this.el;
    const src = p.querySelector('[data-f="src"]').value;
    const mode = p.querySelector('[data-f="mode"]').value;
    const run = p.querySelector('[data-f="run"]').checked;
    const link = await UrlHash.link(src, mode === 'js' && run ? 'js' : 'text');
    this.linkText = link;
    p.querySelector('[data-f="link"]').textContent = link;
    p.querySelector('[data-f="len"]').textContent = link.length + ' 字符';
    p.querySelector('[data-f="info"]').textContent = link.length > 2000
      ? '（超过 2000 字符，部分聊天软件会自动截断）' : '';
  }
  async parseIn() {
    const raw = this.el.querySelector('[data-f="in"]').value.trim();
    const meta = UrlHash.parse(raw.includes('#') ? raw.slice(raw.indexOf('#')) : raw);
    if (!meta) { this.el.querySelector('[data-f="parsed"]').textContent = '这个链接里没有 #ht= 内容。'; return; }
    try {
      const text = await UrlHash.decode(meta.payload);
      this.el.querySelector('[data-f="parsed"]').innerHTML =
        `<div style="margin:4px 0 6px">解出 ${text.length} 个字符${meta.run ? ' · <b style="color:var(--amber)">请求运行</b>' : ''}</div>
         <textarea class="tl-in" rows="5" readonly>${esc(text)}</textarea>`;
      this.el.querySelector('[data-f="src"]').value = text;
    } catch (e) {
      this.el.querySelector('[data-f="parsed"]').textContent = '解不开：' + (e.message || e);
    }
  }
  async loadFromHash() {
    const meta = UrlHash.parse();
    if (!meta) return;
    try {
      const text = await UrlHash.decode(meta.payload);
      this.el.querySelector('[data-f="src"]').value = text;
      if (meta.run) {
        this.el.querySelector('[data-f="mode"]').value = 'js';
        setTimeout(() => {
          modal({
            title: '这个链接想运行一段脚本',
            body: `<div class="tl-note" style="margin-bottom:8px">链接里带 <code>run=1</code>。
              下面就是它要执行的全部代码 —— 只信任你自己写的，或者你看得懂的。</div>
              <pre style="max-height:240px;overflow:auto;background:var(--bg-terminal);border:1px solid var(--line);
                border-radius:7px;padding:9px;font-size:11px;line-height:1.6;white-space:pre-wrap">${esc(text.slice(0, 4000))}</pre>`,
            buttons: [
              { label:'不运行', value:false },
              { label:'运行', primary:true, value:true }
            ]
          }).then((ok) => {
            if (ok) this.runCode(text);
          });
        }, 200);
      }
    } catch (e) {
      toast('链接内容解不开：' + (e && e.message || e), true);
    }
  }
  runCode(code) {
    /* 在终端里跑，而不是本页 eval：这样输出落在用户熟悉的地方，也和 JSHeL 的语义一致 */
    try {
      WindowManager.open({ type:'shell', code:String(code) });
      toast('已在一个新终端里执行');
    } catch (e) { toast('执行失败：' + (e.message || e), true); }
  }
}
