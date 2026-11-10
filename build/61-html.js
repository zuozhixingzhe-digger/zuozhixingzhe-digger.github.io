/* ============================================================================
 * HTML 编辑器与渲染器（htmlapp）
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 *
 * 两块：左边 canvas 自绘的代码区，右边真 iframe 的预览区。
 *   · 代码区不用 contenteditable / textarea 显示文字 —— 文字、行号、选区、
 *     光标全部自己画。textarea 缩成 1px 藏在光标底下，只负责接输入法
 *     （中文候选框要贴着光标，所以它得跟着光标走）。
 *   · 高亮在 Worker 里算：把 token 跑完只回一串 {s,e,k}，主线程照着上色。
 *     一屏 30 行、每行几十个 token，主线程只做 fillText，不做词法分析。
 *   · 预览是**老实渲染**：iframe 不加 sandbox，脚本照跑、同源可达。
 *     用户明确要的就是这个（"我们明确不做安全检测与过滤"）。想要隔离
 *     可以在工具栏里打开「隔离」——那是可选，不是默认。
 *
 * 和小浏览器（browser 窗口）并存：那个是上网的，这个是写页面的。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 宽度表
 * 主线程没有共享的 charWidth（那是 Worker 侧的），这里只要「这个字符占几格」。
 * 等宽字体下：ASCII 1 格，CJK / emoji 2 格，组合符 0 格。 */
function hxCharW(cp) {
  if (cp === 0) return 0;
  if (cp < 32) return 0;
  if (cp < 0x1100) return 1;
  if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) ||
      (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x1F300 && cp <= 0x1F64F) ||
      (cp >= 0x1F900 && cp <= 0x1F9FF) || (cp >= 0x20000 && cp <= 0x3FFFD)) return 2;
  if (cp >= 0x300 && cp <= 0x36F) return 0;   // 组合用附加符
  return 1;
}

/* ---------------------------------------------------------------- 词法 Worker
 * 一个共享 Worker 给所有编辑窗口用：新建一个编辑器就再开一个线程太浪费，
 * 而且文本小的很，串行排队完全够。 */
const HxWorker = {
  w: null, seq: 0, waiting: new Map(), failed: false,

  ensure() {
    if (this.w || this.failed) return this.w;
    try {
      const src = `
        function tok(src) {
          const out = [];
          const push = (s, e, k) => { if (e > s) out.push(s + ',' + e + ',' + k); };
          let i = 0; const n = src.length;
          const isName = c => /[\\w:.-]/.test(c);
          while (i < n) {
            if (src.startsWith('<!--', i)) {
              const e = src.indexOf('-->', i + 4);
              const end = e < 0 ? n : e + 3;
              push(i, end, 'cmt'); i = end; continue;
            }
            if (src[i] === '<' && src[i + 1] === '!') {
              const e = src.indexOf('>', i);
              const end = e < 0 ? n : e + 1;
              push(i, end, 'meta'); i = end; continue;
            }
            if (src[i] === '<' && /[a-zA-Z\\/]/.test(src[i + 1] || '')) {
              const start = i;
              push(i, i + 1, 'punc');
              i++;
              let closing = false;
              if (src[i] === '/') { closing = true; push(i, i + 1, 'punc'); i++; }
              const ns = i;
              while (i < n && isName(src[i])) i++;
              push(ns, i, closing ? 'tagx' : 'tag');
              while (i < n && src[i] !== '>') {
                if (/\\s/.test(src[i])) { i++; continue; }
                if (src[i] === '/') { push(i, i + 1, 'punc'); i++; continue; }
                const as = i;
                while (i < n && !/[\\s=\\/>]/.test(src[i])) i++;
                if (i > as) push(as, i, 'attr');
                while (i < n && /\\s/.test(src[i])) i++;
                if (src[i] === '=') {
                  push(i, i + 1, 'punc'); i++;
                  while (i < n && /\\s/.test(src[i])) i++;
                  const q = src[i];
                  if (q === '"' || q === "'") {
                    const qs = i; i++;
                    while (i < n && src[i] !== q) i++;
                    i = Math.min(n, i + 1);
                    push(qs, i, 'str');
                  } else {
                    const vs = i;
                    while (i < n && !/[\\s>]/.test(src[i])) i++;
                    push(vs, i, 'str');
                  }
                }
              }
              if (i < n && src[i] === '>') { push(i, i + 1, 'punc'); i++; }
              continue;
            }
            const ts = i;
            while (i < n && src[i] !== '<') i++;
            if (i === ts) i++;
            push(ts, i, 'text');
          }
          return out;
        }
        onmessage = (e) => {
          const d = e.data;
          try { postMessage({ id: d.id, tokens: tok(d.text) }); }
          catch (err) { postMessage({ id: d.id, tokens: [], err: String(err && err.message || err) }); }
        };`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = (e) => {
        const m = e.data || {};
        const cb = this.waiting.get(m.id);
        if (cb) { this.waiting.delete(m.id); cb(m.tokens || []); }
      };
      w.onerror = () => { this.failed = true; this.w = null; };
      this.w = w;
      return w;
    } catch (e) {
      this.failed = true;
      return null;
    }
  },

  tokenize(text, cb) {
    const w = this.ensure();
    if (!w) { cb(null); return; }
    const id = ++this.seq;
    this.waiting.set(id, cb);
    try { w.postMessage({ id, text }); }
    catch (e) { this.waiting.delete(id); cb(null); }
    /* 3 秒没回就别等了，主线程用纯文本兜底 —— 高亮没了不能连编辑都不能用 */
    setTimeout(() => {
      if (this.waiting.has(id)) { this.waiting.delete(id); cb(null); }
    }, 3000);
  }
};

