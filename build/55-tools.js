/* ============================================================================
 * HTerMinaL · tools: 计算器 / 截屏 / Markdown / 维护中的壳子
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这一层只做「窗口里的工具」，不碰文件系统语义（那是 30-core）也不碰 shell（25-compat）。
 * 所有工具都遵守三条：
 *   1) 只用浏览器自带能力，不引第三方库（Markdown 除外，marked 已在许可证清单里）；
 *   2) 只用 CSS token，不写死颜色，浅色主题自动跟随；
 *   3) 不承诺做不到的事 —— 做不到就做成壳子并写明原因，而不是假装能用。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 共用小工具 */
const ToolKit = {
  async copy(text, okMsg) {
    const s = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(s);
      } else {
        /* file:// 或没授权时 clipboard 是 undefined，退回 execCommand —— 它还能用 */
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(okMsg || '已复制');
      return true;
    } catch (e) {
      toast('复制失败：' + (e && e.message || e), true);
      return false;
    }
  },
  bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 2 : 1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  },
  /** dataURL → Uint8Array（不用 fetch，省一次异步跳转） */
  dataUrlBytes(url) {
    const s = String(url || '');
    const i = s.indexOf(',');
    if (i < 0) return new Uint8Array(0);
    const head = s.slice(0, i), body = s.slice(i + 1);
    if (!/;base64/i.test(head)) {
      return new TextEncoder().encode(decodeURIComponent(body));
    }
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  },
  mimeOf(url) {
    const m = /^data:([^;,]+)/i.exec(String(url || ''));
    return m ? m[1] : 'application/octet-stream';
  },
  /** 给每个窗口一个「复制」按钮的统一写法 */
  bindCopies(root) {
    root.querySelectorAll('[data-copy]').forEach(b => {
      b.onclick = () => {
        const sel = b.dataset.copy;
        const src = sel ? root.querySelector(sel) : null;
        const val = src ? (src.value !== undefined ? src.value : src.textContent) : (b.dataset.copyText || '');
        ToolKit.copy(val);
      };
    });
  }
};

/* ---------------------------------------------------------------- 两个通用对话框
 * 项目里到处都要「要一个名字」「从 .home 挑一个文件」，但一直没有统一写法，
 * 于是每个应用各写一套。这两个函数就是补这个洞。 */
function modalPrompt(title, def, hint) {
  return modal({
    title,
    body: `<input class="tl-in" id="mpIn" style="width:100%" spellcheck="false"
      value="${esc(def == null ? '' : def)}" placeholder="${esc(hint || '')}">`,
    buttons: [
      { label:'取消', value:null },
      { label:'确定', primary:true, onClick:(wrap) => {
          const v = wrap.querySelector('#mpIn').value.trim();
          return v || null;
        } }
    ],
    onMount: (wrap) => {
      const inp = wrap.querySelector('#mpIn');
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); wrap.querySelector('.mfoot .btn.primary').click(); }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 40);
    }
  });
}

async function pickFileInFs(opts) {
  opts = opts || {};
  const dir = normPath(opts.dir || '.home');
  let rows = [];
  try { rows = await FS.list(dir); } catch (e) { rows = []; }
  const items = rows.filter(r => r.kind !== 'dir' && (!opts.filter || opts.filter(r.name, r)));
  if (!items.length) {
    toast('这个目录里没有可选的文件');
    return null;
  }
  return await modal({
    title: opts.title || ('选择文件（' + dir + '）'),
    body: `<select class="tl-in" id="pfSel" style="width:100%">` +
      items.map(r => `<option value="${esc(r.path)}">${esc(r.name)} · ${ToolKit.bytes(r.size)}</option>`).join('') +
      `</select>`,
    buttons: [
      { label:'取消', value:null },
      { label:'打开', primary:true, onClick:(wrap) => wrap.querySelector('#pfSel').value }
    ]
  });
}

/* ============================================================================
 * 1. 科学计算器
 *
 * 不用 eval：表达式要能解释「为什么错」，而且 eval 会把 `alert(1)` 当合法输入。
 * 这里走递归下降，文法很小但完整：
 *   expr    := term (('+'|'-') term)*
 *   term    := unary (('*'|'/'|'%') unary)*
 *   unary   := ('+'|'-') unary | power
 *   power   := postfix ('^' unary)?          右结合：2^3^2 = 512
 *   postfix := primary ('!')*
 *   primary := number | const | func '(' args ')' | '(' expr ')'
 * ==========================================================================*/
const CalcFn = {
  /* 一元函数表。角度/弧度只影响三角与反三角，逻辑集中在 CalcApp._applyAngle。 */
  'sin': Math.sin, 'cos': Math.cos, 'tan': Math.tan,
  'asin': Math.asin, 'acos': Math.acos, 'atan': Math.atan,
  'sinh': Math.sinh, 'cosh': Math.cosh, 'tanh': Math.tanh,
  'asinh': Math.asinh, 'acosh': Math.acosh, 'atanh': Math.atanh,
  'ln': Math.log, 'log': Math.log10, 'log2': Math.log2, 'lg': Math.log10,
  'exp': Math.exp, 'sqrt': Math.sqrt, 'cbrt': Math.cbrt,
  'abs': Math.abs, 'round': Math.round, 'floor': Math.floor,
  'ceil': Math.ceil, 'trunc': Math.trunc, 'sign': Math.sign,
  'deg': (x) => x * 180 / Math.PI, 'rad': (x) => x * Math.PI / 180
};
const CalcConst = { 'pi': Math.PI, 'e': Math.E, 'tau': Math.PI * 2, 'phi': (1 + Math.sqrt(5)) / 2 };

