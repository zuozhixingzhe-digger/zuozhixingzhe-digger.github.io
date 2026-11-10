/* ---------------------------------------------------------------- 贝塞尔动效设计器
 * 一个能真的拖的控制点编辑器：左边是 cubic-bezier 的曲线（x 是时间，y 是进度），
 * 右边（窄窗是下面）是小球跑道，改一个数字小球立刻换节奏。
 *
 * 为什么不用 CSS transition 让浏览器自己跑：那样拿不到「当前进度」，画不出曲线上
 * 那个跟着走的小点；自己解 cubic-bezier 之后，曲线、小球、进度点三者永远是同一份数据。
 */
(function () {
  const PRESETS = [
    { name:'ease', v:[.25,.1,.25,1] },
    { name:'ease-in', v:[.42,0,1,1] },
    { name:'ease-out', v:[0,0,.58,1] },
    { name:'ease-in-out', v:[.42,0,.58,1] },
    { name:'linear', v:[0,0,1,1] },
    { name:'back-out', v:[.34,1.56,.64,1] },
    { name:'back-in', v:[.36,0,.66,-.56] },
    { name:'snap', v:[.22,1,.36,1] },
    { name:'anticipate', v:[.68,-.55,.27,1.55] },
    { name:'smooth', v:[.4,0,.2,1] }
  ];

  function solveBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const fx = (t) => ((ax * t + bx) * t + cx) * t;
    const fy = (t) => ((ay * t + by) * t + cy) * t;
    const dfx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    const tx = (x) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const d = fx(t) - x;
        if (Math.abs(d) < 1e-6) return t;
        const dd = dfx(t);
        if (Math.abs(dd) < 1e-6) break;
        t -= d / dd;
      }
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 24; i++) {
        const v = fx(t);
        if (Math.abs(v - x) < 1e-6) return t;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    };
    return { fx, fy, at:(x) => fy(tx(x)) };
  }

  class BezierApp {
    constructor(container, opts) {
      this.el = container;
      this.p = [0.25, 0.1, 0.25, 1];     // x1,y1,x2,y2
      this.dur = 1200;
      this.loop = true;
      this.playing = true;
      this._t0 = 0;
      this._raf = 0;
      this._drag = null;

      this.el.innerHTML = `<div class="bz">
        <div class="bz-bar">
          <select class="bz-sel" data-f="preset" title="预设">
            ${PRESETS.map((x, i) => `<option value="${i}">${x.name}</option>`).join('')}
            <option value="-1">自定义</option>
          </select>
          <label class="bz-rng" title="时长"><span>时长</span>
            <input type="range" min="200" max="3000" step="50" value="${this.dur}" data-f="dur">
            <b data-f="durv">1.20s</b></label>
          <button class="bz-btn" data-a="play" title="播放 / 暂停">❚❚</button>
          <button class="bz-btn${this.loop ? ' on' : ''}" data-a="loop" title="循环">↻</button>
          <button class="bz-btn" data-a="copy" title="复制 CSS">复制</button>
          <button class="bz-btn" data-a="save" title="存到 .home">存</button>
        </div>
        <div class="bz-body">
          <div class="bz-graph"><canvas data-f="cv"></canvas>
            <div class="bz-css" data-f="css">cubic-bezier(.25,.1,.25,1)</div>
          </div>
          <div class="bz-side">
            <div class="bz-track"><div class="bz-ball" data-f="ball"></div></div>
            <div class="bz-nums">
              ${['x1','y1','x2','y2'].map((k, i) => `
                <label><span>${k}</span><input type="number" step="0.01" min="-2" max="2" data-n="${i}" value="${this.p[i]}"></label>`).join('')}
            </div>
            <div class="bz-hint">拖动两个控制点，或者直接改数值。纵轴可以超出 0–1（回弹/预备动作），
              横轴必须落在 0–1。</div>
          </div>
        </div>
      </div>`;
      this.cv = $('[data-f="cv"]', this.el);
      this.ball = $('[data-f="ball"]', this.el);
      this.track = $('.bz-track', this.el);
      this.cssEl = $('[data-f="css"]', this.el);
      this._bind();
      this._resize();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe($('.bz-graph', this.el));
      this._loop();
    }

    _bind() {
      const cv = this.cv;
      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        const pad = this._pad || 26;
        const w = r.width - pad * 2, h = r.height - pad * 2;
        return {
          x: (e.clientX - r.left - pad) / w,
          y: 1 - (e.clientY - r.top - pad) / h
        };
      };
      cv.addEventListener('pointerdown', (e) => {
        const q = pos(e);
        const d1 = Math.hypot(q.x - this.p[0], q.y - this.p[1]);
        const d2 = Math.hypot(q.x - this.p[2], q.y - this.p[3]);
        this._drag = d1 <= d2 ? 0 : 2;
        if (Math.min(d1, d2) > 0.18) {
          /* 点空白处：把最近的那个点挪过来，手感比「必须先精确点到」好得多 */
          this.p[this._drag] = this._clampX(q.x);
          this.p[this._drag + 1] = Math.round(q.y * 100) / 100;
        }
        try { cv.setPointerCapture(e.pointerId); } catch (_) {}
        this._sync();
        e.preventDefault();
      });
      cv.addEventListener('pointermove', (e) => {
        if (this._drag == null) return;
        const q = pos(e);
        this.p[this._drag] = this._clampX(q.x);
        this.p[this._drag + 1] = Math.round(q.y * 100) / 100;
        this._sync();
      });
      const up = () => { this._drag = null; };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('lostpointercapture', up);

      $$('[data-n]', this.el).forEach(inp => {
        inp.addEventListener('input', () => {
          const i = Number(inp.dataset.n);
          let v = Number(inp.value);
          if (!Number.isFinite(v)) return;
          if (i === 0 || i === 2) v = this._clampX(v);
          else v = Math.max(-2, Math.min(2, v));
          this.p[i] = v;
          this._sync(false);
        });
      });
      $('[data-f="preset"]', this.el).addEventListener('change', (e) => {
        const i = Number(e.target.value);
        if (i >= 0) { this.p = PRESETS[i].v.slice(); this._sync(); }
      });
      $('[data-f="dur"]', this.el).addEventListener('input', (e) => {
        this.dur = Number(e.target.value);
        $('[data-f="durv"]', this.el).textContent = (this.dur / 1000).toFixed(2) + 's';
      });
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'play') {
          this.playing = !this.playing;
          b.textContent = this.playing ? '❚❚' : '▶';
          if (this.playing) this._t0 = performance.now(); else this._draw(0);
        } else if (a === 'loop') {
          this.loop = !this.loop;
          b.classList.toggle('on', this.loop);
        } else if (a === 'copy') {
          const t = this.css();
          (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
            .then(() => toast('已复制 ' + t)).catch(() => toast(t));
        } else if (a === 'save') {
          this.save();
        }
      });
    }

    _clampX(v) { return Math.max(0, Math.min(1, Math.round(v * 100) / 100)); }
    css() {
      const f = (n) => String(Math.round(n * 100) / 100);
      return 'cubic-bezier(' + this.p.map(f).join(',') + ')';
    }

    _sync(redrawInputs = true) {
      if (redrawInputs) {
        $$('[data-n]', this.el).forEach(inp => {
          const v = this.p[Number(inp.dataset.n)];
          if (document.activeElement !== inp) inp.value = String(v);
        });
      }
      const hit = PRESETS.findIndex(x => x.v.every((v, i) => Math.abs(v - this.p[i]) < 0.005));
      const sel = $('[data-f="preset"]', this.el);
      sel.value = String(hit >= 0 ? hit : -1);
      this.cssEl.textContent = this.css();
      this._t0 = performance.now();
    }

    _resize() {
      const box = $('.bz-graph', this.el);
      const cv = this.cv;
      if (!box || !cv) return;
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      this._cw = w; this._ch = h; this._dpr = dpr;
      this._draw(this._last || 0);
    }

    _xy(x, y) {
      const pad = 26;
      const w = (this._cw || 300) - pad * 2, h = (this._ch || 300) - pad * 2;
      return { x:pad + x * w, y:pad + (1 - y) * h };
    }

    /* 画曲线 + 网格 + 控制柄。progress 为 null 时只画静态部分。 */
    _draw(progress) {
      const cv = this.cv, g = cv.getContext('2d');
      if (!g || !this._cw) return;
      const dpr = this._dpr || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = this._cw, H = this._ch, pad = 26;
      g.clearRect(0, 0, W, H);
      const light = document.body.classList.contains('light');
      const cLine = light ? 'rgba(20,40,36,.10)' : 'rgba(180,220,210,.10)';
      const cAxis = light ? 'rgba(20,40,36,.22)' : 'rgba(180,220,210,.22)';
      const cCurve = light ? '#0f8f6f' : '#8de312';
      const cCtrl = light ? 'rgba(15,143,111,.55)' : 'rgba(94,234,212,.6)';

      /* 网格：每 0.25 一格；0 与 1 两条线加深 */
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const a = this._xy(t, 1), b = this._xy(t, 0);
        g.strokeStyle = cLine; g.lineWidth = 1;
        g.beginPath(); g.moveTo(a.x + .5, a.y); g.lineTo(b.x + .5, b.y); g.stroke();
        const c = this._xy(0, t), d = this._xy(1, t);
        g.beginPath(); g.moveTo(c.x, c.y + .5); g.lineTo(d.x, d.y + .5); g.stroke();
      }
      g.strokeStyle = cAxis; g.lineWidth = 1;
      [0, 1].forEach(v => {
        const a = this._xy(0, v), b = this._xy(1, v);
        g.beginPath(); g.moveTo(a.x, a.y + .5); g.lineTo(b.x, b.y + .5); g.stroke();
        const c = this._xy(v, 0), d = this._xy(v, 1);
        g.beginPath(); g.moveTo(c.x + .5, c.y); g.lineTo(d.x + .5, d.y); g.stroke();
      });

      const [x1, y1, x2, y2] = this.p;
      const P0 = this._xy(0, 0), P3 = this._xy(1, 1), P1 = this._xy(x1, y1), P2 = this._xy(x2, y2);

      /* 控制柄 */
      g.strokeStyle = cCtrl; g.lineWidth = 1.2; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(P0.x, P0.y); g.lineTo(P1.x, P1.y); g.stroke();
      g.beginPath(); g.moveTo(P3.x, P3.y); g.lineTo(P2.x, P2.y); g.stroke();
      g.setLineDash([]);

      /* 曲线 */
      const sol = solveBezier(x1, y1, x2, y2);
      g.strokeStyle = cCurve; g.lineWidth = 2.2;
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const q = this._xy(t, sol.fy(t));
        if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.stroke();

      /* 两个控制点 */
      [[P1, '#5eead4'], [P2, '#f5b900']].forEach(([pt, col]) => {
        g.beginPath(); g.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
        g.fillStyle = light ? '#fff' : '#0b1214'; g.fill();
        g.lineWidth = 2.2; g.strokeStyle = col; g.stroke();
      });
      g.beginPath(); g.arc(P0.x, P0.y, 3.5, 0, Math.PI * 2); g.fillStyle = cAxis; g.fill();
      g.beginPath(); g.arc(P3.x, P3.y, 3.5, 0, Math.PI * 2); g.fill();

      /* 进度点：在曲线上爬 */
      if (progress != null) {
        const x = Math.max(0, Math.min(1, progress));
        const q = this._xy(x, sol.at(x));
        g.beginPath(); g.arc(q.x, q.y, 5, 0, Math.PI * 2);
        g.fillStyle = cCurve; g.fill();
        g.strokeStyle = light ? '#fff' : '#04110e'; g.lineWidth = 1.6; g.stroke();
      }
    }

    _loop() {
      const step = (now) => {
        this._raf = requestAnimationFrame(step);
        if (!this.playing) return;
        const t = (now - this._t0) / this.dur;
        let k = t;
        if (!this.loop && k > 1) { k = 1; this.playing = false; const b = $('[data-a="play"]', this.el); if (b) b.textContent = '▶'; }
        const e = solveBezier(...this.p).at(Math.min(1, k));
        /* 小球横向跑 + 一点点纵向起伏，看起来像「被节奏带着走」 */
        const w = this.track.clientWidth || 1;
        const bw = this.ball.offsetWidth || 18;
        this.ball.style.transform = 'translate3d(' + Math.round(e * (w - bw - 8)) + 'px,' + Math.round(-Math.sin(e * Math.PI) * 8) + 'px,0)';
        this._last = Math.min(1, k);
        this._draw(this._last);
      };
      this._raf = requestAnimationFrame(step);
    }

    async save() {
      const data = { kind:'bezier', p:this.p, duration:this.dur, css:this.css(), at:new Date().toISOString() };
      const name = 'bezier-' + String(Math.round(this.p[0] * 100)) + '-' + String(Math.round(this.p[1] * 100)) +
        '-' + String(Math.round(this.p[2] * 100)) + '-' + String(Math.round(this.p[3] * 100)) + '.json';
      try {
        if (typeof Spot !== 'undefined') {
          await Spot.write('.home.' + spotEscape(name), JSON.stringify(data, null, 2), { mime:'application/json', type:'text', hint:'贝塞尔曲线' });
        } else {
          await FS.write('.home.' + spotEscape(name), JSON.stringify(data, null, 2), { mime:'application/json' });
        }
        toast('已保存 .home/' + name);
      } catch (e) { toast('保存失败：' + (e && e.message || e), true); }
    }

    onResize() { this._resize(); }
    dispose() {
      cancelAnimationFrame(this._raf);
      try { this._ro && this._ro.disconnect(); } catch (e) {}
    }
  }

  window.BezierApp = BezierApp;
})();
