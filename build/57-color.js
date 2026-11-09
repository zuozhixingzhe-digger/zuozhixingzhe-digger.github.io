/* ============================================================================
 * HTerMinaL · tools: 调色盘
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 设计目标只有一个：**界面设计时不用切出去**。
 * 所以它必须同时给出 HEX/RGBA、CMYK、HSV、HSL、YUV、Lab 六种表示，
 * 并且任何一种改动都立刻同步到其它五种 —— 单向转换的取色器，用起来像在猜。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 颜色数学
 * 全部按 sRGB（gamma 编码值）工作；只有算 Lab 时才转线性光。
 * 参考：IEC 61966-2-1（sRGB）、ITU-R BT.601（YUV）、CIE 15:2004（Lab, D65）。 */
const ColorMath = {
  clamp(n, a, b) { return Math.min(b, Math.max(a, n)); },
  hexToRgb(hex) {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
    if (/^[0-9a-f]{4}$/i.test(s)) s = s.split('').map(c => c + c).join('');
    if (/^[0-9a-f]{8}$/i.test(s)) {
      return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: parseInt(s.slice(6, 8), 16) / 255 };
    }
    if (!/^[0-9a-f]{6}$/i.test(s)) throw new Error('十六进制要 3/6/8 位');
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
  },
  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(this.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
  },
  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  },
  hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(v => Math.round((v + m) * 255));
  },
  rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
        case g: h = ((b - r) / d + 2) * 60; break;
        default: h = ((r - g) / d + 4) * 60;
      }
    }
    return { h, s: max ? d / max * 100 : 0, v: max * 100 };
  },
  hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360; s /= 100; v /= 100;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(t => Math.round((t + m) * 255));
  },
  rgbToCmyk(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const k = 1 - Math.max(r, g, b);
    if (k === 1) return { c:0, m:0, y:0, k:100 };
    return {
      c: (1 - r - k) / (1 - k) * 100,
      m: (1 - g - k) / (1 - k) * 100,
      y: (1 - b - k) / (1 - k) * 100,
      k: k * 100
    };
  },
  cmykToRgb(c, m, y, k) {
    c /= 100; m /= 100; y /= 100; k /= 100;
    return [
      Math.round(255 * (1 - c) * (1 - k)),
      Math.round(255 * (1 - m) * (1 - k)),
      Math.round(255 * (1 - y) * (1 - k))
    ];
  },
  /* BT.601 全范围。U/V 用 ±0.5 的归一化，显示时乘 255 —— 这是视频里最常见的一套。 */
  rgbToYuv(r, g, b) {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const u = -0.168736 * r - 0.331264 * g + 0.5 * b;
    const v = 0.5 * r - 0.418688 * g - 0.081312 * b;
    return { y, u: u + 128, v: v + 128 };
  },
  yuvToRgb(y, u, v) {
    u -= 128; v -= 128;
    return [
      Math.round(y + 1.402 * v),
      Math.round(y - 0.344136 * u - 0.714136 * v),
      Math.round(y + 1.772 * u)
    ].map(x => this.clamp(x, 0, 255));
  },
  _lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); },
  rgbToXyz(r, g, b) {
    const R = this._lin(r), G = this._lin(g), B = this._lin(b);
    return {
      x: (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100,
      y: (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) * 100,
      z: (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) * 100
    };
  },
  rgbToLab(r, g, b) {
    const { x, y, z } = this.rgbToXyz(r, g, b);
    const wx = 95.047, wy = 100.0, wz = 108.883;
    const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    const fx = f(x / wx), fy = f(y / wy), fz = f(z / wz);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  },
  labToRgb(L, A, B) {
    const wx = 95.047, wy = 100.0, wz = 108.883;
    const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
    const inv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
    const x = wx * inv(fx) / 100, y = wy * inv(fy) / 100, z = wz * inv(fz) / 100;
    let R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    let G = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
    let Bb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
    const g2 = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    return [R, G, Bb].map(c => Math.round(this.clamp(g2(c), 0, 255)));
  },
  luminance(r, g, b) {
    return 0.2126 * this._lin(r) + 0.7152 * this._lin(g) + 0.0722 * this._lin(b);
  },
  contrast(rgb1, rgb2) {
    const a = this.luminance(...rgb1), b = this.luminance(...rgb2);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
};

class ColorApp {
  constructor(container) {
    this.el = container;
    this.h = 174; this.s = 62; this.l = 48; this.a = 1;
    this.picking = false;
    this.viz = 'wheel';
    this._svH = -1;
    this._wg = 0;
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd">
        <b style="letter-spacing:.08em;font-size:10.5px;color:var(--fg-mute)">调色盘</b>
        <div class="col-modes" role="tablist" aria-label="调色方式">
          <button type="button" data-viz="wheel" class="on">色相环</button>
          <button type="button" data-viz="hsv">HSV</button>
          <button type="button" data-viz="rgb">RGB</button>
          <button type="button" data-viz="harm">配色</button>
        </div>
        <span style="flex:1 1 auto"></span>
        <button class="tl-btn sm" data-a="eye">取色器</button>
        <button class="tl-btn sm" data-a="page">页面取色</button>
        <button class="tl-btn sm" data-a="rand">随机</button>
      </div>
      <div class="tl-body">
        <div class="col-wrap">
          <div class="col-left">
            <div class="col-patch" data-f="patch"></div>
            <div class="col-viz">
              <div class="col-view" data-view="wheel">
                <div class="col-wheel" data-f="wheel"><canvas width="400" height="400"></canvas></div>
              </div>
              <div class="col-view" data-view="hsv" hidden>
                <div class="col-sv" data-f="sv"><canvas width="220" height="180"></canvas><i class="col-dot" data-f="svdot"></i></div>
                <div class="col-hue" data-f="hue"><i class="col-hue-mark" data-f="huedot"></i></div>
              </div>
              <div class="col-view" data-view="rgb" hidden>
                <div class="col-chline"><b>R</b><input class="col-ch" type="range" min="0" max="255" data-f="r"><em data-f="rv">0</em></div>
                <div class="col-chline"><b>G</b><input class="col-ch" type="range" min="0" max="255" data-f="g"><em data-f="gv">0</em></div>
                <div class="col-chline"><b>B</b><input class="col-ch" type="range" min="0" max="255" data-f="b"><em data-f="bv">0</em></div>
              </div>
              <div class="col-view" data-view="harm" hidden>
                <div class="col-harm" data-f="harm"></div>
              </div>
            </div>
            <div class="col-sl">
              <span>L</span><input type="range" min="0" max="100" step="1" data-f="sl">
              <span data-f="slv">48%</span>
              <span>A</span><input type="range" min="0" max="100" step="1" data-f="sa" value="100">
              <span data-f="sav">100%</span>
            </div>
            <div class="tl-note" style="margin:2px 0 0">历史</div>
            <div class="col-sw" data-f="sw"></div>
          </div>
          <div class="col-right" data-f="right"></div>
        </div>
      </div>
    </div>`;
    this.patch = this.el.querySelector('[data-f="patch"]');
    this.wheelBox = this.el.querySelector('[data-f="wheel"]');
    this.canvas = this.wheelBox.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently:true });
    this.svBox = this.el.querySelector('[data-f="sv"]');
    this.svCanvas = this.svBox.querySelector('canvas');
    this.svCtx = this.svCanvas.getContext('2d');
    this.hueBox = this.el.querySelector('[data-f="hue"]');
    this.right = this.el.querySelector('[data-f="right"]');
    this.buildRight();
    this.bind();
    this.setViz('wheel', true);
    this.drawWheel();
    this.sync();
  }
  /* ---------- 右侧六种表示 ---------- */
  buildRight() {
    const rows = [
      ['HEX', 'hex', 'text'],
      ['RGBA', 'rgba', 'text'],
      ['RGB', 'rgb', 'text'],
      ['HSL', 'hsl', 'text'],
      ['HSV', 'hsv', 'text'],
      ['CMYK', 'cmyk', 'text'],
      ['YUV', 'yuv', 'text'],
      ['Lab', 'lab', 'text'],
      ['CSS', 'css', 'text']
    ];
    this.right.innerHTML = rows.map(([label, k]) =>
      `<div class="col-kv"><b>${label}</b>
        <input class="tl-in" data-f="${k}" spellcheck="false">
        <button class="tl-btn sm" data-cp="${k}">复制</button></div>`).join('') +
      `<div class="tl-card" style="margin-top:10px"><h4>对比度（WCAG）</h4>
        <div data-f="wcag"></div></div>
      <div class="tl-note">
        任何一格都能直接改：改 HEX 会反向算出 HSL，改 CMYK 会回到 RGB ——
        六个表示是同一份状态的不同投影，不存在「以谁为准」。<br>
        YUV 用 BT.601 全范围；Lab 用 D65 白点。CMYK 是<b>无色彩管理的近似值</b>，
        真要印刷请以印厂的 ICC 为准。HSV 就是 HSB（B = Value，同一件事的两个名字）。
      </div>`;
    this.right.querySelectorAll('[data-cp]').forEach(b => {
      b.onclick = () => ToolKit.copy(this.right.querySelector('[data-f="' + b.dataset.cp + '"]').value);
    });
    this.right.querySelectorAll('input[data-f]').forEach(inp => {
      inp.addEventListener('change', () => this.commit(inp.dataset.f, inp.value));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.commit(inp.dataset.f, inp.value); });
    });
  }

  bind() {
    const q = s => this.el.querySelector(s);
    const sl = q('[data-f="sl"]');
    const sa = q('[data-f="sa"]');
    sl.addEventListener('input', () => { this.l = Number(sl.value); this.drawWheel(); this.sync(); });
    sa.addEventListener('input', () => { this.a = Number(sa.value) / 100; this.sync(); });

    /* 顶部：四种调色方式互斥切换 */
    this.el.querySelectorAll('[data-viz]').forEach(b => {
      b.onclick = () => this.setViz(b.dataset.viz);
    });
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) {
        if (b.dataset.a === 'eye') this.eyedropper();
        else if (b.dataset.a === 'page') this.pickFromPage();
        else if (b.dataset.a === 'rand') {
          const hsl = ColorMath.hslToRgb(Math.random() * 360, 45 + Math.random() * 55, 30 + Math.random() * 40);
          const t = ColorMath.rgbToHsl(...hsl);
          this.h = t.h; this.s = t.s; this.l = t.l;
          this.drawWheel(); this.sync();
        }
        return;
      }
      /* 配色方案：点色块即应用 */
      const sw = e.target.closest('[data-pick]');
      if (sw) {
        const m = sw.dataset.pick.split(',');
        this.h = Number(m[0]); this.s = Number(m[1]); this.l = Number(m[2]);
        if (m[3] != null) this.a = Number(m[3]);
        this.drawWheel(); this.sync();
      }
    });

    const drag = (e) => {
      if (!this.picking) return;
      e.preventDefault();
      this.pickAt(e.clientX, e.clientY);
    };
    this.wheelBox.addEventListener('pointerdown', (e) => {
      this.picking = true;
      try { this.wheelBox.setPointerCapture(e.pointerId); } catch (err) {}
      this.pickAt(e.clientX, e.clientY);
    });
    this.wheelBox.addEventListener('pointermove', drag);
    this.wheelBox.addEventListener('pointerup', () => { this.picking = false; });
    this.wheelBox.addEventListener('pointercancel', () => { this.picking = false; });

    /* HSV：SV 方块 + 色相条 */
    let svDrag = false, hueDrag = false;
    const pickSV = (e) => {
      const r = this.svCanvas.getBoundingClientRect();
      const x = ColorMath.clamp((e.clientX - r.left) / r.width, 0, 1);
      const y = ColorMath.clamp((e.clientY - r.top) / r.height, 0, 1);
      /* 方块上这一点就是 HSV(h, x, 1-y)。先算成 RGB，再反解成 HSL 存进状态——
       * 直接把 HSV 的 S 塞进 HSL 的 S 会得到另一个颜色，
       * 表现就是「点上面、选中的却是下面」（上下像镜像）。 */
      const [rr, gg, bb] = ColorMath.hsvToRgb(this.h, x * 100, (1 - y) * 100);
      const t = ColorMath.rgbToHsl(rr, gg, bb);
      this.s = t.s;
      this.l = t.l;
      this.drawWheel();
      this.sync();
    };
    const pickHue = (e) => {
      const r = this.hueBox.getBoundingClientRect();
      this.h = ColorMath.clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
      this.drawWheel();
      this.sync();
    };
    this.svBox.addEventListener('pointerdown', (e) => {
      svDrag = true;
      try { this.svBox.setPointerCapture(e.pointerId); } catch (err) {}
      pickSV(e);
    });
    this.svBox.addEventListener('pointermove', (e) => { if (svDrag) { e.preventDefault(); pickSV(e); } });
    this.svBox.addEventListener('pointerup', () => { svDrag = false; });
    this.svBox.addEventListener('pointercancel', () => { svDrag = false; });
    this.hueBox.addEventListener('pointerdown', (e) => {
      hueDrag = true;
      try { this.hueBox.setPointerCapture(e.pointerId); } catch (err) {}
      pickHue(e);
    });
    this.hueBox.addEventListener('pointermove', (e) => { if (hueDrag) { e.preventDefault(); pickHue(e); } });
    this.hueBox.addEventListener('pointerup', () => { hueDrag = false; });
    this.hueBox.addEventListener('pointercancel', () => { hueDrag = false; });

    /* RGB 三个通道：直接驱动主色 */
    ['r', 'g', 'b'].forEach(k => {
      const inp = q('[data-f="' + k + '"]');
      inp.addEventListener('input', () => {
        const cur = this.rgb.slice();
        cur['rgb'.indexOf(k)] = Number(inp.value);
        const t = ColorMath.rgbToHsl(...cur);
        this.h = t.h; this.s = t.s; this.l = t.l;
        this.drawWheel();
        this.sync();
      });
    });

    q('[data-f="sw"]').addEventListener('click', (e) => {
      const i = e.target.closest('i');
      if (!i) return;
      const c = ColorMath.hexToRgb(i.dataset.hex);
      const t = ColorMath.rgbToHsl(c.r, c.g, c.b);
      this.h = t.h; this.s = t.s; this.l = t.l; this.a = c.a;
      this.drawWheel(); this.sync();
    });
  }

  setViz(v, silent) {
    this.viz = v;
    this.el.querySelectorAll('[data-viz]').forEach(b => b.classList.toggle('on', b.dataset.viz === v));
    this.el.querySelectorAll('[data-view]').forEach(d => { d.hidden = d.dataset.view !== v; });
    if (v === 'hsv') this.drawSV(true);
    if (v === 'rgb') this.paintChannels();
    if (v === 'harm') this.drawHarm();
  }

  /* HSV 里 V 和 HSL 的 L 不是一回事，但底色一致：用 L 反推 V，
   * 这样在两个视图之间来回切，颜色不会自己变。 */
  _v2l(v) {
    return ColorMath.rgbToHsl(...ColorMath.hsvToRgb(this.h, this.s, v)).l;
  }
  _l2v() {
    return ColorMath.rgbToHsv(...this.rgb).v;
  }

  drawSV(force) {
    if (!this.svCanvas) return;
    const W = this.svCanvas.width, H = this.svCanvas.height;
    const ctx = this.svCtx;
    const h = Math.round(this.h * 10) / 10;
    if (!force && h === this._svH) return;
    this._svH = h;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = (1 - y / (H - 1)) * 100;
      for (let x = 0; x < W; x++) {
        const s = (x / (W - 1)) * 100;
        const [r, g, b] = ColorMath.hsvToRgb(h, s, v);
        const i = (y * W + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* RGB 三条滑条的底色跟着当前颜色走：轨道本身就是这一段通道的渐变 */
  paintChannels() {
    const [r, g, b] = this.rgb;
    const q = s => this.el.querySelector(s);
    const set = (k, from, to, val) => {
      const inp = q('[data-f="' + k + '"]');
      if (!inp) return;
      inp.value = String(val);
      inp.style.background = `linear-gradient(to right, rgb(${from}), rgb(${to}))`;
      const em = q('[data-f="' + k + 'v"]');
      if (em) em.textContent = String(val);
    };
    set('r', [0, g, b], [255, g, b], r);
    set('g', [r, 0, b], [r, 255, b], g);
    set('b', [r, g, 0], [r, g, 255], b);
  }

  /* 配色方案：互补 / 三角 / 四角 / 类似 / 单色 —— 全部由主色算出来 */
  drawHarm() {
    const box = this.el.querySelector('[data-f="harm"]');
    if (!box) return;
    const mk = (label, list) => {
      const items = list.map(([h, s, l, a], i) => {
        const rgb = ColorMath.hslToRgb(h, s, l);
        const hex = ColorMath.rgbToHex(...rgb);
        const main = Math.abs(((h - this.h + 540) % 360) - 180) < 0.5 ? ' main' : '';
        return `<button type="button" class="col-chip${main}" data-pick="${h.toFixed(1)},${s.toFixed(1)},${l.toFixed(1)},${a == null ? 1 : a}"
          style="background:${hex}" title="${label} · ${hex} · 点击应用"></button>`;
      }).join('');
      return `<div class="col-hrow"><b>${label}</b><div class="col-hsw">${items}</div></div>`;
    };
    const H = this.h, S = this.s, L = this.l;
    const wrap360 = x => ((x % 360) + 360) % 360;
    box.innerHTML =
      mk('互补', [[H, S, L], [wrap360(H + 180), S, L]]) +
      mk('三角', [[H, S, L], [wrap360(H + 120), S, L], [wrap360(H + 240), S, L]]) +
      mk('四角', [[H, S, L], [wrap360(H + 90), S, L], [wrap360(H + 180), S, L], [wrap360(H + 270), S, L]]) +
      mk('类似', [[wrap360(H - 32), S, L], [wrap360(H - 16), S, L], [H, S, L], [wrap360(H + 16), S, L], [wrap360(H + 32), S, L]]) +
      mk('单色', [18, 32, 46, 60, 74].map(l => [H, S, l]));
  }

  drawWheelNow() { this.drawWheel(); }

  get rgb() { return ColorMath.hslToRgb(this.h, this.s, this.l); }

  /* ---------- 色相环 ---------- */
  drawWheel() {
    const N = 200, cv = this.canvas, ctx = this.ctx;
    const img = ctx.createImageData(N, N);
    const R = N / 2 - 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * N + x) * 4;
        if (dist > R) { img.data[i + 3] = 0; continue; }
        /* 边缘 1.5px 做羽化，省得看着像锯齿 */
        const edge = Math.min(1, R - dist);
        const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const sat = Math.min(1, dist / R) * 100;
        const [r, g, b] = ColorMath.hslToRgb(hue, sat, this.l);
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
        img.data[i + 3] = Math.round(255 * edge);
      }
    }
    /* canvas 是 400×400 但 CSS 200，用离屏再放大，避免 ImageData 每次重算 */
    const off = document.createElement('canvas');
    off.width = off.height = N;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.clearRect(0, 0, 400, 400);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, 400, 400);
    /* 当前点的十字标记：内外两圈保证深浅底上都看得见 */
    const ang = this.h * Math.PI / 180;
    const rad = (this.s / 100) * (200 - 2);
    const cx = 200 + Math.cos(ang) * rad, cy = 200 + Math.sin(ang) * rad;
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  pickAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const dx = clientX - r.left - cx, dy = clientY - r.top - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = r.width / 2 - 1;
    this.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    this.s = ColorMath.clamp(dist / maxR, 0, 1) * 100;
    this.drawWheel();
    this.sync();
  }

  /* ---------- 同步六种表示 ---------- */
  sync() {
    const [r, g, b] = this.rgb;
    const a = this.a;
    const hsl = ColorMath.rgbToHsl(r, g, b);
    const hsv = ColorMath.rgbToHsv(r, g, b);
    const cmyk = ColorMath.rgbToCmyk(r, g, b);
    const yuv = ColorMath.rgbToYuv(r, g, b);
    const lab = ColorMath.rgbToLab(r, g, b);
    const hex = ColorMath.rgbToHex(r, g, b);
    const hexA = a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() : hex;
    const f = (n, d = 0) => Number(n).toFixed(d);
    const vals = {
      hex: hexA,
      rgba: `rgba(${r}, ${g}, ${b}, ${f(a, 2)})`,
      rgb: `${r}, ${g}, ${b}`,
      hsl: `${f(hsl.h)}, ${f(hsl.s)}%, ${f(hsl.l)}%`,
      hsv: `${f(hsv.h)}, ${f(hsv.s)}%, ${f(hsv.v)}%`,
      cmyk: `${f(cmyk.c)}, ${f(cmyk.m)}, ${f(cmyk.y)}, ${f(cmyk.k)}`,
      yuv: `${f(yuv.y)}, ${f(yuv.u)}, ${f(yuv.v)}`,
      lab: `${f(lab.l, 1)}, ${f(lab.a, 1)}, ${f(lab.b, 1)}`,
      css: a < 1 ? `rgb(${r} ${g} ${b} / ${f(a, 2)})` : `rgb(${r} ${g} ${b})`
    };
    for (const [k, v] of Object.entries(vals)) {
      const inp = this.right.querySelector('[data-f="' + k + '"]');
      if (!inp || inp === document.activeElement) continue;
      inp.value = v;
    }
    this.patch.style.background = `rgba(${r},${g},${b},${a})`;
    this.patch.innerHTML = `<span style="position:absolute;right:6px;bottom:3px;font-size:9px;letter-spacing:.06em;
      color:${ColorMath.luminance(r, g, b) > 0.35 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.6)'}">${hexA}</span>`;
    this.el.querySelector('[data-f="sl"]').value = Math.round(this.l);
    this.el.querySelector('[data-f="slv"]').textContent = Math.round(this.l) + '%';
    this.el.querySelector('[data-f="sa"]').value = Math.round(a * 100);
    this.el.querySelector('[data-f="sav"]').textContent = Math.round(a * 100) + '%';

    /* 另外三种视图全部跟着主色走：不是四套取色器，是同一个颜色的四种看法 */
    const dot = this.el.querySelector('[data-f="svdot"]');
    if (dot) {
      /* 标记的位置必须用 HSV 的 S/V，不能拿 HSL 的 S 顶替 */
      const cur = ColorMath.rgbToHsv(r, g, b);
      dot.style.left = cur.s.toFixed(2) + '%';
      dot.style.top = (100 - cur.v).toFixed(2) + '%';
      dot.style.background = `rgb(${r},${g},${b})`;
    }
    this.drawSV();
    const hueDot = this.el.querySelector('[data-f="huedot"]');
    if (hueDot) hueDot.style.left = (this.h / 360 * 100).toFixed(2) + '%';
    if (this.viz === 'rgb') this.paintChannels();
    if (this.viz === 'harm') this.drawHarm();
    const cw = ColorMath.contrast([r, g, b], [255, 255, 255]);
    const cb = ColorMath.contrast([r, g, b], [0, 0, 0]);
    const mark = (v, need) => v >= need ? `<span style="color:var(--green)">✓ ${v.toFixed(2)}</span>` : `<span style="color:var(--amber)">${v.toFixed(2)}</span>`;
    this.right.querySelector('[data-f="wcag"]').innerHTML =
      `<div class="tl-kv"><b>对白底</b><code style="border:0;background:none;padding:0">${mark(cw, 4.5)} · AA 需 4.5，AAA 需 7</code><span></span></div>
       <div class="tl-kv"><b>对黑底</b><code style="border:0;background:none;padding:0">${mark(cb, 4.5)} · AA 需 4.5，AAA 需 7</code><span></span></div>`;
    this.pushSwatch(hex);
  }
  pushSwatch(hex) {
    try {
      const key = 'ht.colors';
      let arr = JSON.parse(localStorage.getItem(key) || '[]');
      if (arr[0] !== hex) {
        arr = [hex].concat(arr.filter(x => x !== hex)).slice(0, 18);
        localStorage.setItem(key, JSON.stringify(arr));
      }
      this.el.querySelector('[data-f="sw"]').innerHTML = arr.map(h =>
        `<i data-hex="${esc(h)}" style="background:${esc(h)}" title="${esc(h)}"></i>`).join('');
    } catch (e) {}
  }
  commit(field, raw) {
    const s = String(raw || '').trim();
    if (!s) return;
    try {
      let rgb = null, a = this.a;
      if (field === 'hex') {
        const c = ColorMath.hexToRgb(s);
        rgb = [c.r, c.g, c.b]; a = c.a;
      } else if (field === 'rgb' || field === 'rgba') {
        const n = s.match(/-?\d+(\.\d+)?/g) || [];
        if (n.length < 3) throw new Error('要三个数');
        rgb = n.slice(0, 3).map(Number);
        if (n.length > 3) a = ColorMath.clamp(Number(n[3]), 0, 1);
      } else if (field === 'hsl') {
        const n = s.match(/-?\d+(\.\d+)?/g) || [];
        if (n.length < 3) throw new Error('要三个数');
        rgb = ColorMath.hslToRgb(Number(n[0]), Number(n[1]), Number(n[2]));
      } else if (field === 'hsv') {
        const n = s.match(/-?\d+(\.\d+)?/g) || [];
        if (n.length < 3) throw new Error('要三个数');
        rgb = ColorMath.hsvToRgb(Number(n[0]), Number(n[1]), Number(n[2]));
      } else if (field === 'cmyk') {
        const n = s.match(/-?\d+(\.\d+)?/g) || [];
        if (n.length < 4) throw new Error('要四个数');
        rgb = ColorMath.cmykToRgb(Number(n[0]), Number(n[1]), Number(n[2]), Number(n[3]));
      } else if (field === 'yuv') {
        const n = s.match(/-?\d+(\.\d+)?/g) || [];
        if (n.length < 3) throw new Error('要三个数');
        rgb = ColorMath.yuvToRgb(Number(n[0]), Number(n[1]), Number(n[2]));
      } else if (field === 'lab') {
        const n = s.match(/-?\d+(\.\d+)?/g) || [];
        if (n.length < 3) throw new Error('要三个数');
        rgb = ColorMath.labToRgb(Number(n[0]), Number(n[1]), Number(n[2]));
      } else if (field === 'css') {
        const m = s.match(/rgba?\(([^)]+)\)/i);
        if (!m) throw new Error('形如 rgb(1 2 3)');
        const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        rgb = n.slice(0, 3);
        if (n.length > 3) a = ColorMath.clamp(n[3], 0, 1);
      }
      if (!rgb) return;
      rgb = rgb.map(v => ColorMath.clamp(Math.round(v), 0, 255));
      const t = ColorMath.rgbToHsl(...rgb);
      this.h = t.h; this.s = t.s; this.l = t.l;
      this.a = a;
      this.drawWheel();
      this.sync();
    } catch (e) {
      toast('格式不对：' + (e.message || e), true);
      this.sync();
    }
  }

  /* ---------- 取色 ---------- */
  async eyedropper() {
    if (!window.EyeDropper) {
      toast('这个浏览器没有 EyeDropper，改用「从页面取色」');
      return this.pickFromPage();
    }
    try {
      const res = await new EyeDropper().open();
      this.commit('hex', res.sRGBHex);
    } catch (e) { /* 用户按 Esc 取消，不算错 */ }
  }
  async pickFromPage() {
    let url;
    try {
      /* 先拍一张，再在照片上点 —— 这样点到的就是「截图那一刻」的像素，
       * 不会因为遮罩挡住了页面而永远取到遮罩的颜色。 */
      url = await shot(document.body, { scale:1 });
    } catch (e) { toast('截图失败：' + (e && e.message || e), true); return; }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;cursor:crosshair;overflow:auto';
    const img = new Image();
    img.src = url;
    img.style.cssText = 'position:absolute;left:0;top:0;width:100%;display:block;max-width:none';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:8px 12px;background:rgba(0,0,0,.78);' +
      'color:#d6e7e3;font:11px/1.6 ui-monospace,monospace;z-index:2;text-align:center';
    bar.textContent = '点图片任意位置取色 · Esc 取消（注意：截图里包含调色盘窗口自身，先把窗口挪开更准）';
    wrap.appendChild(img);
    wrap.appendChild(bar);
    document.body.appendChild(wrap);
    const done = () => { wrap.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') done(); };
    document.addEventListener('keydown', esc, true);
    await new Promise((res) => { img.onload = res; img.onerror = res; });
    wrap.addEventListener('click', (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * img.naturalWidth);
      const y = Math.floor((e.clientY - r.top) / r.height * img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently:true });
      ctx.drawImage(img, 0, 0);
      try {
        const d = ctx.getImageData(x, y, 1, 1).data;
        this.commit('rgb', d[0] + ',' + d[1] + ',' + d[2]);
        this.a = d[3] / 255;
        this.sync();
      } catch (err) { toast('读不到像素：' + (err.message || err), true); }
      done();
    }, { once:true });
  }
}
