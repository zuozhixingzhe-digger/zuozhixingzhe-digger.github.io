/* ============================================================================
 * 渲染守护（Guard）
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 *
 * 一个 Worker 心跳（10 秒）+ 画布尺寸变化，用来检查「页面上有没有不合规的东西」：
 *   · 窗口宽高是不是 NaN / 小于下限 / 大于画布
 *   · 提手是不是比窗口还高（极窄窗口才会出现）
 *   · 窗口是不是整个跑出画布（拖出去一半是允许的，全出去不是）
 *   · 文档有没有被某个元素撑出横向滚动条
 * 发现就强制改回合法范围。改完进入「睡死时间」：15 秒内不再动这扇窗，
 * 免得用户正在拖、守护每帧把它拽回去 —— 那种闪烁比不合规更难受。
 *
 * 以后所有「定期巡检」类的事都挂在这里：Guard.every(name, fn, ms)。
 * ==========================================================================*/
const Guard = {
  ready: false,
  worker: null,
  beat: 0,
  tasks: new Map(),
  _fallbackTimer: 0,
  _lastFix: 0,
  _coolUntil: 0,
  _rz: 0,

  init() {
    if (this.ready) return;
    this.ready = true;

    /* Worker 只做一件事：每 10 秒敲一下。主线程拿到消息再干活——
     * DOM 只有主线程能碰，Worker 负责的是「不被后台标签页节流」这件事。 */
    try {
      const src = 'let n=0;setInterval(()=>postMessage(n++),10000);' +
        'onmessage=e=>{if(e.data==="ping")postMessage(n)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = () => this._tick();
      w.onerror = () => { try { w.terminate(); } catch (e) {} this.worker = null; this._startFallback(); };
      this.worker = w;
    } catch (e) {
      this._startFallback();
    }

    const wake = () => {
      clearTimeout(this._rz);
      this._rz = setTimeout(() => this._tick(true), 280);
    };
    addEventListener('resize', wake);
    addEventListener('orientationchange', wake);
    if (window.visualViewport) visualViewport.addEventListener('resize', wake);
    /* 启动后先看一眼：这时内置窗口已经开出来了 */
    setTimeout(() => this._tick(true), 1600);
  },

  _startFallback() {
    if (this._fallbackTimer) return;
    this._fallbackTimer = setInterval(() => this._tick(), 10000);
  },

  /* 注册一个巡检任务。ms 是间隔；force=true（resize）时全部立刻跑一次。 */
  every(name, fn, ms) {
    this.tasks.set(name, { fn, ms: Math.max(1000, ms || 10000), last: 0 });
    return () => this.tasks.delete(name);
  },

  _tick(force) {
    this.beat++;
    const now = performance.now();
    for (const t of this.tasks.values()) {
      if (!force && now - t.last < t.ms) continue;
      t.last = now;
      try { t.fn(force); } catch (e) { /* 单个守护任务失败不能拖垮别的 */ }
    }
    this.check(force);
  },

  check(force) {
    if (!force && Date.now() < this._coolUntil) return;
    const desk = document.getElementById('desk');
    if (!desk) return;
    const box = deskBox();
    const vw = Math.max(120, innerWidth), vh = Math.max(120, innerHeight);
    let fixed = 0;

    /* 1. 画布本身：宽高必须是有效数字。某些移动端在旋转时会短暂给出 0。 */
    if (!Number.isFinite(box.w) || box.w < 120) { desk.style.minWidth = '160px'; fixed++; }
    if (!Number.isFinite(box.h) || box.h < 120) { desk.style.minHeight = '160px'; fixed++; }

    /* 2. 文档溢出：有元素把页面撑宽了，先找出来再收住。
     *    直接 overflow:hidden 能让滚动条消失，但也会裁掉窗口阴影，所以只在真的溢出时做。 */
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 2) {
      doc.style.overflowX = 'hidden';
      fixed++;
    } else if (doc.style.overflowX === 'hidden' && doc.scrollWidth <= vw + 2) {
      doc.style.overflowX = '';
    }

    if (typeof WindowManager === 'undefined' || !WindowManager.windows) return;

    const MINW = 280;
    const MINH = 150;
    const dockReserve = Number(Settings.get('dockHidden')) ? 16 : 78;

    for (const w of WindowManager.windows.values()) {
      const el = w.el;
      if (!el || !el.isConnected) continue;
      /* 最大化 / 隐藏式 / 全屏由 CSS 接管尺寸，守护不碰 */
      if (w.mode && w.mode !== 'normal') continue;
      if (w.minimized) continue;
      /* 睡死时间：刚被修过、或者用户正在拖这扇窗 */
      if (Date.now() < (w._guardUntil || 0)) continue;
      if (el.classList.contains('dragging') || el.classList.contains('resizing')) continue;

      let l = parseFloat(el.style.left);
      let t = parseFloat(el.style.top);
      let ww = parseFloat(el.style.width);
      let hh = parseFloat(el.style.height);
      if (!Number.isFinite(ww)) ww = el.offsetWidth;
      if (!Number.isFinite(hh)) hh = el.offsetHeight;
      if (!Number.isFinite(l)) l = el.offsetLeft;
      if (!Number.isFinite(t)) t = el.offsetTop;

      const maxW = Math.max(MINW, box.w);
      const maxH = Math.max(MINH + 40, box.h - dockReserve);
      let bad = false;

      if (!Number.isFinite(l) || !Number.isFinite(t) ||
          !Number.isFinite(ww) || !Number.isFinite(hh)) {
        /* 参数已经坏了：退回一个肯定合法的矩形，而不是继续用 NaN */
        l = 24; t = 24; ww = Math.min(820, maxW); hh = Math.min(560, maxH);
        bad = true;
      }
      if (ww < MINW) { ww = MINW; bad = true; }
      if (ww > maxW) { ww = maxW; bad = true; }
      if (hh < MINH + (w._hh || 56)) { hh = MINH + (w._hh || 56); bad = true; }
      if (hh > box.h) { hh = box.h; bad = true; }
      /* 至少留 90px 在画布里：允许半出界，不允许整个消失 */
      if (l > box.w - 90) { l = box.w - 90; bad = true; }
      if (l + ww < 90) { l = 90 - ww; bad = true; }
      if (t < 0) { t = 0; bad = true; }
      if (t > box.h - 44) { t = box.h - 44; bad = true; }

      /* 提手不得高于窗口的一半：极窄窗口下按比例算出来的 --hh 会吃掉整个画面 */
      if ((w._hh || 0) > hh * 0.55) {
        try { WindowManager._layoutChrome(w); } catch (e) {}
        bad = true;
      }

      if (bad) {
        el.style.left = Math.round(l) + 'px';
        el.style.top = Math.round(t) + 'px';
        el.style.width = Math.round(ww) + 'px';
        el.style.height = Math.round(hh) + 'px';
        w._guardUntil = Date.now() + 15000;
        fixed++;
        try { w.content && w.content.onResize && w.content.onResize(); } catch (e) {}
      }
    }

    if (fixed) {
      this._lastFix = Date.now();
      this._coolUntil = Date.now() + 3000;
    }
  },

  /* 窗口刚打开 / 内容变了，主动看一眼（不等 10 秒心跳） */
  poke() { setTimeout(() => this.check(true), 120); }
};