class CalcParser {
  constructor(src, angle) {
    this.src = String(src || '');
    this.angle = angle === 'deg' ? 'deg' : 'rad';
    this.i = 0;
    this.toks = this._lex();
    this.p = 0;
  }
  _lex() {
    /* 先做显示层替换：键盘上打不出来 × ÷ − π √，按钮打的是这些字符 */
    const s = this.src
      .replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/[−–—]/g, '-')
      .replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/，/g, ',')
      .replace(/。/g, '.');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new Error('数字写错了：' + s.slice(i, i + 8));
        out.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
        out.push({ t: 'id', v: m[0].toLowerCase() });
        i += m[0].length;
        continue;
      }
      if ('+-*/^%!(),'.includes(c)) { out.push({ t: c }); i++; continue; }
      throw new Error('不认识的字符：' + c);
    }
    out.push({ t: 'eof' });
    return out;
  }
  peek() { return this.toks[this.p]; }
  eat(t) {
    if (this.toks[this.p].t === t) { this.p++; return true; }
    return false;
  }
  expect(t, msg) {
    if (!this.eat(t)) throw new Error(msg || ('这里应该是 ' + t));
  }
  run() {
    if (this.peek().t === 'eof') throw new Error('还没有输入');
    const v = this.expr();
    if (this.peek().t !== 'eof') throw new Error('多余的内容：' + this._show(this.peek()));
    if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('结果不是数字');
    return v;
  }
  _show(tk) { return tk.t === 'num' ? tk.v : tk.t === 'id' ? tk.v : tk.t; }

  expr() {
    let v = this.term();
    for (;;) {
      if (this.eat('+')) v += this.term();
      else if (this.eat('-')) v -= this.term();
      else return v;
    }
  }
  term() {
    let v = this.unary();
    for (;;) {
      if (this.eat('*')) v *= this.unary();
      else if (this.eat('/')) {
        const d = this.unary();
        if (d === 0) throw new Error('除数是 0');
        v /= d;
      } else if (this.eat('%')) {
        const d = this.unary();
        if (d === 0) throw new Error('除数是 0');
        v %= d;
      } else return v;
    }
  }
  unary() {
    if (this.eat('-')) return -this.unary();
    if (this.eat('+')) return this.unary();
    return this.power();
  }
  power() {
    const base = this.postfix();
    if (this.eat('^')) return Math.pow(base, this.unary());   // 右结合
    return base;
  }
  postfix() {
    let v = this.primary();
    while (this.eat('!')) {
      if (!Number.isInteger(v) || v < 0) throw new Error('阶乘只支持非负整数');
      if (v > 170) throw new Error('阶乘太大（>170 就溢出了）');
      let r = 1;
      for (let k = 2; k <= v; k++) r *= k;
      v = r;
    }
    return v;
  }
  primary() {
    const tk = this.peek();
    if (tk.t === 'num') { this.p++; return tk.v; }
    if (this.eat('(')) {
      const v = this.expr();
      this.expect(')', '括号没有闭合');
      return v;
    }
    if (tk.t === 'id') {
      this.p++;
      const name = tk.v;
      if (this.eat('(')) {
        const args = [];
        if (this.peek().t !== ')') {
          args.push(this.expr());
          while (this.eat(',')) args.push(this.expr());
        }
        this.expect(')', '函数参数没有闭合');
        return this._call(name, args);
      }
      if (name in CalcConst) return CalcConst[name];
      /* 允许 sin30 这种写法（计算器上很常见），但只对一元函数开放 */
      if (name in CalcFn) {
        const v = this.unary();
        return this._call(name, [v]);
      }
      throw new Error('不认识的名字：' + name);
    }
    throw new Error('表达式不完整');
  }
  _call(name, args) {
    if (name === 'pow') return Math.pow(args[0], args[1]);
    if (name === 'nroot') return Math.sign(args[1]) * Math.pow(Math.abs(args[1]), 1 / args[0]);
    if (name === 'max') return Math.max(...args);
    if (name === 'min') return Math.min(...args);
    if (name === 'atan2') return Math.atan2(args[0], args[1]);
    if (name === 'log') { /* log(x) 常用底 10；log(b,x) 指定底 */
      if (args.length === 2) return Math.log(args[1]) / Math.log(args[0]);
      return Math.log10(args[0]);
    }
    const fn = CalcFn[name];
    if (!fn) throw new Error('不认识的函数：' + name);
    if (args.length !== 1) throw new Error(name + ' 只接受 1 个参数');
    const trig = /^(sin|cos|tan)$/.test(name);
    const atrig = /^(asin|acos|atan|atan2)$/.test(name);
    if (trig && this.angle === 'deg') return fn(args[0] * Math.PI / 180);
    if (atrig && this.angle === 'deg') return fn(args[0]) * 180 / Math.PI;
    return fn(args[0]);
  }
}