/* ---------------------------------------------------------------- 应用 */
const HX_SAMPLE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>你好</title>
  <style>
    body { font: 16px/1.6 system-ui, sans-serif; padding: 24px; }
    button { padding: 8px 16px; border-radius: 8px; border: 0;
             background: #0f1617; color: #8de312; cursor: pointer; }
    #out { margin-top: 12px; color: #555; }
  </style>
</head>
<body>
  <h1>这是个真的页面</h1>
  <p>左边改，右边立刻变。脚本照跑，没有过滤。</p>
  <button id="b">点我</button>
  <div id="out"></div>

  <script>
    let n = 0;
    document.getElementById('b').onclick = () => {
      n++;
      document.getElementById('out').textContent = '点了 ' + n + ' 次';
    };
  <\/script>
</body>
</html>
`;

class HtmlApp {
  constructor(container, opts) {
    this.el = container;
    this.opts = opts || {};
    this.text = this.opts.code || HX_SAMPLE;
    this.caret = 0;
    this.selA = 0; this.selB = 0;
    this.tokens = [];
    this.scrollLine = 0;
    this.scrollX = 0;
    this.split = 0.5;              // 编辑区占比
    this.auto = true;
    this.isolated = false;
    this.fs = 13;
    this.lh = Math.round(this.fs * 1.62);
    this.undo = []; this.redo = [];
    this._caretOn = true;
    this._blink = 0;
    this._raf = 0;
    this._tok = 0;
    this._run = 0;
    this._live = false;
    this._dirty = true;
    this._meas = null;

    this._build();
    this._bind();
    this._applyTheme();
    this._layout();
    this._scheduleToken();
    this._scheduleRun(0);
    this._startBlink();
    /* 窗口刚建时内容区可能还没有尺寸，等两帧再排一次版 */
    requestAnimationFrame(() => requestAnimationFrame(() => this._layout()));
  }

  /* -------------------------------------------------------------- 结构 */
  _build() {
    this.el.innerHTML = `
      <div class="hx">
        <div class="hx-bar">
          <button class="tl-btn sm" data-a="open" title="从 .home 打开一个 .html">打开</button>
          <button class="tl-btn sm" data-a="save" title="存到 .home（Ctrl+S）">保存</button>
          <span class="hx-sp"></span>
          <button class="tl-btn sm" data-a="run" title="立刻重新渲染（Ctrl+Enter）">运行</button>
          <label class="hx-chk" title="改一个字就重新渲染"><input type="checkbox" data-a="auto" checked><span>自动</span></label>
          <label class="hx-chk" title="给预览加 sandbox（默认不加：脚本照跑，同源可达）"><input type="checkbox" data-a="iso"><span>隔离</span></label>
          <button class="tl-btn sm" data-a="view" title="切换 左右 / 上下 / 只看编辑 / 只看预览">分栏</button>
          <button class="tl-btn sm" data-a="clear" title="清空重来">清空</button>
        </div>
        <div class="hx-body">
          <div class="hx-edit">
            <canvas class="hx-cv"></canvas>
            <textarea class="hx-in" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea>
          </div>
          <div class="hx-gutter" title="拖动改分栏"></div>
          <div class="hx-prev">
            <iframe class="hx-frame" title="预览"></iframe>
          </div>
        </div>
        <div class="hx-foot">
          <span data-f="pos">1:1</span>
          <span data-f="len">0 字符</span>
          <span data-f="run">—</span>
          <span class="hx-sp"></span>
          <span data-f="hint">canvas 自绘 · 高亮在 Worker</span>
        </div>
      </div>`;
    const q = s => this.el.querySelector(s);
    this.cv = q('.hx-cv');
    this.ctx = this.cv.getContext('2d');
    this.ta = q('.hx-in');
    this.frame = q('.hx-frame');
    this.editBox = q('.hx-edit');
    this.prevBox = q('.hx-prev');
    this.gutter = q('.hx-gutter');
    this.bodyEl = q('.hx-body');
    this.fPos = q('[data-f="pos"]');
    this.fLen = q('[data-f="len"]');
    this.fRun = q('[data-f="run"]');
    this.ta.value = this.text;
    this.ta.selectionStart = this.ta.selectionEnd = this.caret;
  }

  _bind() {
    const q = s => this.el.querySelector(s);

    /* 工具栏：用委托，按钮会随状态变文案 */
    this.el.querySelector('.hx-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || b.tagName === 'INPUT') return;
      const a = b.dataset.a;
      if (a === 'open') this._openFile();
      else if (a === 'save') this._saveFile();
      else if (a === 'run') this._scheduleRun(0);
      else if (a === 'view') this._cycleView();
      else if (a === 'clear') {
        confirmDlg('清空编辑器？', '当前内容会丢掉，已经保存到文件的不受影响。', () => {
          this._pushUndo();
          this._setText('', 0);
        }, { ok: '清空', danger: true });
      }
    });
    q('[data-a="auto"]').addEventListener('change', e => {
      this.auto = e.target.checked;
      if (this.auto) this._scheduleRun(60);
    });
    q('[data-a="iso"]').addEventListener('change', e => {
      this.isolated = e.target.checked;
      this._scheduleRun(0);
    });

    /* 输入层：只负责「收」，不负责显示 */
    this.ta.addEventListener('input', () => this._onInput());
    this.ta.addEventListener('keydown', (e) => this._onKey(e));
    this.ta.addEventListener('compositionstart', () => { this._composing = true; });
    this.ta.addEventListener('compositionend', () => {
      this._composing = false;
      this._onInput();
    });
    this.ta.addEventListener('scroll', () => { this.ta.scrollTop = 0; this.ta.scrollLeft = 0; });

    /* 鼠标：点哪儿光标去哪儿，拖动选字 */
    this.cv.addEventListener('pointerdown', (e) => this._onDown(e));
    this.cv.addEventListener('pointermove', (e) => this._onMove(e));
    this.cv.addEventListener('pointerup', (e) => this._onUp(e));
    this.cv.addEventListener('pointercancel', () => { this._dragging = false; });
    this.cv.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    /* 分栏拖动 */
    this.gutter.addEventListener('pointerdown', (e) => this._onSplit(e));

    this._ro = new ResizeObserver(() => this._layout());
    this._ro.observe(this.bodyEl);

    this.el.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this._saveFile(); }
    });
  }

  /* -------------------------------------------------------------- 布局 */
  _layout() {
    /* 用 clientWidth/clientHeight 而不是 getBoundingClientRect：
     * 窗口开场动画用的是 transform:scale()，rect 会把缩放算进去，
     * 于是「刚打开的一瞬间」量到的是缩小后的宽度，窄到 620 以下就被判成上下分栏，
     * 而且这个错误结论会一直留着。clientWidth 不受 transform 影响。 */
    const bw = this.bodyEl.clientWidth, bh = this.bodyEl.clientHeight;
    if (!bw || !bh) return;
    const box = { width: bw, height: bh };
    const vertical = bw < 620;
    const g = 6;
    const avail = vertical ? bh : bw;
    const editW = Math.max(120, Math.round((avail - g) * this.split));
    if (vertical) {
      this.bodyEl.style.gridTemplateColumns = '1fr';
      this.bodyEl.style.gridTemplateRows = editW + 'px ' + g + 'px 1fr';
      this.gutter.style.cursor = 'row-resize';
    } else {
      this.bodyEl.style.gridTemplateColumns = editW + 'px ' + g + 'px 1fr';
      this.bodyEl.style.gridTemplateRows = '1fr';
      this.gutter.style.cursor = 'col-resize';
    }
    this._vertical = vertical;
    this._resizeCanvas();
    this._draw();
  }

  _resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    /* 同 _layout：用 client*，别让开场动画的 transform 骗了尺寸 */
    const w = Math.max(80, this.editBox.clientWidth || 0);
    const h = Math.max(60, this.editBox.clientHeight || 0);
    if (this._cw === w && this._ch === h && this._dpr === dpr) return;
    this._cw = w; this._ch = h; this._dpr = dpr;
    this.cv.width = Math.floor(w * dpr);
    this.cv.height = Math.floor(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._meas = null;
    this._dirty = true;
  }

  /* 等宽字体的字符宽度：量一次 'M'，中文按 2 倍。
   * 不逐字 measureText —— 一屏 3000 个字符，每帧量 3000 次会把帧率打死。 */
  _metrics() {
    if (this._meas) return this._meas;
    const c = this.ctx;
    c.font = this._font();
    const w = c.measureText('M').width || this.fs * 0.6;
    const base = c.measureText('中').width;
    this._meas = { w, cjk: base > w * 1.5 ? w * 2 : w * 2, ascent: this.fs };
    return this._meas;
  }

  _font() { return this.fs + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK SC", monospace'; }

  /* -------------------------------------------------------------- 文本模型 */
  _lines() {
    if (this._linesCache && this._linesSrc === this.text) return this._linesCache;
    const out = [];
    let start = 0;
    const s = this.text;
    for (let i = 0; i <= s.length; i++) {
      if (i === s.length || s[i] === '\n') {
        out.push({ start, text: s.slice(start, i) });
        start = i + 1;
      }
    }
    this._linesSrc = this.text;
    this._linesCache = out;
    return out;
  }

  _pos(offset) {
    const s = this.text;
    const o = Math.max(0, Math.min(s.length, offset));
    let row = 0, start = 0;
    for (let i = 0; i < o; i++) {
      if (s[i] === '\n') { row++; start = i + 1; }
    }
    return { row, col: o - start, offset: o };
  }

  _colX(str, upto) {
    const m = this._metrics();
    let x = 0;
    for (let i = 0; i < upto && i < str.length; i++) x += hxCharW(str.codePointAt(i)) === 2 ? m.cjk : m.w;
    return x;
  }

  /* 屏幕坐标 -> 文本偏移（鼠标点击 / 拖动） */
  _hitTest(px, py) {
    const m = this._metrics();
    const lines = this._lines();
    const row = Math.max(0, Math.min(lines.length - 1, Math.floor((py + this.scrollLine * this.lh) / this.lh)));
    const L = lines[row] || { start: 0, text: '' };
    const targetX = px + this.scrollX;
    let x = 0;
    let i = 0;
    while (i < L.text.length) {
      const cp = L.text.codePointAt(i);
      const w = hxCharW(cp) === 2 ? m.cjk : m.w;
      if (x + w / 2 > targetX) break;
      x += w;
      i += String.fromCodePoint(cp).length;
    }
    return L.start + i;
  }

  /* -------------------------------------------------------------- 绘制 */
  _draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._paint(); });
  }

  _paint() {
    const c = this.ctx;
    /* 自己校一次尺寸：ResizeObserver 只在「变」的时候叫，
     * 而窗口刚打开那一帧量到的 0 不算「变」，于是画面永远停在 3 行。 */
    const ew = this.editBox.clientWidth, eh = this.editBox.clientHeight;
    if (ew && eh && (ew !== this._cw || eh !== this._ch)) this._resizeCanvas();
    if (!c || !this._cw) return;
    this._applyTheme();
    const m = this._metrics();
    const lines = this._lines();
    const W = this._cw, H = this._ch;
    const gutterW = Math.max(34, String(lines.length).length * m.w + 16);
    const top = 6;
    const visRows = Math.floor((H - top * 2) / this.lh);
    this.scrollLine = Math.max(0, Math.min(this.scrollLine, Math.max(0, lines.length - Math.floor(visRows / 2))));

    c.save();
    c.clearRect(0, 0, W, H);
    c.fillStyle = this._bg || '#0f1617';
    c.fillRect(0, 0, W, H);

    /* 行号槽 */
    c.fillStyle = this._gutterBg || 'rgba(255,255,255,.035)';
    c.fillRect(0, 0, gutterW, H);
    c.font = this._font();
    c.textBaseline = 'top';

    const first = this.scrollLine;
    const last = Math.min(lines.length - 1, first + visRows + 1);

    /* 选区（先画，压在文字下面） */
    const sa = Math.min(this.selA, this.selB), sb = Math.max(this.selA, this.selB);
    if (sa !== sb) {
      c.fillStyle = (this._pal && this._pal.sel) || 'rgba(64,160,255,.22)';
      const p1 = this._pos(sa), p2 = this._pos(sb);
      for (let r = p1.row; r <= p2.row && r <= last; r++) {
        if (r < first) continue;
        const L = lines[r];
        const from = r === p1.row ? this._colX(L.text, p1.col) : 0;
        const to = r === p2.row ? this._colX(L.text, p2.col) : this._colX(L.text, L.text.length);
        const y = top + (r - first) * this.lh;
        c.fillRect(gutterW + from - this.scrollX, y, Math.max(2, to - from), this.lh);
      }
    }

    /* 逐行：行号 + 分段上色 */
    const maxX = W - gutterW;
    for (let r = first; r <= last; r++) {
      const L = lines[r];
      if (!L) continue;
      const y = top + (r - first) * this.lh;

      c.fillStyle = document.body.classList.contains('light') ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.28)';
      c.textAlign = 'right';
      c.fillText(String(r + 1), gutterW - 8, y + 2);
      c.textAlign = 'left';

      c.save();
      c.beginPath();
      c.rect(gutterW, 0, maxX, H);
      c.clip();
      let x = gutterW - this.scrollX;
      /* 该行涉及的 token，按它们在全文里的偏移切片 */
      for (const seg of this._segments(L)) {
        c.fillStyle = this._colorOf(seg.k);
        for (const ch of seg.t) {
          const w = hxCharW(ch.codePointAt(0)) === 2 ? m.cjk : m.w;
          if (x + w > gutterW && x < W) c.fillText(ch, x, y + 2);
          x += w;
        }
      }
      c.restore();
    }

    /* 光标 */
    if (this._caretOn && !this._dragging) {
      const p = this._pos(this.caret);
      if (p.row >= first && p.row <= last) {
        const L = lines[p.row];
        const x = gutterW + this._colX(L ? L.text : '', p.col) - this.scrollX;
        const y = top + (p.row - first) * this.lh;
        const h = this.lh - 2;
        c.fillStyle = (this._pal && this._pal.caret) || '#8de312';
        c.fillRect(Math.round(x), Math.round(y + 1), 2, h);
        /* 输入法位置：textarea 贴到光标上，候选框才会出现在该出现的地方 */
        this.ta.style.left = Math.round(x) + 'px';
        this.ta.style.top = Math.round(y) + 'px';
      }
    }
    c.restore();

    /* 状态栏 */
    const p = this._pos(this.caret);
    if (this.fPos) this.fPos.textContent = (p.row + 1) + ':' + (p.col + 1);
    if (this.fLen) this.fLen.textContent = this.text.length.toLocaleString() + ' 字符 · ' + lines.length + ' 行';
    this._dirty = false;
  }

  _segments(L) {
    /* 把这一行的文本切成 [类型, 文本] 段。没有 token 时整行当普通代码。 */
    const out = [];
    if (!this.tokens || !this.tokens.length) {
      if (L.text) out.push({ k: 'text', t: L.text });
      return out;
    }
    let pos = L.start;
    const end = L.start + L.text.length;
    for (const tk of this.tokens) {
      if (tk.e <= L.start) continue;
      if (tk.s >= end) break;
      const s = Math.max(tk.s, L.start), e = Math.min(tk.e, end);
      if (s > pos) out.push({ k: 'text', t: this.text.slice(pos, s) });
      out.push({ k: tk.k, t: this.text.slice(s, e) });
      pos = e;
    }
    if (pos < end) out.push({ k: 'text', t: this.text.slice(pos, end) });
    return out;
  }

  _colorOf(k) {
    const p = this._pal || {};
    return p[k] || p.text || '#e8efec';
  }

  _applyTheme() {
    const light = document.body.classList.contains('light');
    this._bg = light ? '#ffffff' : '#0f1617';
    this._gutterBg = light ? 'rgba(0,0,0,.045)' : 'rgba(255,255,255,.035)';
    /* 两套配色都写全：浅色主题下沿用深色的浅字会变成「白底白字」——
     * 截图里代码几乎看不见，就是漏了这一条。 */
    this._pal = light
      ? { text:'#1a2422', tag:'#1f7a3a', tagx:'#1f7a3a', attr:'#0b6e7a', str:'#9a6b00',
          cmt:'#8a9a95', meta:'#6a3fbf', punc:'#5a6b66', caret:'#0f7a3f', sel:'rgba(30,120,220,.18)' }
      : { text:'#e8efec', tag:'#8de312', tagx:'#8de312', attr:'#19e6f0', str:'#f5b900',
          cmt:'#6b7a76', meta:'#b07cff', punc:'#9aa5a1', caret:'#8de312', sel:'rgba(64,160,255,.22)' };
  }

  /* -------------------------------------------------------------- 令牌 */
  _scheduleToken() {
    clearTimeout(this._tok);
    this._tok = setTimeout(() => {
      const src = this.text;
      HxWorker.tokenize(src, (tokens) => {
        if (!tokens) { this.tokens = []; this._draw(); return; }
        if (this.text !== src) return;      // 期间又改了，等下一次
        this.tokens = tokens.map(s => {
          const a = s.split(',');
          return { s: +a[0], e: +a[1], k: a[2] };
        });
        this._draw();
      });
    }, 120);
  }

  /* -------------------------------------------------------------- 编辑 */
  _pushUndo() {
    this.undo.push({ text: this.text, caret: this.caret });
    if (this.undo.length > 120) this.undo.shift();
    this.redo.length = 0;
  }

  _setText(t, caret) {
    this.text = t;
    this.caret = Math.max(0, Math.min(t.length, caret == null ? this.caret : caret));
    this.selA = this.selB = this.caret;
    this._syncTa();
    this._dirty = true;
    this._draw();
    this._scheduleToken();
    if (this.auto) this._scheduleRun(420);
  }

  _syncTa() {
    /* textarea 只跟光标做朋友：值保持全文，选区跟 caret 对齐。
     * 这样输入法、粘贴、撤销都能沿用浏览器原生那一套。 */
    if (this.ta.value !== this.text) this.ta.value = this.text;
    try {
      this.ta.selectionStart = this.ta.selectionEnd = this.caret;
    } catch (e) {}
  }

  _onInput() {
    if (this._composing) return;
    const v = this.ta.value;
    if (v === this.text) return;
    this._pushUndo();
    const caret = this.ta.selectionStart;
    this.text = v;
    this.caret = caret;
    this.selA = this.selB = caret;
    this._dirty = true;
    this._draw();
    this._scheduleToken();
    if (this.auto) this._scheduleRun(420);
    this._updateRunLabel('改过，等渲染');
  }

  _onKey(e) {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        const s = this.redo.pop();
        if (s) { this.undo.push({ text: this.text, caret: this.caret }); this._setText(s.text, s.caret); }
      } else {
        const s = this.undo.pop();
        if (s) { this.redo.push({ text: this.text, caret: this.caret }); this._setText(s.text, s.caret); }
      }
      return;
    }
    if (mod && k === 'Enter') { e.preventDefault(); this._scheduleRun(0); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); this._saveFile(); return; }

    if (k === 'Tab') {
      e.preventDefault();
      const s = this.selA !== this.selB;
      if (s) { this._indentBlock(); return; }
      this._insert('  ');
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      /* 自动缩进：延续上一行的前导空白，遇到 <tag> 再加两格 */
      const p = this._pos(this.caret);
      const lines = this._lines();
      const cur = lines[p.row] ? lines[p.row].text : '';
      const lead = (cur.match(/^[ \t]*/) || [''])[0];
      const before = cur.slice(0, p.col).trimEnd();
      const extra = /<[a-zA-Z][^>]*>$/.test(before) ? '  ' : '';
      this._insert('\n' + lead + extra);
      return;
    }
    if (k === 'Backspace') {
      if (this.selA !== this.selB) { e.preventDefault(); this._deleteSel(); return; }
      if (this.caret === 0) { e.preventDefault(); return; }
      e.preventDefault();
      this._pushUndo();
      this.text = this.text.slice(0, this.caret - 1) + this.text.slice(this.caret);
      this.caret--;
      this.selA = this.selB = this.caret;
      this._syncTa(); this._draw(); this._scheduleToken();
      if (this.auto) this._scheduleRun(420);
      return;
    }
    if (k === 'Delete') {
      if (this.selA !== this.selB) { e.preventDefault(); this._deleteSel(); return; }
      if (this.caret >= this.text.length) { e.preventDefault(); return; }
      e.preventDefault();
      this._pushUndo();
      this.text = this.text.slice(0, this.caret) + this.text.slice(this.caret + 1);
      this._syncTa(); this._draw(); this._scheduleToken();
      if (this.auto) this._scheduleRun(420);
      return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' ||
        k === 'Home' || k === 'End') {
      e.preventDefault();
      this._move(k, e.shiftKey);
      return;
    }
  }

  _insert(s) {
    this._pushUndo();
    const a = Math.min(this.selA, this.selB), b = Math.max(this.selA, this.selB);
    if (a !== b) {
      this.text = this.text.slice(0, a) + s + this.text.slice(b);
      this.caret = a + s.length;
    } else {
      this.text = this.text.slice(0, this.caret) + s + this.text.slice(this.caret);
      this.caret += s.length;
    }
    this.selA = this.selB = this.caret;
    this._syncTa(); this._dirty = true; this._draw(); this._scheduleToken();
    this._ensureCaretVisible();
    if (this.auto) this._scheduleRun(420);
  }

  _deleteSel() {
    const a = Math.min(this.selA, this.selB), b = Math.max(this.selA, this.selB);
    if (a === b) return;
    this._pushUndo();
    this.text = this.text.slice(0, a) + this.text.slice(b);
    this.caret = a;
    this.selA = this.selB = a;
    this._syncTa(); this._draw(); this._scheduleToken();
    if (this.auto) this._scheduleRun(420);
  }

  _move(k, shift) {
    const lines = this._lines();
    const p = this._pos(this.caret);
    let next = this.caret;
    if (k === 'ArrowLeft') next = Math.max(0, this.caret - 1);
    else if (k === 'ArrowRight') next = Math.min(this.text.length, this.caret + 1);
    else if (k === 'Home') next = lines[p.row] ? lines[p.row].start : 0;
    else if (k === 'End') {
      const L = lines[p.row];
      next = L ? L.start + L.text.length : this.text.length;
    } else {
      const dr = k === 'ArrowUp' ? -1 : 1;
      const target = lines[p.row + dr];
      if (target) next = target.start + Math.min(p.col, target.text.length);
    }
    this.caret = next;
    if (shift) this.selB = next;
    else this.selA = this.selB = next;
    this._syncTa(); this._draw();
    this._ensureCaretVisible();
  }

  _indentBlock() {
    const lines = this._lines();
    const p1 = this._pos(Math.min(this.selA, this.selB));
    const p2 = this._pos(Math.max(this.selA, this.selB));
    this._pushUndo();
    const out = lines.map((L, i) => (i >= p1.row && i <= p2.row) ? '  ' + L.text : L.text);
    this.text = out.join('\n');
    this.selA = lines[p1.row].start + 2;
    this.selB = (lines[p2.row].start + (p2.row > p1.row ? 2 * (p2.row - p1.row) : 0)) + lines[p2.row].text.length + 2;
    this.caret = this.selB;
    this._syncTa(); this._draw(); this._scheduleToken();
  }

  _ensureCaretVisible() {
    const p = this._pos(this.caret);
    const visRows = Math.floor((this._ch - 12) / this.lh);
    if (p.row < this.scrollLine) this.scrollLine = p.row;
    if (p.row > this.scrollLine + visRows - 1) this.scrollLine = p.row - visRows + 1;
    this._draw();
  }

  /* -------------------------------------------------------------- 鼠标 */
  _onDown(e) {
    this.cv.setPointerCapture(e.pointerId);
    this._dragging = true;
    this.ta.focus();
    const r = this.cv.getBoundingClientRect();
    const m = this._metrics();
    const lines = this._lines();
    const gutterW = Math.max(34, String(lines.length).length * m.w + 16);
    const off = this._hitTest(e.clientX - r.left - gutterW + this.scrollX, e.clientY - r.top - 6);
    this.caret = off;
    if (e.shiftKey) { this.selB = off; }
    else { this.selA = this.selB = off; }
    this._syncTa(); this._draw();
    e.preventDefault();
  }

  _onMove(e) {
    if (!this._dragging) return;
    const r = this.cv.getBoundingClientRect();
    const m = this._metrics();
    const lines = this._lines();
    const gutterW = Math.max(34, String(lines.length).length * m.w + 16);
    const off = this._hitTest(e.clientX - r.left - gutterW + this.scrollX, e.clientY - r.top - 6);
    this.selB = off;
    this.caret = off;
    this._draw();
  }

  _onUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    try { this.cv.releasePointerCapture(e.pointerId); } catch (err) {}
    this._syncTa();
    this._draw();
  }

  _onWheel(e) {
    e.preventDefault();
    const lines = this._lines();
    if (e.shiftKey) {
      this.scrollX = Math.max(0, this.scrollX + (e.deltaY || e.deltaX));
    } else {
      const step = Math.max(1, Math.round(Math.abs(e.deltaY) / this.lh));
      this.scrollLine = Math.max(0, Math.min(lines.length - 1, this.scrollLine + (e.deltaY > 0 ? step : -step)));
    }
    this._draw();
  }

  _onSplit(e) {
    e.preventDefault();
    this.gutter.setPointerCapture(e.pointerId);
    const box = this.bodyEl.getBoundingClientRect();
    const move = (ev) => {
      const vertical = this._vertical;
      const total = vertical ? box.height : box.width;
      const p = vertical ? (ev.clientY - box.top) : (ev.clientX - box.left);
      this.split = Math.max(0.15, Math.min(0.85, p / total));
      this._layout();
    };
    const up = () => {
      this.gutter.removeEventListener('pointermove', move);
      this.gutter.removeEventListener('pointerup', up);
      try { this.gutter.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    this.gutter.addEventListener('pointermove', move);
    this.gutter.addEventListener('pointerup', up);
  }

  /* -------------------------------------------------------------- 闪烁 */
  _startBlink() {
    const tick = () => {
      if (this._disposed) return;
      this._caretOn = !this._caretOn;
      /* 光标只在编辑区可见且聚焦时闪，别为了一个光标每 530ms 重画整块 */
      if (document.activeElement === this.ta) this._draw();
      this._blink = setTimeout(tick, 530);
    };
    this._blink = setTimeout(tick, 530);
  }

  /* -------------------------------------------------------------- 视图 */
  _cycleView() {
    const seq = [0.5, 0.68, 0.32, 1, 0];
    const cur = this.split;
    let i = seq.findIndex(v => Math.abs(v - cur) < 0.02);
    this.split = seq[(i + 1) % seq.length];
    this._layout();
    this._layoutFrame();
  }

  _layoutFrame() {
    const onlyEdit = this.split >= 0.999;
    const onlyPrev = this.split <= 0.001;
    this.prevBox.style.display = onlyEdit ? 'none' : '';
    this.editBox.style.display = onlyPrev ? 'none' : '';
    this.gutter.style.display = (onlyEdit || onlyPrev) ? 'none' : '';
    if (!onlyPrev) this._resizeCanvas();
  }

  /* -------------------------------------------------------------- 预览 */
  _updateRunLabel(s) { if (this.fRun) this.fRun.textContent = s; }

  _scheduleRun(delay) {
    clearTimeout(this._run);
    this._run = setTimeout(() => this._render(), delay);
  }

  _render() {
    /* 先记住 iframe 里的滚动位置：每次重写 srcdoc 都会跳回顶部，
     * 一边改字一边被弹回开头是最烦人的。 */
    let sy = 0, sx = 0;
    try {
      const w = this.frame.contentWindow;
      if (w) { sy = w.scrollY; sx = w.scrollX; }
    } catch (e) {}

    const t0 = performance.now();
    const html = this.text;
    if (this.isolated) {
      this.frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
    } else {
      this.frame.removeAttribute('sandbox');
    }
    this.frame.srcdoc = html;
    this._live = true;
    const hasPrev = this.split > 0.001;
    if (!hasPrev) this._layoutFrame();

    this.frame.onload = () => {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      this._updateRunLabel('渲染 ' + ms + ' ms · ' + Math.round(html.length / 1024 * 10) / 10 + ' KB');
      try {
        const w = this.frame.contentWindow;
        if (w) {
          w.scrollTo(sx, sy);
          w.onerror = (m, src, ln) => {
            this._updateRunLabel('脚本报错：' + m + ' (行 ' + ln + ')');
          };
        }
      } catch (e) {}
    };
  }

  /* -------------------------------------------------------------- 文件 */
  async _openFile() {
    const p = await pickFileInFs({ dir: '.home', title: '打开 HTML', filter: (n) => /\.html?$/i.test(n) || true });
    if (!p) return;
    const r = await FS.read(p);
    if (!r || typeof r.content !== 'string') { toast('这个文件读不出来', 'warn'); return; }
    this._pushUndo();
    this._setText(r.content, 0);
    this.scrollLine = 0; this.scrollX = 0;
    this._path = p;
    toast('已打开 ' + spotExportName(p));
  }

  async _saveFile() {
    const base = this._path ? spotExportName(this._path) : 'page.html';
    const name = await modalPrompt('保存为（写进 .home）', base, '文件名，例如 demo.html');
    if (!name) return;
    /* spotfs 的路径是点分的，文件名里的点会被当成目录分隔符：
     * 直接拼 '.home.a.html' 等于往不存在的 '.home.a' 目录里写东西。
     * 所以先按 spotfs 的规则转义成 -2e，再用 uniquePathIn 避开重名。 */
    const nice = /\.html?$/i.test(name) ? name : name + '.html';
    const p = uniquePathIn('.home', spotEscape(nice));
    try {
      await Spot.write(p, this.text, { mime:'text/html;charset=utf-8', type:'page', hint:baseName(p) });
      this._path = p;
      toast('已保存 ' + spotExportName(p));
    } catch (e) {
      toast('保存失败：' + (e && e.message || e), true);
    }
  }

  onResize() { this._meas = null; this._layout(); }

  dispose() {
    this._disposed = true;
    clearTimeout(this._blink);
    clearTimeout(this._tok);
    clearTimeout(this._run);
    if (this._raf) cancelAnimationFrame(this._raf);
    try { this._ro && this._ro.disconnect(); } catch (e) {}
    try { this.frame && (this.frame.srcdoc = ''); } catch (e) {}
  }
}
