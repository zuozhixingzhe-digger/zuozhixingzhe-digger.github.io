/* ---------------------------------------------------------------- 汉字码
 * 十六进制串 ↔ 汉字，三种方案，解码自动识别：
 *   A  4096 字码表  3 hex / 字（12 bit），末尾 1 个标记字表示末组宽度 1/2/3
 *   B  2048 字码表  11 bit / 字，末尾标记表示最后一组有效 bit 数 0..10
 *   C  按读音      1379 个带调音节做基数，整个 hex 当一个 BigInt 转 1379 进制；
 *                  每个音节随机取一个同音字，末尾标记同时记录前导零个数 0..15。
 *                  同音字互换不影响解码——解码只看读音。
 *
 * 数据在 build/66b-hanzi-data.js（生成脚本 tools/gen-hanzi-data.py）。
 */
const HanziCodec = (() => {
  const A = [...HZ_TABLE_RAW];
  const B = [...HZ_TABLE_2048];
  const AIDX = new Map(), BIDX = new Map();
  A.forEach((c, i) => AIDX.set(c, i));
  B.forEach((c, i) => BIDX.set(c, i));

  const SYL = [], S2C = [], C2S = new Map();
  for (const g of HZ_PINYIN_GROUPS.split('|')) {
    const k = g.indexOf(':');
    const idx = SYL.length;
    const chars = [...g.slice(k + 1)];
    SYL.push(g.slice(0, k));
    S2C.push(chars);
    for (const c of chars) if (!C2S.has(c)) C2S.set(c, idx);
  }

  const MA = HZ_MARKS_A, MB = HZ_MARKS_B, MC = HZ_MARKS_C;
  const ALL_MARKS = new Set([...MA, ...MB, ...MC]);
  const BASE = BigInt(SYL.length);
  const NAMES = { A:'4096 字', B:'2048 字', C:'按读音' };

  const clean = h => String(h == null ? '' : h).replace(/\s+/g, '').toLowerCase();
  function checkHex(raw) {
    const h = clean(raw);
    if (!h) throw new Error('十六进制内容为空');
    for (let i = 0; i < h.length; i++) {
      if (!/[0-9a-f]/.test(h[i])) throw new Error('第 ' + (i + 1) + ' 个字符不是十六进制：' + raw[i]);
    }
    return h;
  }
  const hexOf = v => v.toString(16);

  /* ---------------- A：4096 字，3 hex 一组 ---------------- */
  function encA(raw) {
    const h = checkHex(raw);
    let out = '', i = 0;
    for (; i + 3 <= h.length; i += 3) out += A[parseInt(h.slice(i, i + 3), 16)];
    const rem = h.length - i;
    if (rem) out += A[parseInt(h.slice(i), 16)];
    out += MA[rem ? rem - 1 : 2];
    return out;
  }
  function decA(han) {
    const s = [...String(han).replace(/\s+/g, '')];
    const last = s.pop();
    const li = MA.indexOf(last);
    if (li < 0) return null;
    const L = li + 1;
    const data = s;
    let out = '';
    data.forEach((ch, i) => {
      const v = AIDX.get(ch);
      if (v == null) throw new Error('码表外字符：' + ch);
      const w = i === data.length - 1 ? L : 3;
      if (v >= Math.pow(16, w)) throw new Error('末组编号越界：' + ch + ' 放不进 ' + w + ' 位');
      out += hexOf(v).padStart(w, '0');
    });
    return out;
  }

  /* ---------------- B：2048 字，11 bit 一组 ---------------- */
  const bitsOf = h => [...h].map(c => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
  function encB(raw) {
    const bits = bitsOf(checkHex(raw));
    let out = '', i = 0;
    for (; i + 11 <= bits.length; i += 11) out += B[parseInt(bits.slice(i, i + 11), 2)];
    const rem = bits.length - i;
    if (rem) out += B[parseInt(bits.slice(i).padEnd(11, '0'), 2)];
    out += MB[rem];
    return out;
  }
  function decB(han) {
    const s = [...String(han).replace(/\s+/g, '')];
    const last = s.pop();
    const r = MB.indexOf(last);
    if (r < 0) return null;
    if (!s.length) { if (r) throw new Error('只有标记字，没有数据'); return ''; }
    let bits = '';
    s.forEach((ch, i) => {
      const v = BIDX.get(ch);
      if (v == null) throw new Error('2048 码表外字符：' + ch);
      let g = v.toString(2).padStart(11, '0');
      if (i === s.length - 1 && r > 0) g = g.slice(0, r);
      bits += g;
    });
    if (bits.length % 4) throw new Error('有效位数不是 4 的倍数，末组标记可能不对');
    let out = '';
    for (let i = 0; i < bits.length; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return out;
  }

  /* ---------------- C：读音，1379 进制 ---------------- */
  function pickChar(idx) {
    const cs = S2C[idx];
    if (!cs || !cs.length) throw new Error('音节没有对应汉字：' + idx);
    if (cs.length === 1) return cs[0];
    /* 尽量不取标记字：解码不受影响，但混在数据里看着像另一个标记 */
    for (let k = 0; k < 8; k++) {
      const c = cs[(Math.random() * cs.length) | 0];
      if (!ALL_MARKS.has(c)) return c;
    }
    return cs[0];
  }
  function encC(raw, prev) {
    const h = checkHex(raw);
    let z = 0;
    while (z < h.length && h[z] === '0') z++;
    if (z === h.length) z = h.length - 1;   /* 全 0：留一个 0 当数值 */
    if (z > 15) throw new Error('前导零超过 15 个，C 方案记不下；请先去掉多余的前导零');
    const body = h.slice(z) || '0';
    let n = BigInt('0x' + body);
    const digits = [];
    if (n === 0n) digits.push(0);
    while (n > 0n) { digits.push(Number(n % BASE)); n /= BASE; }
    /* 双向实时联动时，每敲一个 hex 都会整串重算。
     * 如果上一次的某个位置读音没变，就把那个字原样留下 —— 否则整行同音字会乱跳。 */
    const old = prev ? [...String(prev).replace(/\s+/g, '')] : [];
    if (old.length) old.pop();          /* 去掉末尾标记字 */
    let out = '';
    for (let i = digits.length - 1, k = 0; i >= 0; i--, k++) {
      const d = digits[i];
      const pc = old[k];
      if (pc && !ALL_MARKS.has(pc) && C2S.get(pc) === d) out += pc;
      else out += pickChar(d);
    }
    out += MC[z];
    return out;
  }
  function decC(han) {
    const s = [...String(han).replace(/\s+/g, '')];
    const last = s.pop();
    const z = MC.indexOf(last);
    if (z < 0) return null;
    if (!s.length) throw new Error('只有标记字，没有数据');
    let n = 0n;
    for (const ch of s) {
      const d = C2S.get(ch);
      if (d == null) throw new Error('读音表外字符：' + ch + '（不在 20924 个基本区汉字里）');
      n = n * BASE + BigInt(d);
    }
    let hex = n.toString(16);
    if (z) hex = '0'.repeat(z) + hex;
    return hex;
  }

  /* ---------------- 自动识别 ---------------- */
  function detect(han) {
    const s = [...String(han).replace(/\s+/g, '')];
    if (!s.length) return null;
    const last = s[s.length - 1];
    if (MA.includes(last)) return 'A';
    if (MB.includes(last)) return 'B';
    if (MC.includes(last)) return 'C';
    return null;
  }
  function decode(han) {
    const scheme = detect(han);
    if (!scheme) throw new Error('末尾不是标记字：无法判断是 4096 / 2048 / 读音哪一套');
    const out = scheme === 'A' ? decA(han) : scheme === 'B' ? decB(han) : decC(han);
    if (out == null) throw new Error('解码失败：标记字与内容不匹配');
    return { scheme, hex: out };
  }
  function encode(raw, scheme, prev) {
    if (scheme === 'B') return encB(raw);
    if (scheme === 'C') return encC(raw, prev);
    return encA(raw);
  }
  /* 没有末尾标记字时的「宽松解码」：按当前选中的方案直接解。
   * 严格协议仍然优先——只有 detect() 认不出标记才会走到这里。
   * A/B 的末组宽度是有损的（不知道原本是 1/2/3 位），这里统一按满宽处理：
   * 结果可能多出前导零，但每个字对应的数值一定对。 */
  function decodeLoose(han, scheme) {
    const s = String(han == null ? '' : han).replace(/\s+/g, '');
    if (!s) return { scheme, hex: '', loose: true };
    const mark = scheme === 'B' ? MB[0] : scheme === 'C' ? MC[0] : MA[2];
    const out = scheme === 'B' ? decB(s + mark) : scheme === 'C' ? decC(s + mark) : decA(s + mark);
    if (out == null) throw new Error('解码失败');
    return { scheme, hex: out, loose: true };
  }
  function stats(raw, han, scheme) {
    const h = clean(raw);
    const chars = [...String(han).replace(/\s+/g, '')];
    const data = Math.max(0, chars.length - 1);
    return {
      input: h.length,
      data,
      total: chars.length,
      ratio: chars.length ? (h.length / chars.length) : 0,
      scheme: scheme || detect(han) || '—',
    };
  }

  function selfTest() {
    const fail = [];
    const rnd = n => {
      let s = '';
      for (let i = 0; i < n; i++) s += '0123456789abcdef'[(Math.random() * 16) | 0];
      return s;
    };
    const cases = ['0', '00', '000', '0000', '00000a', 'fff', 'ffff', 'fffff', 'abcdef', '0f0f0f'];
    for (let i = 0; i < 60; i++) cases.push(rnd(1 + ((Math.random() * 64) | 0)));
    for (const scheme of ['A', 'B', 'C']) {
      for (const h of cases) {
        try {
          const han = encode(h, scheme);
          const back = decode(han);
          if (back.hex !== h) fail.push(scheme + ':' + h + '→' + han + '→' + back.hex);
        } catch (e) {
          fail.push(scheme + ':' + h + ' 抛错 ' + e.message);
        }
      }
    }
    return { total: cases.length * 3, fail };
  }

  return {
    encode, decode, decodeLoose, detect, stats, selfTest,
    names: NAMES, syllables: SYL.length,
  };
})();

/* ---------------------------------------------------------------- 应用窗口 */
const HZ_SAMPLE_AES = '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4';
const HZ_SAMPLE_RSA =
  'ff9af22a404cb0b6f5ca61ce3b43dc06710f67090af32d0fbe7449bf1703ac6daa85589f69f354cdc975c14855c269a9a81a9c6e1e091312a34ce825b6ab2ec635194f543ad8e7738362be63ef86dd0f478aa01c4b38a66331ab7372d7540307f493702ccf1f1fed7c450415432d798f7ae412e1ce940e1c6ca5f62d6b7da7b9' +
  'dc1e10da03874f0c8bc3ec2774726b7e7ea314045da905d7ab76d16ea2f9b5f686edf61e6c529363141b8ae8899af2f814493a053d331d113d732cfb8f76a995f0532d28f7dea5a5c83ec4b3a382bd065a0c7ee8f4e40c793c2c989a0e1a25f3d6f36a592f46d8a3ba6f0f6e6b28fffa24fb11979b23c5778859294a77b98843';

class HanziApp {
  constructor(body, opts) {
    this.body = body;
    this.scheme = 'A';
    this._lock = false;
    this._build();
    this._bind();
    this._len();
  }

  /* 左右都是输入框：没有「输入栏 / 输出栏」的区别，改哪边另一边就跟着变 */
  _build() {
    this.body.classList.add('hz-app');
    this.body.innerHTML = `
      <div class="hz-head">
        <div class="hz-seg" role="tablist" aria-label="编码方案">
          <button type="button" data-s="A" class="on">4096 字</button>
          <button type="button" data-s="B">2048 字</button>
          <button type="button" data-s="C">按读音</button>
        </div>
        <span class="hz-badge" id="hzDetect">双向实时同步</span>
        <span class="hz-sp"></span>
        <button type="button" class="hz-mini" id="hzAes" title="AES-256 密钥 64 hex">AES-256</button>
        <button type="button" class="hz-mini" id="hzRsa" title="RSA-2048 模数 512 hex">RSA-2048</button>
      </div>
      <div class="hz-cols">
        <section class="hz-col" data-side="hex">
          <div class="hz-lab"><span>十六进制</span><em id="hzHexLen">0</em>
            <button type="button" class="hz-cp" data-cp="hex">复制</button></div>
          <textarea id="hzHex" spellcheck="false" autocapitalize="off" autocomplete="off"
            placeholder="在这里输入 hex，例如 48656c6c6f"></textarea>
          <div class="hz-stats" id="hzSt1">改哪边都行，另一边实时跟着变</div>
        </section>
        <div class="hz-mid">
          <button type="button" id="hzSwap" title="交换两侧内容" aria-label="交换两侧内容">⇄</button>
        </div>
        <section class="hz-col" data-side="han">
          <div class="hz-lab"><span>汉字</span><em id="hzHanLen">0</em>
            <button type="button" class="hz-cp" data-cp="han">复制</button></div>
          <textarea id="hzHan" spellcheck="false" autocapitalize="off" autocomplete="off"
            placeholder="也可以直接粘汉字；末尾标记字决定用哪套方案"></textarea>
          <div class="hz-stats" id="hzSt2"></div>
        </section>
      </div>`;
  }

  _bind() {
    const q = s => this.body.querySelector(s);
    this.hexEl = q('#hzHex');
    this.hanEl = q('#hzHan');
    this.st1 = q('#hzSt1');
    this.st2 = q('#hzSt2');

    this.body.querySelectorAll('.hz-seg [data-s]').forEach(b => {
      b.onclick = () => {
        this.scheme = b.dataset.s;
        this.body.querySelectorAll('.hz-seg [data-s]').forEach(x => x.classList.toggle('on', x === b));
        /* 换方案就是把左边的 hex 按新方案重新写一遍 */
        this._fromHex(true);
        this._tip(this.scheme === 'C'
          ? '读音方案：每个音节取一个同音字，解码只看读音，换同音字结果一样'
          : '解码不用选方案：末尾标记字会告诉程序这是哪一套');
      };
    });

    let t = 0;
    const deb = (fn) => { clearTimeout(t); t = setTimeout(fn, 90); };
    this.hexEl.addEventListener('input', () => { this._len(); deb(() => this._fromHex()); });
    this.hanEl.addEventListener('input', () => { this._len(); deb(() => this._fromHan()); });
    /* 粘贴要立刻反应，不等防抖 */
    this.hexEl.addEventListener('paste', () => setTimeout(() => { this._len(); this._fromHex(); }, 0));
    this.hanEl.addEventListener('paste', () => setTimeout(() => { this._len(); this._fromHan(); }, 0));

    q('#hzSwap').onclick = () => {
      const a = this.hexEl.value, b = this.hanEl.value;
      this.hexEl.value = b; this.hanEl.value = a;
      this._len();
      if (b.trim()) this._fromHex(true); else this._fromHan(true);
    };
    this.body.querySelectorAll('[data-cp]').forEach(b => {
      b.onclick = async () => {
        const v = (b.dataset.cp === 'hex' ? this.hexEl : this.hanEl).value.trim();
        if (!v) { toast('这一侧还没有内容', 'warn'); return; }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(v);
          else {
            const ta = document.createElement('textarea');
            ta.value = v; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
          }
          toast('已复制 ' + v.length + ' 个字符');
        } catch (e) { toast('复制失败：' + (e && e.message || e), 'warn'); }
      };
    });
    q('#hzAes').onclick = () => this._fill(HZ_SAMPLE_AES);
    q('#hzRsa').onclick = () => this._fill(HZ_SAMPLE_RSA);
  }

  _fill(v) {
    this.hexEl.value = v;
    this._len();
    this._fromHex(true);
  }

  _len() {
    const q = s => this.body.querySelector(s);
    const n1 = this.hexEl.value.replace(/\s+/g, '').length;
    const n2 = this.hanEl.value.replace(/\s+/g, '').length;
    q('#hzHexLen').textContent = n1;
    q('#hzHanLen').textContent = n2;
    const d = HanziCodec.detect(this.hanEl.value);
    const badge = q('#hzDetect');
    badge.textContent = d ? ('识别为 ' + HanziCodec.names[d]) : '双向实时同步';
    badge.classList.toggle('on', !!d);
    /* 汉字侧识别出方案后，顶部那三个选项卡必须跟着切过去——
     * 否则「识别为 2048 字」和亮着的「4096 字」自相矛盾。 */
    if (d && d !== this.scheme) {
      this.scheme = d;
      this.body.querySelectorAll('.hz-seg [data-s]').forEach(x => x.classList.toggle('on', x.dataset.s === d));
    }
  }

  _tip(msg) {
    const el = this.body.querySelector('#hzTip');
    if (el) el.textContent = msg || '';
  }

  /* 右边输出区（其实是 textarea）整体换内容 */
  _setHan(v) {
    if (this.hanEl.value === v) return;
    this.hanEl.value = v;
  }
  _setHex(v) {
    if (this.hexEl.value === v) return;
    this.hexEl.value = v;
  }

  _mark(el, bad, msg) {
    el.classList.toggle('bad', !!bad);
    if (!bad) return;
    const box = el === this.hexEl ? this.st1 : this.st2;
    box.innerHTML = '<b class="bad" style="color:var(--amber)">⚠ ' + esc(msg) + '</b>';
  }

  /* 由 hex 推汉字 */
  _fromHex(force) {
    if (this._lock) return;
    const raw = this.hexEl.value;
    if (!raw.trim()) {
      this._lock = true;
      this._setHan('');
      this._lock = false;
      this.hexEl.classList.remove('bad');
      this.st1.textContent = '改哪边都行，另一边实时跟着变';
      this.st2.textContent = '';
      this._tip('');
      return;
    }
    try {
      this._lock = true;
      const han = HanziCodec.encode(raw, this.scheme, this.hanEl.value);
      this._setHan(han);
      this._lock = false;
      this.hexEl.classList.remove('bad');
      this._paintBoth(raw, han, this.scheme, true);
      this._tip(this.scheme === 'C'
        ? '同音字随机取；解码只还原读音，结果与原文等效'
        : '已经按 ' + HanziCodec.names[this.scheme] + ' 编码');
    } catch (e) {
      this._lock = false;
      this._mark(this.hexEl, true, e.message);
      this.st2.textContent = '';
      this._tip('');
    }
  }

  /* 由汉字推 hex */
  _fromHan(force) {
    if (this._lock) return;
    const han = this.hanEl.value;
    if (!han.trim()) {
      this._lock = true;
      this._setHex('');
      this._lock = false;
      this.hanEl.classList.remove('bad');
      this.st2.textContent = '';
      this.st1.textContent = '改哪边都行，另一边实时跟着变';
      this._tip('');
      return;
    }
    try {
      this._lock = true;
      const d = HanziCodec.detect(han);
      const r = d ? HanziCodec.decode(han) : HanziCodec.decodeLoose(han, this.scheme);
      this._setHex(r.hex);
      this._lock = false;
      this.hanEl.classList.remove('bad');
      this._paintBoth(r.hex, han, r.scheme, false);
      this._tip(d
        ? '识别为 ' + HanziCodec.names[r.scheme] + '，还原 ' + r.hex.length + ' 个 hex 字符'
        : '没有末尾标记字，按当前方案「' + HanziCodec.names[r.scheme] + '」直接解；加标记字可自动识别');
    } catch (e) {
      this._lock = false;
      this._mark(this.hanEl, true, e.message);
      this.st1.textContent = '';
      this._tip('');
    }
  }

  /* 两侧的统计各自算，互不覆盖 */
  _paintBoth(hex, han, scheme, fromHex) {
    const st = HanziCodec.stats(hex, han, scheme);
    const chars = [...String(han).replace(/\s+/g, '')].length;
    const marked = !!HanziCodec.detect(han);
    const data = Math.max(0, chars - (marked ? 1 : 0));
    const ratio = chars ? (st.input / chars).toFixed(2) + ':1' : '—';
    this.st1.innerHTML = `输入 <b>${st.input}</b> hex · 方案 <b>${scheme}</b>`;
    this.st2.innerHTML = `数据字 <b>${data}</b> · ` +
      (marked ? `含标记 <b>${chars}</b>` : `无标记字`) +
      ` · 压缩比 <b>${ratio}</b>`;
    this._len();
  }


}