class CalcApp {
  constructor(container) {
    this.el = container;
    this.expr = '';
    this.res = '0';
    this.mem = 0;
    this.angle = 'rad';
    this.second = false;
    this.hist = [];
    this.err = '';
    this.el.innerHTML = `<div class="calc" tabindex="0">
      <div class="calc-disp">
        <div class="calc-expr"></div>
        <div class="calc-res">0</div>
      </div>
      <div class="calc-flags">
        <button class="tl-btn sm" data-act="deg" title="角度制 / 弧度制">RAD</button>
        <button class="tl-btn sm" data-act="2nd" title="第二功能">2nd</button>
        <span style="flex:1 1 auto"></span>
        <button class="tl-btn sm" data-act="mc" title="清除记忆">MC</button>
        <button class="tl-btn sm" data-act="mr" title="读取记忆">MR</button>
        <button class="tl-btn sm" data-act="mplus" title="加到记忆">M+</button>
        <button class="tl-btn sm" data-act="mminus" title="从记忆减">M−</button>
        <button class="tl-btn sm" data-act="help" title="说明">?</button>
      </div>
      <div class="calc-pad">
        <button class="del" data-act="clear">C</button>
        <button class="del" data-act="ce">CE</button>
        <button class="del" data-act="back">⌫</button>
        <button class="fn" data-ins="(">(</button>
        <button class="fn" data-ins=")">)</button>

        <button class="fn" data-ins="sin(" data-alt="asin(" data-alt-label="sin⁻¹">sin</button>
        <button class="fn" data-ins="cos(" data-alt="acos(" data-alt-label="cos⁻¹">cos</button>
        <button class="fn" data-ins="tan(" data-alt="atan(" data-alt-label="tan⁻¹">tan</button>
        <button class="fn" data-ins="ln(" data-alt="exp(" data-alt-label="eˣ">ln</button>
        <button class="fn" data-ins="log(" data-alt="pow(10," data-alt-label="10ˣ">log</button>

        <button class="fn" data-ins="^2" data-alt="^3" data-alt-label="x³">x²</button>
        <button class="fn" data-ins="^">xʸ</button>
        <button class="fn" data-ins="sqrt(">√</button>
        <button class="fn" data-ins="1/(" data-alt-label="1/x">1/x</button>
        <button class="fn" data-ins="!" data-alt="pi" data-alt-label="π">n!</button>

        <button data-ins="7">7</button>
        <button data-ins="8">8</button>
        <button data-ins="9">9</button>
        <button class="op" data-ins="/">÷</button>
        <button class="op" data-ins="%">%</button>

        <button data-ins="4">4</button>
        <button data-ins="5">5</button>
        <button data-ins="6">6</button>
        <button class="op" data-ins="*">×</button>
        <button class="op" data-ins="^">^</button>

        <button data-ins="1">1</button>
        <button data-ins="2">2</button>
        <button data-ins="3">3</button>
        <button class="op" data-ins="-">−</button>
        <button class="eq" data-act="eq" style="grid-row:span 2">=</button>

        <button data-ins="0">0</button>
        <button data-ins=".">.</button>
        <button class="fn" data-act="neg">±</button>
        <button class="op" data-ins="+">+</button>

        <button class="fn" data-ins="e" data-alt="tau" data-alt-label="τ">e</button>
        <button class="fn" data-ins="rand()" style="grid-column:span 4" data-act="rand">随机数</button>
      </div>
      <div class="calc-hist"></div>
    </div>`;
    this.dispExpr = $('.calc-expr', this.el);
    this.dispRes = $('.calc-res', this.el);
    this.histEl = $('.calc-hist', this.el);
    this._bind();
    this.render();
  }
  _bind() {
    const root = $('.calc', this.el);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act) this.doAct(act, b);
      else if (b.dataset.ins != null) this.ins(this.second && b.dataset.alt != null ? b.dataset.alt : b.dataset.ins);
    });
    root.addEventListener('keydown', (e) => this.onKey(e));
    root.addEventListener('focus', () => {});
    this.histEl.addEventListener('click', (e) => {
      const d = e.target.closest('div');
      if (!d) return;
      this.expr = d.dataset.e || '';
      this.res = d.dataset.r || '0';
      this.err = '';
      this.render();
    });
  }
  onKey(e) {
    const k = e.key;
    if (/^[0-9.+\-*/^%()!]$/.test(k)) { this.ins(k); e.preventDefault(); return; }
    if (k === 'Enter' || k === '=') { this.doAct('eq'); e.preventDefault(); return; }
    if (k === 'Backspace') { this.doAct('back'); e.preventDefault(); return; }
    if (k === 'Escape') { this.doAct('clear'); e.preventDefault(); return; }
    if (k === 'Delete') { this.doAct('ce'); e.preventDefault(); return; }
  }
  ins(s) {
    this.err = '';
    /* 刚按过等号又输入数字：默认开新算式；输入运算符则接着上次的结果往下算 */
    if (this.justEq) {
      if (/^[0-9.(]/.test(s)) this.expr = '';
      else this.expr = String(this.res);
      this.justEq = false;
    }
    this.expr += s;
    this.render();
  }
  doAct(act, btn) {
    if (act === 'clear') { this.expr = ''; this.res = '0'; this.err = ''; this.justEq = false; }
    else if (act === 'ce') { this.expr = ''; this.err = ''; this.justEq = false; }
    else if (act === 'back') {
      this.err = '';
      if (this.justEq) { this.justEq = false; }
      this.expr = this.expr.slice(0, -1);
    } else if (act === 'neg') {
      /* ± 不是简单加个负号：对整段表达式取负更符合直觉 */
      this.expr = this.expr ? '-(' + this.expr + ')' : '-';
      this.justEq = false;
    } else if (act === 'deg') {
      this.angle = this.angle === 'deg' ? 'rad' : 'deg';
      btn.textContent = this.angle === 'deg' ? 'DEG' : 'RAD';
      btn.classList.toggle('on', this.angle === 'deg');
      this.preview();
    } else if (act === '2nd') {
      this.second = !this.second;
      btn.classList.toggle('on', this.second);
      this.applySecond();
    } else if (act === 'mc') { this.mem = 0; toast('记忆已清除'); }
    else if (act === 'mr') { this.ins(String(this.mem)); }
    else if (act === 'mplus' || act === 'mminus') {
      const v = this._valueNow();
      if (v != null) { this.mem += act === 'mplus' ? v : -v; toast('记忆 = ' + this.fmt(this.mem)); }
    } else if (act === 'rand') { this.ins(String(Math.random().toFixed(8))); }
    else if (act === 'help') this.help();
    else if (act === 'eq') this.equals();
    this.render();
  }
  applySecond() {
    this.el.querySelectorAll('[data-alt]').forEach(b => {
      const main = b.dataset.main || b.textContent;
      if (!b.dataset.main) b.dataset.main = main;
      b.textContent = this.second ? (b.dataset.altLabel || b.dataset.alt) : b.dataset.main;
    });
  }
  _valueNow() {
    try { return new CalcParser(this.expr || this.res, this.angle).run(); }
    catch (e) { return null; }
  }
  preview() {
    if (!this.expr) return;
    try {
      const v = new CalcParser(this.expr, this.angle).run();
      this.res = this.fmt(v);
      this.err = '';
    } catch (e) { /* 还没输完是常态，静默 */ }
  }
  equals() {
    if (!this.expr.trim()) return;
    try {
      const v = new CalcParser(this.expr, this.angle).run();
      const r = this.fmt(v);
      this.res = r;
      this.err = '';
      this.justEq = true;
      this.hist.unshift({ e: this.expr, r });
      if (this.hist.length > 40) this.hist.length = 40;
      this.renderHist();
    } catch (e) {
      this.err = e.message || String(e);
      this.justEq = false;
    }
  }
  fmt(v) {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : (v < 0 ? '−∞' : '不是数字');
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e15 || a < 1e-9) {
      return v.toExponential(10).replace(/\.?0+e/, 'e').replace('e+', 'e');
    }
    /* 12 位有效数字：够科学计算，又不会把 0.1+0.2 的尾巴露出来 */
    let s = parseFloat(v.toPrecision(12)).toString();
    return s;
  }
  renderHist() {
    this.histEl.innerHTML = this.hist.map(h =>
      `<div data-e="${esc(h.e)}" data-r="${esc(h.r)}">${esc(h.e)} = <b style="color:var(--fg-dim)">${esc(h.r)}</b></div>`
    ).join('') || '<div style="opacity:.5;cursor:default">还没有计算记录</div>';
  }
  render() {
    this.dispExpr.textContent = this.expr || '';
    if (this.err) {
      this.dispRes.textContent = this.err;
      this.dispRes.classList.add('small');
      this.dispRes.style.color = 'var(--red)';
    } else {
      /* 实时预览：输入过程中就显示结果，等号只是把结果记账 */
      let shown = this.res;
      if (!this.justEq) {
        try {
          if (this.expr.trim()) shown = this.fmt(new CalcParser(this.expr, this.angle).run());
          else shown = '0';
        } catch (e) { shown = this.res; }
      }
      this.dispRes.textContent = shown;
      this.dispRes.style.color = '';
      this.dispRes.classList.toggle('small', String(shown).length > 16);
    }
    if (!this.histEl.dataset.done) { this.renderHist(); this.histEl.dataset.done = '1'; }
    this.memBadge();
  }
  memBadge() {
    const b = this.el.querySelector('[data-act="mr"]');
    if (b) b.classList.toggle('on', this.mem !== 0);
  }
  help() {
    modal({
      title: '计算器说明',
      body: `<div class="tl-note" style="font-size:11.5px">
        <p><b>输入</b>：点按钮，或直接敲键盘（0-9 . + - * / ^ % ( ) !，Enter 求值，Esc 清空）。</p>
        <p><b>语法</b>：<code>2^3^2</code> 右结合 = 512；<code>5!</code> 阶乘；<code>sin(30)</code> 默认弧度，
        按 RAD/DEG 切换；<code>log(2,8)</code> 指定底数；<code>pow(2,10)</code>、<code>max(1,2)</code> 支持多参数。</p>
        <p><b>为什么不用 eval</b>：这里的表达式是给人按的，报错要说人话；eval 还会把 <code>alert(1)</code> 当合法输入。</p>
        <p><b>精度</b>：双精度浮点，12 位有效数字显示。<code>0.1+0.2</code> 显示 0.3，但内部仍是二进制浮点；
        超过 2^53 的整数会丢精度 —— 要精确大整数请用「数据」工具的十进制转换。</p>
      </div>`,
      buttons: [{ label: '知道了', primary: true }]
    });
  }
}

/* ============================================================================
 * 2. 网页内截屏
 * ==========================================================================*/
class ShotApp {
  constructor(container) {
    this.el = container;
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd"><b style="letter-spacing:.08em;font-size:10.5px;color:var(--fg-mute)">截图</b>
        <span style="flex:1 1 auto"></span>
        <button class="tl-btn sm" data-a="edit" disabled title="在图看窗口里裁剪 / 标注 / 打码">编辑</button>
        <button class="tl-btn sm" data-a="shot">截取</button>
      </div>
      <div class="tl-body">
        <div class="tl-card">
          <div class="tl-row"><label>目标</label>
            <select class="tl-in" data-f="target" style="flex:1 1 auto"></select></div>
          <div class="tl-row"><label>缩放</label>
            <select class="tl-in" data-f="scale">
              <option value="1">1×（最小最快）</option>
              <option value="2" selected>2×（推荐）</option>
              <option value="3">3×（细节）</option>
            </select>
            <label style="flex:0 0 auto">格式</label>
            <select class="tl-in" data-f="type">
              <option value="image/png" selected>PNG</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/webp">WebP</option>
            </select></div>
          <div class="tl-row"><label>延迟</label>
            <input class="tl-in" type="number" data-f="delay" value="0" min="0" max="10000" step="100" style="width:88px">
            <span class="tl-note">毫秒，给动画/懒加载留时间</span></div>
          <div class="tl-row"><label>选项</label>
            <label class="tl-chk"><input type="checkbox" data-f="hide">
              <span>截图时隐藏本窗口</span></label>
            <span class="tl-note">拍桌面时不会把截图工具自己拍进去</span></div>
        </div>
        <div class="shot-stage" data-f="stage"><span class="tl-note">还没有截图。点右上角「截取」。</span></div>
        <div class="tl-row" style="margin-top:8px">
          <button class="tl-btn" data-a="save" disabled>存到 .home</button>
          <button class="tl-btn" data-a="down" disabled>下载</button>
          <button class="tl-btn" data-a="copy" disabled>复制为图片</button>
          <span class="tl-note" data-f="meta"></span>
        </div>
        <div class="tl-note" style="margin-top:6px">
          用的是 html2canvas（把 DOM 重绘成 canvas），不是系统截屏：不需要授权，
          但 <b>iframe 里的内容拍不到</b>（跨文档读不到样式），视频/WebGL 也可能缺失。
          要连 iframe 一起拍，只能走系统的「共享屏幕」。
        </div>
      </div>
    </div>`;
    this.url = '';
    this.fillTargets();
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'shot') this.shoot();
      else if (b.dataset.a === 'edit') this.edit();
      else if (b.dataset.a === 'save') this.save();
      else if (b.dataset.a === 'down') this.download();
      else if (b.dataset.a === 'copy') this.copyImg();
    });
  }
  fillTargets() {
    const sel = $('[data-f="target"]', this.el);
    const wins = WindowManager.list();
    sel.innerHTML = '<option value="desk">整个桌面</option>' +
      '<option value="doc">整个文档（含滚动区）</option>' +
      wins.map(w => `<option value="win:${esc(w.id)}">窗口：${esc(w.title)}</option>`).join('');
  }
  async shoot() {
    const btn = $('[data-a="shot"]', this.el);
    btn.disabled = true;
    btn.textContent = '截取中…';
    const delay = Math.max(0, Math.min(10000, Number($('[data-f="delay"]', this.el).value) || 0));
    const selfWin = this.el.closest('.win');
    let hidden = false;
    try {
      if (delay) await new Promise(r => setTimeout(r, delay));
      const t = $('[data-f="target"]', this.el).value;
      const wantHide = $('[data-f="hide"]', this.el).checked;
      /* 目标是本窗口时不隐藏：那会拍出一张空图 */
      const targetIsSelf = selfWin && t === 'win:' + selfWin.dataset.id;
      if (wantHide && selfWin && !targetIsSelf) {
        selfWin.style.visibility = 'hidden';
        hidden = true;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      let el = null;
      if (t === 'desk') el = document.getElementById('desk') || document.body;
      else if (t === 'doc') el = document.body;
      else if (t.startsWith('win:')) {
        const w = WindowManager.windows.get(t.slice(4));
        el = w && w.el;
      }
      if (!el) throw new Error('目标窗口已经不在了');
      this.url = await shot(el, {
        scale: Number($('[data-f="scale"]', this.el).value) || 1,
        type: $('[data-f="type"]', this.el).value,
        quality: 0.92
      });
      const img = new Image();
      img.src = this.url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const stage = $('[data-f="stage"]', this.el);
      stage.innerHTML = '';
      stage.appendChild(img);
      $('[data-f="meta"]', this.el).textContent =
        img.naturalWidth + '×' + img.naturalHeight + ' · ' + ToolKit.bytes(this.url.length * 0.75 | 0);
      ['save', 'down', 'copy', 'edit'].forEach(a => { $('[data-a="' + a + '"]', this.el).disabled = false; });
    } catch (e) {
      toast('截图失败：' + (e && e.message || e), true);
    } finally {
      if (hidden && selfWin) selfWin.style.visibility = '';
      btn.disabled = false;
      btn.textContent = '截取';
    }
  }
  _name(ext) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `shot-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  }
  async save() {
    if (!this.url) return;
    const ext = (this.url.match(/^data:image\/(\w+)/) || [])[1] || 'png';
    const name = spotEscape(this._name(ext === 'jpeg' ? 'jpg' : ext));
    try {
      const bytes = ToolKit.dataUrlBytes(this.url);
      const p = uniquePathIn('.home', name);
      await FS.write(p, bytes, { mime: ToolKit.mimeOf(this.url), hint: name, origin:'shot' });
      toast('已保存到 ' + p);
    } catch (e) { toast('保存失败：' + (e && e.message || e), true); }
  }
  download() {
    if (!this.url) return;
    const ext = (this.url.match(/^data:image\/(\w+)/) || [])[1] || 'png';
    downloadBlob(this._name(ext === 'jpeg' ? 'jpg' : ext), new Blob([ToolKit.dataUrlBytes(this.url)], { type: ToolKit.mimeOf(this.url) }));
  }
  async copyImg() {
    if (!this.url) return;
    try {
      const blob = new Blob([ToolKit.dataUrlBytes(this.url)], { type: ToolKit.mimeOf(this.url) });
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast('已复制图片');
    } catch (e) { toast('这个浏览器不让写图片剪贴板，请用「下载」', true); }
  }
  /* 拍完直接送去修：截图窗口不自己做编辑，免得两套撤销栈 */
  edit() {
    if (!this.url) return;
    const ext = (this.url.match(/^data:image\/(\w+)/) || [])[1] || 'png';
    WindowManager.open({
      type:'image', dataUrl:this.url, title:'看图 · 截图',
      name:this._name(ext === 'jpeg' ? 'jpg' : ext)
    });
  }
}

/* ============================================================================
 * 3. Markdown 渲染
 *
 * marked 是许可证清单里的依赖（MIT），懒加载；加载不到时退到自带的迷你渲染器。
 * 渲染结果一律过 sanitizeHtml：Markdown 常常来自别人（AI、拖进来的文件），
 * 直接 innerHTML 等于给 XSS 开门。
 * ==========================================================================*/
const MD_URLS = [
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://unpkg.com/marked@12.0.2/marked.min.js'
];
let _marked = null;
let _markedP = null;
let _markedFailAt = 0;
async function ensureMarked() {
  if (_marked || window.marked) { _marked = window.marked; return _marked; }
  /* 记住「正在加载」这件事本身。
   * 不记的话，每敲一个字都会重新发起一次 CDN 请求 —— 首次加载慢的时候，
   * 侧边预览会一直停在旧内容上，而网络面板在刷请求。 */
  if (_markedP) return _markedP;
  if (_markedFailAt && Date.now() - _markedFailAt < 60000) throw new Error('marked 暂时不可用（1 分钟内不再重试）');
  _markedP = (async () => {
    let last;
    for (const u of MD_URLS) {
      try {
        await loadScriptCached(u);
        if (window.marked) { _marked = window.marked; return _marked; }
      } catch (e) { last = e; }
    }
    _markedFailAt = Date.now();
    throw last || new Error('marked 加载失败');
  })();
  try { return await _markedP; }
  finally { _markedP = null; }
}

/* 白名单清洗：只留排版标签，on* 一律砍掉，javascript: 一律砍掉。 */
const MD_ALLOW = new Set(['a','abbr','b','blockquote','br','code','del','details','div','em','figcaption','figure',
  'h1','h2','h3','h4','h5','h6','hr','i','img','input','kbd','li','mark','ol','p','pre','s','small','span',
  'strong','sub','sup','summary','table','tbody','td','th','thead','tr','ul']);
const MD_ATTR = new Set(['href','src','alt','title','class','align','colspan','rowspan','type','checked','disabled','start']);
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString('<div id="r">' + String(html || '') + '</div>', 'text/html');
  const root = doc.getElementById('r');
  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (!MD_ALLOW.has(tag)) {
        /* 危险标签整棵丢掉；其它不认识的标签剥壳留文字 */
        if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'link' || tag === 'meta') {
          child.remove();
          continue;
        }
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const v = String(a.value || '');
        if (!MD_ATTR.has(n) || n.startsWith('on')) { child.removeAttribute(a.name); continue; }
        if ((n === 'href' || n === 'src') && /^\s*(javascript|data:text\/html|vbscript):/i.test(v)) {
          child.removeAttribute(a.name);
        }
      }
      if (tag === 'a') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

/* 迷你渲染器：只认标题/列表/代码/引用/粗斜体/链接，够看懂，不追求完整 */
function miniMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false, list = null, para = [];
  const flushP = () => {
    if (!para.length) return;
    out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  for (const ln of lines) {
    if (/^```/.test(ln.trim())) {
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { flushP(); closeList(); out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(esc(ln) + '\n'); continue; }
    if (!ln.trim()) { flushP(); closeList(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) { flushP(); closeList(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
    if (/^\s*[-*+]\s+/.test(ln)) {
      flushP();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inline(ln.replace(/^\s*[-*+]\s+/, '')) + '</li>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(ln)) {
      flushP();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inline(ln.replace(/^\s*\d+\.\s+/, '')) + '</li>');
      continue;
    }
    if (/^>\s?/.test(ln)) { flushP(); closeList(); out.push('<blockquote>' + inline(ln.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
    if (/^(-{3,}|\*{3,})$/.test(ln.trim())) { flushP(); closeList(); out.push('<hr>'); continue; }
    para.push(ln.trim());
  }
  flushP(); closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

class MdApp {
  constructor(container, opts) {
    this.el = container;
    this.path = (opts && opts.path) || null;
    this.el.innerHTML = `<div class="tl" style="padding:0">
      <div class="tl-hd">
        <div class="tl-tabs">
          <button class="tl-tab on" data-mode="split">分栏</button>
          <button class="tl-tab" data-mode="edit">编辑</button>
          <button class="tl-tab" data-mode="view">预览</button>
        </div>
        <button class="tl-btn sm" data-a="open">打开</button>
        <button class="tl-btn sm" data-a="save">保存</button>
        <button class="tl-btn sm" data-a="html">导出 HTML</button>
        <button class="tl-btn sm" data-a="md">下载 .md</button>
        <span class="tl-note" data-f="st"></span>
      </div>
      <div class="tl-body" style="padding:0">
        <div class="tl-split" data-f="split" style="padding:9px">
          <div class="tl-pane"><textarea class="tl-in" data-f="src" spellcheck="false" placeholder="# 在这里写 Markdown&#10;&#10;左边编辑，右边实时渲染。也可以「打开」.home 里的 .md 文件。"></textarea></div>
          <div class="tl-pane"><div class="tl-prev" data-f="out"></div></div>
        </div>
      </div>
    </div>`;
    this.src = $('[data-f="src"]', this.el);
    this.out = $('[data-f="out"]', this.el);
    this.split = $('[data-f="split"]', this.el);
    this._t = null;
    this.src.addEventListener('input', () => this.schedule());
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) { this.setMode(b.dataset.mode); return; }
      const a = b.dataset.a;
      if (a === 'open') this.openFile();
      else if (a === 'save') this.saveFile();
      else if (a === 'html') this.exportHtml();
      else if (a === 'md') this.downloadMd();
    });
    if (this.path) this.loadPath(this.path);
    else this.setDoc('# Markdown\n\n左边写，右边看。支持标题、列表、表格、代码块、引用、图片、链接。\n\n> 渲染结果会过一遍白名单清洗：`<script>`、`onclick=`、`javascript:` 一律删掉。\n\n```js\n1 + 1\n```\n');
  }
  setMode(m) {
    this.el.querySelectorAll('.tl-tab').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    const [l, r] = this.split.children;
    l.style.display = m === 'view' ? 'none' : '';
    r.style.display = m === 'edit' ? 'none' : '';
    this.split.style.gridTemplateColumns = m === 'split' ? '1fr 1fr' : '1fr';
    this.render();
  }
  setDoc(text) {
    this.src.value = text;
    this.render();
  }
  schedule() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.render(), 180);
  }
  async render() {
    const text = this.src.value;
    const seq = (this._seq = (this._seq || 0) + 1);
    let html;
    try {
      const marked = await ensureMarked();
      marked.setOptions({ gfm: true, breaks: true });
      html = marked.parse(text);
    } catch (e) {
      html = miniMarkdown(text);
    }
    /* 渲染是异步的（要等 marked），打字快的时候会有好几个在飞。
     * 只让最后一个落地，否则旧内容可能盖掉新内容。 */
    if (seq !== this._seq) return;
    this.out.innerHTML = sanitizeHtml(html);
    $('[data-f="st"]', this.el).textContent = text.length + ' 字符 · ' + text.split('\n').length + ' 行';
  }
  loadPath(p) {
    FS.read(p).then(r => {
      this.path = p;
      this.setDoc(typeof r.content === 'string' ? r.content : new TextDecoder().decode(r.content));
      if (this.onTitle) this.onTitle(baseName(p));
    }).catch(e => toast('打开失败：' + (e && e.message || e), true));
  }
  async openFile() {
    const p = await pickFileInFs({ title:'选择 Markdown 文件', filter:(n) => /\.(md|markdown|txt)$/i.test(n) });
    if (p) this.loadPath(p);
  }
  async saveFile() {
    let p = this.path;
    if (!p) {
      const name = await modalPrompt('保存为', 'untitled.md');
      if (!name) return;
      p = uniquePathIn('.home', spotEscape(name));
    }
    try {
      await FS.write(p, this.src.value, { mime:'text/markdown;charset=utf-8', hint:baseName(p) });
      this.path = p;
      toast('已保存 ' + p);
    } catch (e) { toast('保存失败：' + (e && e.message || e), true); }
  }
  exportHtml() {
    const body = this.out.innerHTML;
    const html = '<!DOCTYPE html>\n<meta charset="utf-8">\n<title>' +
      esc(baseName(this.path || 'markdown')) + '</title>\n<style>body{max-width:760px;margin:40px auto;padding:0 20px;' +
      'font:16px/1.75 system-ui,sans-serif;color:#1b2422}pre{background:#f4f6f5;padding:12px;border-radius:8px;overflow:auto}' +
      'code{background:#f0f3f2;padding:.1em .35em;border-radius:4px}blockquote{border-left:3px solid #9ac;margin:1em 0;' +
      'padding:.2em 1em;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:5px 9px}</style>\n' + body;
    saveFileRaw(spotExportName((this.path ? baseName(this.path) : 'markdown').replace(/\.[^.]+$/, '') + '.html'),
      html, 'text/html;charset=utf-8');
  }
  downloadMd() {
    const n = (this.path ? baseName(this.path) : 'untitled.md');
    saveFileRaw(spotExportName(n.endsWith('.md') ? n : n + '.md'), this.src.value, 'text/markdown;charset=utf-8');
  }
}


/* ---------------------------------------------------------------- 所有应用
 * 目录不另写一份：图标和名字直接从启动器 DOM 里取，保证两边永远一致。
 * 这里只补一句人话说明和分组。 */
const APP_DESC = {
  shell:'新开一个终端会话，独立 cwd', browser:'内嵌浏览器，可开本地页面',
  files:'文件管理器，支持拖入 / 拖出', editor:'文本编辑器，带语法高亮',
  python:'Python 交互环境（Pyodide）', agent:'智能体对话窗口',
  calc:'科学计算器，带历史', data:'Base64 / 哈希 / 编码转换',
  color:'取色、配色与对比度检查', markdown:'Markdown 编辑与预览',
  shot:'页面内截图与裁剪', image:'看图、旋转、简单标注',
  urlhash:'把界面状态编码进 URL', recorder:'录音（维护中）',
  geo:'定位（维护中）', view3d:'3D 视图（维护中）', audio:'音频播放（维护中）',
  hsb2:'WASM 里的 FreeBSD 12.0（可选）', applist:'所有应用，就是这一页',
  hanzi:'十六进制 ↔ 汉字，三种方案自动识别',
  htmlapp:'代码区用 canvas 自绘，右侧 iframe 老实渲染（不过滤脚本）。',
  timer:'秒表：计次、暂停、厘秒显示；倒计时：到点响三声。最小化后仍在计时。',
};

class AppListApp {
  constructor(body, opts) {
    this.body = body;
    this.q = '';
    this.view = Settings.get('applistView') === 'list' ? 'list' : 'grid';
    this.installed = [];
    this._build();
    this._loadInstalled();
  }

  /* 「系统预装」直接读启动器：那里是唯一一份应用清单，不另建第二份。 */
  _catalog() {
    const box = document.getElementById('launcher');
    if (!box) return [];
    return [...box.querySelectorAll('[data-app]')].map(b => {
      const type = b.dataset.app;
      const name = [...b.childNodes].filter(n => n.nodeType === 3)
        .map(n => n.textContent).join('').trim();
      const svg = b.querySelector('svg');
      return {
        type, name: name || type,
        icon: svg ? svg.outerHTML : '',
        soon: b.classList.contains('soon'),
        hint: (b.querySelector('i') || {}).textContent || '',
        desc: APP_DESC[type] || '',
      };
    });
  }

  _build() {
    this.body.classList.add('applist');
    this.body.innerHTML = `
      <div class="al-head">
        <input id="alQ" type="search" placeholder="搜索应用 / 关键字" autocomplete="off" spellcheck="false" aria-label="搜索应用">
        <span id="alCount"></span>
        <div class="al-views" role="group" aria-label="视图">
          <button data-v="grid" title="方块视图" aria-label="方块视图">▦</button>
          <button data-v="list" title="列表视图" aria-label="列表视图">☰</button>
        </div>
      </div>
      <div class="al-body" id="alBody"></div>`;
    this.body.querySelector('#alQ').addEventListener('input', e => {
      this.q = e.target.value.trim().toLowerCase();
      this._render();
    });
    this.body.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      this.view = b.dataset.v;
      Settings.set('applistView', this.view);
      this._syncView();
      this._render();
    });
    this._syncView();
    this._render();
  }

  _syncView() {
    this.body.querySelectorAll('[data-v]').forEach(b =>
      b.classList.toggle('on', b.dataset.v === this.view));
  }

  async _loadInstalled() {
    try {
      const rows = await FS.list('.app');
      /* kind=app 是内置应用的节点；剩下的才是「装进来的东西」：脚本、页面、数据。 */
      this.installed = rows.filter(r => r.kind !== 'dir' && r.kind !== 'app')
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    } catch (e) { this.installed = []; }
    this._render();
  }

  _open(type, ev) {
    const ex = [...WindowManager.windows.values()].find(w => w.type === type);
    if (ex) {
      if (ex.minimized) WindowManager.restore(ex.id);
      else WindowManager.focus(ex.id);
      return;
    }
    const r = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
    WindowManager.open({ type, from: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined });
  }

  async _runInstalled(it, ev) {
    const st = await FS.stat(it.path).catch(() => null);
    if (!st) { toast('这个应用已经不在了', true); return; }
    if (st.kind === 'func') {
      const r = await FS.read(it.path);
      const src = (r.meta && r.meta.source) || String(r.content || '');
      WindowManager.open({ type:'shell', code:src, title:'执行 · ' + spotExportName(it.name) });
      return;
    }
    const mime = String((st.meta && st.meta.mime) || '');
    if (/^image\//i.test(mime)) { WindowManager.open({ type:'image', path:it.path, title:'看图 · ' + it.name }); return; }
    if (/html/i.test(mime) || /\.html?$/i.test(it.name)) {
      const r = await FS.read(it.path);
      WindowManager.open({ type:'browser', html:String(r.content || ''), title:'执行 · ' + it.name });
      return;
    }
    WindowManager.open({ type:'editor', path:it.path, title:it.name });
  }

  /* 只改「打开 / 切换」两个字，绝不重建列表：
   * 重建会替换按钮节点，正在进行的点击会丢，滚动位置也会跳回顶部。 */
  refresh() {
    const box = this.body.querySelector('#alBody');
    if (!box) return;
    const openTypes = new Set([...WindowManager.windows.values()].map(w => w.type));
    for (const b of box.querySelectorAll('[data-t]')) {
      if (b.classList.contains('soon')) continue;
      const act = b.querySelector('.al-act');
      if (act) act.textContent = openTypes.has(b.dataset.t) ? '切换' : '打开';
    }
  }

  _render() {
    const box = this.body.querySelector('#alBody');
    if (!box) return;
    const all = this._catalog();
    const q = this.q;
    const hit = (name, desc, extra) => !q || (name + ' ' + desc + ' ' + (extra || '')).toLowerCase().includes(q);
    const pre = all.filter(a => hit(a.name, a.desc, a.type + ' ' + a.hint));
    const inst = this.installed.filter(a => hit(a.name, a.kind, a.path));
    const count = this.body.querySelector('#alCount');
    if (count) count.textContent = (pre.length + inst.length) + ' 项';

    if (!pre.length && !inst.length) { box.innerHTML = '<div class="al-empty">没有匹配的应用</div>'; return; }

    const grid = this.view === 'grid';
    const card = (a) => {
      const open = [...WindowManager.windows.values()].some(w => w.type === a.type);
      return `<button class="al-card ${a.soon ? 'soon' : ''}" data-t="${esc(a.type)}">
        <span class="al-ico">${a.icon || '▣'}</span>
        <span class="al-name">${esc(a.name)}</span>
        <span class="al-desc">${esc(a.desc)}</span>
        <span class="al-act">${a.soon ? '维护中' : (open ? '切换' : '打开')}</span>
      </button>`;
    };
    const row = (a) => {
      const open = [...WindowManager.windows.values()].some(w => w.type === a.type);
      return `<button class="al-row ${a.soon ? 'soon' : ''}" data-t="${esc(a.type)}">
        <span class="al-ico">${a.icon || '▣'}</span>
        <span class="al-name">${esc(a.name)}</span>
        <span class="al-desc">${esc(a.desc)}</span>
        <span class="al-act">${a.soon ? '维护中' : (open ? '切换' : '打开')}</span>
      </button>`;
    };
    const pack = (arr) => grid
      ? `<div class="al-grid">${arr.map(card).join('')}</div>`
      : `<div class="al-list">${arr.map(row).join('')}</div>`;

    const instCard = (a) => `<button class="al-card" data-run="${esc(a.path)}" title="${esc(a.path)}">
        <span class="al-ico">${a.kind === 'func' ? '⚙' : '▤'}</span>
        <span class="al-name">${esc(spotExportName(a.name))}</span>
        <span class="al-desc">${esc(a.path)} · ${a.size ? ToolKit.bytes(a.size) : '脚本'}</span>
        <span class="al-act">${a.kind === 'func' ? '执行' : '打开'}</span>
      </button>`;
    const instRow = (a) => `<button class="al-row" data-run="${esc(a.path)}" title="${esc(a.path)}">
        <span class="al-ico">${a.kind === 'func' ? '⚙' : '▤'}</span>
        <span class="al-name">${esc(spotExportName(a.name))}</span>
        <span class="al-desc">${esc(a.path)}</span>
        <span class="al-act">${a.kind === 'func' ? '执行' : '打开'}</span>
      </button>`;
    const packInst = (arr) => grid
      ? `<div class="al-grid">${arr.map(instCard).join('')}</div>`
      : `<div class="al-list">${arr.map(instRow).join('')}</div>`;

    box.innerHTML =
      (pre.length ? `<div class="al-sec">系统预装 · ${pre.length}</div>${pack(pre)}` : '') +
      (inst.length ? `<div class="al-sec">已安装 · ${inst.length}（来自 .app）</div>${packInst(inst)}` : '');

    box.querySelectorAll('[data-t]').forEach(b => b.onclick = e => {
      const type = b.dataset.t;
      const a = all.find(x => x.type === type);
      if (a && a.soon) { toast('「' + a.name + '」还在维护中', 'warn'); return; }
      this._open(type, e);
    });
    box.querySelectorAll('[data-run]').forEach(b => b.onclick = e => {
      const it = this.installed.find(x => x.path === b.dataset.run);
      if (it) this._runInstalled(it, e);
    });
  }
}

/* ---------------------------------------------------------------- 计时器 / 秒表
 * 两个 tab：秒表（正向、计次）与倒计时（到点响铃）。
 * 时间基准一律用 performance.now()，不用 setInterval 的累计次数——
 * 标签页被节流时，累计次数会越走越慢，而 performance.now 不会。 */
class TimerApp {
  constructor(container) {
    this.el = container;
    this.tab = 'stop';
    this.sw = { on:false, t0:0, acc:0, laps:[] };
    this.cd = { on:false, total:300000, left:300000, endAt:0, done:false };
    this._timer = 0;
    this.el.innerHTML = `
      <div class="tl">
        <div class="tl-hd">
          <div class="tl-tabs" role="tablist">
            <button class="tl-tab on" data-t="stop" role="tab">秒表</button>
            <button class="tl-tab" data-t="down" role="tab">倒计时</button>
          </div>
        </div>
        <div class="tl-body">
          <section data-p="stop">
            <div class="tm-face"><b data-f="swTime">00:00.00</b><span data-f="swState">未开始</span></div>
            <div class="tm-row">
              <button class="tl-btn primary" data-a="swGo">开始</button>
              <button class="tl-btn" data-a="swLap" disabled>计次</button>
              <button class="tl-btn" data-a="swReset">复位</button>
            </div>
            <div class="tm-laps" data-f="laps"><div class="tl-note">还没有计次。计时中点「计次」记录一圈。</div></div>
          </section>
          <section data-p="down" hidden>
            <div class="tm-face"><b data-f="cdTime">05:00</b><span data-f="cdState">就绪</span></div>
            <div class="tm-row tm-set">
              <label>时<input type="number" data-f="h" min="0" max="99" value="0"></label>
              <label>分<input type="number" data-f="m" min="0" max="59" value="5"></label>
              <label>秒<input type="number" data-f="s" min="0" max="59" value="0"></label>
            </div>
            <div class="tm-row">
              <button class="tl-btn primary" data-a="cdGo">开始</button>
              <button class="tl-btn" data-a="cdReset">复位</button>
              <span class="tl-note">快捷</span>
              <button class="tl-btn sm" data-min="60">1 分</button>
              <button class="tl-btn sm" data-min="180">3 分</button>
              <button class="tl-btn sm" data-min="300">5 分</button>
              <button class="tl-btn sm" data-min="600">10 分</button>
            </div>
            <div class="tl-note">到 0 会响三声并弹一条提示；最小化后仍然计时，关窗口才彻底停。</div>
          </section>
        </div>
      </div>`;
    this._bind();
    this._cacheEls();
    this._paint();
    /* 心跳按需起停：秒表跑着才要 50ms（厘秒要连续），倒计时 200ms 就够
     * （它只显示到秒），全停的时候一个定时器都不留。
     * 以前是无条件 setInterval(50)，开着窗口什么都不做也在每秒重建 20 次 DOM。 */
    this._timer = 0;
    this._syncTick();
  }

  _cacheEls() {
    const q = s => this.el.querySelector(s);
    this.$ = {
      swTime: q('[data-f="swTime"]'), swState: q('[data-f="swState"]'),
      swGo: q('[data-a="swGo"]'), swLap: q('[data-a="swLap"]'),
      laps: q('[data-f="laps"]'),
      cdTime: q('[data-f="cdTime"]'), cdState: q('[data-f="cdState"]'),
      cdGo: q('[data-a="cdGo"]'),
      h: q('[data-f="h"]'), m: q('[data-f="m"]'), s: q('[data-f="s"]')
    };
  }

  /* 只在文字真的变了才写 DOM。textContent 赋值即使内容相同也会产生一条
   * characterData 变更，MutationObserver / 无障碍层 / 布局都可能被惊动。 */
  _txt(el, v) { if (el && el.textContent !== v) el.textContent = v; }

  _syncTick() {
    const want = this.sw.on ? 50 : (this.cd.on ? 200 : 0);
    if (want === this._tickMs) return;
    this._tickMs = want;
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
    if (want) this._timer = setInterval(() => this._paint(), want);
  }

  _bind() {
    const q = s => this.el.querySelector(s);
    this.el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      this.tab = b.dataset.t;
      this.el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
      this.el.querySelectorAll('[data-p]').forEach(s => s.hidden = s.dataset.p !== this.tab);
      this._paint();
    });
    this.el.addEventListener('click', e => {
      const b = e.target.closest('[data-a],[data-min]');
      if (!b) return;
      if (b.dataset.min) { this._setCd(Number(b.dataset.min) * 1000); return; }
      const a = b.dataset.a;
      if (a === 'swGo') this._swToggle();
      else if (a === 'swLap') this._lap();
      else if (a === 'swReset') this._swReset();
      else if (a === 'cdGo') this._cdToggle();
      else if (a === 'cdReset') this._cdReset();
    });
    ['h', 'm', 's'].forEach(k => q('[data-f="' + k + '"]').addEventListener('input', () => {
      if (this.cd.on) return;      // 跑着的时候不让改，避免和 endAt 打架
      const h = Math.max(0, Math.min(99, Number(q('[data-f="h"]').value) || 0));
      const m = Math.max(0, Math.min(59, Number(q('[data-f="m"]').value) || 0));
      const s = Math.max(0, Math.min(59, Number(q('[data-f="s"]').value) || 0));
      this.cd.total = (h * 3600 + m * 60 + s) * 1000;
      this.cd.left = this.cd.total;
      this.cd.done = false;
      this._paint();
    }));
  }

  _swElapsed() {
    return this.sw.acc + (this.sw.on ? performance.now() - this.sw.t0 : 0);
  }
  _swToggle() {
    if (this.sw.on) { this.sw.acc = this._swElapsed(); this.sw.on = false; }
    else { this.sw.t0 = performance.now(); this.sw.on = true; }
    this._paint();
  }
  _swReset() {
    this.sw = { on:false, t0:0, acc:0, laps:[] };
    this._paint();
  }
  _lap() {
    const t = this._swElapsed();
    this.sw.laps.push(t);
    this._paint();
  }

  _cdLeft() {
    if (!this.cd.on) return Math.max(0, this.cd.left);
    return Math.max(0, this.cd.endAt - performance.now());
  }
  _cdToggle() {
    if (this.cd.left <= 0 && !this.cd.on) this.cd.left = this.cd.total;
    if (this.cd.on) { this.cd.left = this._cdLeft(); this.cd.on = false; }
    else {
      if (this.cd.left <= 0) this.cd.left = this.cd.total;
      this.cd.endAt = performance.now() + this.cd.left;
      this.cd.on = true;
      this.cd.done = false;
    }
    this._paint();
  }
  _cdReset() {
    this.cd.on = false;
    this.cd.left = this.cd.total;
    this.cd.done = false;
    this._paint();
  }
  _setCd(ms) {
    this.cd.on = false;
    this.cd.total = ms;
    this.cd.left = ms;
    this.cd.done = false;
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    const q = k => this.el.querySelector('[data-f="' + k + '"]');
    q('h').value = h; q('m').value = m; q('s').value = s;
    this._paint();
  }

  _fmtSw(ms) {
    const cs = Math.floor(ms % 1000 / 10);
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000) % 60;
    const h = Math.floor(ms / 3600000);
    const p = n => String(n).padStart(2, '0');
    return (h ? p(h) + ':' : '') + p(m) + ':' + p(s) + '.' + p(cs);
  }
  _fmtCd(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    const p = n => String(n).padStart(2, '0');
    return (h ? p(h) + ':' : '') + p(m) + ':' + p(s);
  }

  _paint() {
    const E = this.$;
    if (!E || !E.swTime || !E.swTime.isConnected) return;

    const swOn = this.sw.on, swAcc = this.sw.acc;
    this._txt(E.swTime, this._fmtSw(this._swElapsed()));
    this._txt(E.swState, swOn ? '计时中' : (swAcc ? '已暂停' : '未开始'));
    this._txt(E.swGo, swOn ? '暂停' : (swAcc ? '继续' : '开始'));
    const lapDis = !swOn;
    if (E.swLap.disabled !== lapDis) E.swLap.disabled = lapDis;

    /* 计次列表只在数量变化时重建：它是唯一会「一堆节点全换」的地方，
     * 每秒 20 次 innerHTML 换同一个内容，是之前主要的渲染风暴来源。 */
    const laps = this.sw.laps;
    if (this._lapSig !== laps.length) {
      this._lapSig = laps.length;
      E.laps.innerHTML = laps.length
        ? laps.map((t, i) => {
            const prev = i ? laps[i - 1] : 0;
            return `<div class="tm-lap"><b>#${i + 1}</b><code>${this._fmtSw(t)}</code><em>+${this._fmtSw(t - prev)}</em></div>`;
          }).reverse().join('')
        : '<div class="tl-note">还没有计次。计时中点「计次」记录一圈。</div>';
    }

    const left = this._cdLeft();
    this._txt(E.cdTime, this._fmtCd(left));
    this._txt(E.cdState, this.cd.on ? '倒计时中' : (left <= 0 ? '已结束' : (left < this.cd.total ? '已暂停' : '就绪')));
    this._txt(E.cdGo, this.cd.on ? '暂停' : (left < this.cd.total && left > 0 ? '继续' : '开始'));
    const setDis = this.cd.on;
    [E.h, E.m, E.s].forEach(x => { if (x && x.disabled !== setDis) x.disabled = setDis; });

    if (this.cd.on && left <= 0) {
      this.cd.on = false;
      this.cd.left = 0;
      if (!this.cd.done) { this.cd.done = true; this._ring(); }
    }
    this._syncTick();
  }

  _ring() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) throw new Error('no audio');
      const ac = new C();
      const t0 = ac.currentTime;
      [0, 0.24, 0.48].forEach((d) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + d + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
        o.connect(g).connect(ac.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.2);
      });
      setTimeout(() => { try { ac.close(); } catch (e) {} }, 1400);
    } catch (e) {}
    if (window.toast) toast('倒计时结束', 'warn');
    try { document.title = '⏰ 时间到 · ' + HT_VERSION; } catch (e) {}
  }

  dispose() {
    clearInterval(this._timer);
    this._timer = 0;
  }
}
