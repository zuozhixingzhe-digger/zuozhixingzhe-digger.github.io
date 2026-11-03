/* ============================================================================
 * 4. 看图 / 修图
 *
 * 定位很明确：**截图的下半场**。截完图通常要做三件事——裁掉多余的部分、
 * 圈出重点、把敏感信息糊掉，然后存回去。所以这里不做图层、不做滤镜库、
 * 不做矢量对象，就一条：把像素改对，并且能撤销。
 *
 * 几条实现上的取舍：
 *   1) 全部用 Canvas 2D，不用 CSS filter。CSS filter 只是「看起来」变了，
 *      toDataURL / 下载拿到手的还是原图——导出的东西必须和眼睛看到的一致。
 *   2) 撤销存的是 canvas 快照，不是操作日志。操作日志要每种工具写一遍逆运算，
 *      而这里的工具都是「画一笔」，快照更短也更不容易错。代价是内存，
 *      所以按像素数限制步数（大图 4 步、小图 16 步），见 _maxUndo()。
 *   3) 裁剪 / 马赛克松手即生效。这两件事没有「再想想」的必要——
 *      真按错了 Ctrl+Z 就回来了，比多一个确认条更快。
 *   4) 画笔只画在当前图上，不保留可再编辑的对象。截图是扁平的，
 *      把它当设计工具用会失望；要图层请开真正的设计软件。
 * ==========================================================================*/

const IMG_MAX_UNDO = 16;

function imgCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w) || 1);
  c.height = Math.max(1, Math.round(h) || 1);
  return c;
}
function imgCopy(src) {
  const c = imgCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

class ImageApp {
  constructor(container, opts) {
    opts = opts || {};
    this.el = container;
    this.onTitle = null;
    this.base = null;          // 当前图像（离屏 canvas），所有修改都落在这里
    this.name = opts.name || '';
    this.path = opts.path || '';
    this.savedPath = '';       // 第一次「存到 .home」之后记住路径，再存就覆盖它
    this.zoom = 1;
    this.autoFit = true;
    this.tool = 'move';
    this.color = '#ff5a5f';
    this.lineW = 2;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this._build();
    this._bind();
    if (opts.dataUrl) {
      this.loadDataUrl(opts.dataUrl, opts.name || '截图')
        .catch(e => toast('打不开这张图：' + (e && e.message || e), true));
    } else if (opts.path) this.loadPath(opts.path);
  }

  /* ---------------------------------------------------------------- 骨架 */
  _build() {
    this.el.tabIndex = 0;
    this.el.dataset.imgApp = '1';
    this.el.__imgApp = this;
    this.el.innerHTML = `<div class="ie">
      <div class="ie-hd">
        <button class="tl-btn sm" data-a="open" title="打开本机图片">打开</button>
        <button class="tl-btn sm" data-a="fromfs" title="从 spotfs 里选">.home</button>
        <span class="ie-sep"></span>
        <button class="tl-btn sm" data-a="undo" title="撤销（Ctrl+Z）">↶</button>
        <button class="tl-btn sm" data-a="redo" title="重做（Ctrl+Shift+Z）">↷</button>
        <span class="ie-sep"></span>
        <button class="tl-btn sm" data-tool="crop" title="裁剪：拖出要保留的区域，松手即裁">裁剪</button>
        <button class="tl-btn sm" data-tool="rect" title="矩形框">▭</button>
        <button class="tl-btn sm" data-tool="arrow" title="箭头">↗</button>
        <button class="tl-btn sm" data-tool="brush" title="画笔">✎</button>
        <button class="tl-btn sm" data-tool="text" title="文字：点一下再输入">T</button>
        <button class="tl-btn sm" data-tool="mosaic" title="马赛克：涂掉密钥、手机号">打码</button>
        <input type="color" class="ie-color" data-f="color" value="#ff5a5f" title="标注颜色；Alt+点击画面可直接取色">
        <select class="ie-w" data-f="width" title="线宽 / 字号">
          <option value="1">细</option><option value="2" selected>中</option>
          <option value="3">粗</option><option value="5">更粗</option><option value="8">特粗</option>
        </select>
        <span class="ie-sep"></span>
        <button class="tl-btn sm" data-a="rotl" title="左转 90°">⟲</button>
        <button class="tl-btn sm" data-a="rotr" title="右转 90°">⟳</button>
        <button class="tl-btn sm" data-a="fliph" title="水平翻转">↔</button>
        <button class="tl-btn sm" data-a="flipv" title="垂直翻转">↕</button>
        <button class="tl-btn sm" data-a="resize" title="按百分比缩放">缩放</button>
        <span class="ie-sp"></span>
        <button class="tl-btn sm" data-a="fit" title="适应窗口（0）">适应</button>
        <button class="tl-btn sm" data-a="zoomout" title="缩小（-）">−</button>
        <span class="ie-zoom" data-f="zoom">100%</span>
        <button class="tl-btn sm" data-a="zoomin" title="放大（+）">＋</button>
      </div>
      <div class="ie-stage" data-f="stage">
        <div class="ie-empty" data-f="empty">
          <div class="ie-empty-in">
            <div class="ie-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.6" cy="10" r="1.5"/><path d="M4.2 17.2l4.6-4.4 3 2.8 3.2-2.6 4.8 4.4"/></svg></div>
            <h3>看图 / 修图</h3>
            <p>拖一张图片进来，或者在截图窗口点「编辑」直接送过来。</p>
            <div class="ie-empty-btns">
              <button class="tl-btn" data-a="open">打开本地文件</button>
              <button class="tl-btn" data-a="fromfs">从 .home 选择</button>
            </div>
            <p class="tl-note">Alt+点击画面取色 · Ctrl+Z 撤销 · Ctrl+V 粘贴剪贴板里的图片</p>
          </div>
        </div>
        <div class="ie-paper" data-f="paper" data-tool="move" hidden>
          <canvas data-f="view"></canvas>
          <canvas data-f="ov"></canvas>
        </div>
      </div>
      <div class="ie-ft">
        <button class="tl-btn sm" data-a="save" disabled>存到 .home</button>
        <button class="tl-btn sm" data-a="down" disabled>下载</button>
        <button class="tl-btn sm" data-a="copy" disabled>复制</button>
        <select class="ie-fmt" data-f="type" title="导出格式">
          <option value="image/png">PNG</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/webp">WebP</option>
        </select>
        <span class="ie-sp"></span>
        <span class="ie-meta" data-f="meta">未打开图片</span>
        <span class="ie-pos" data-f="pos"></span>
      </div>
    </div>`;
    this.stage = $('[data-f="stage"]', this.el);
    this.paper = $('[data-f="paper"]', this.el);
    this.view = $('[data-f="view"]', this.el);
    this.ov = $('[data-f="ov"]', this.el);
    this.vctx = this.view.getContext('2d');
    this.octx = this.ov.getContext('2d');
    this._setTool('move');
  }

  _bind() {
    const click = (e) => {
      const b = e.target.closest('[data-a],[data-tool]');
      if (!b) return;
      if (b.dataset.tool) { this._setTool(b.dataset.tool); return; }
      const a = b.dataset.a;
      if (a === 'open') this.openLocal();
      else if (a === 'fromfs') this.openFromFs();
      else if (a === 'undo') this.undo();
      else if (a === 'redo') this.redo();
      else if (a === 'rotl') this.rotate(-90);
      else if (a === 'rotr') this.rotate(90);
      else if (a === 'fliph') this.flip(true);
      else if (a === 'flipv') this.flip(false);
      else if (a === 'resize') this.resizeAsk();
      else if (a === 'fit') this.fit();
      else if (a === 'zoomout') this.zoomBy(1 / 1.25);
      else if (a === 'zoomin') this.zoomBy(1.25);
      else if (a === 'save') this.save();
      else if (a === 'down') this.download();
      else if (a === 'copy') this.copyImg();
    };
    this.el.addEventListener('click', click);
    $('[data-f="color"]', this.el).addEventListener('input', (e) => { this.color = e.target.value; });
    $('[data-f="width"]', this.el).addEventListener('change', (e) => { this.lineW = Number(e.target.value) || 2; });

    /* —— 画布指针 —— */
    this.paper.addEventListener('pointerdown', (e) => this._down(e));
    this.paper.addEventListener('pointermove', (e) => this._move(e));
    this.paper.addEventListener('pointerup', (e) => this._up(e));
    this.paper.addEventListener('pointercancel', (e) => this._up(e));
    this.paper.addEventListener('pointerleave', () => { if (!this.drag) $('[data-f="pos"]', this.el).textContent = ''; });

    /* —— 滚轮：Ctrl/⌘ 缩放，其余交给滚动 —— */
    this.stage.addEventListener('wheel', (e) => {
      if (!this.base) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x:e.clientX, y:e.clientY });
    }, { passive:false });

    /* —— 拖进来：内部拖拽（文件管理器 / 浏览器标签）；外部文件交给全局导入 —— */
    this.stage.addEventListener('dragover', (e) => {
      const files = e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
      if (!files && !hasInternalDrag(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
      this.stage.classList.add('drop');
    });
    this.stage.addEventListener('dragleave', (e) => {
      if (!this.stage.contains(e.relatedTarget)) this.stage.classList.remove('drop');
    });
    this.stage.addEventListener('drop', async (e) => {
      /* 外部文件：全局处理器会先导入到 .home，再回调本应用的 loadPaths，
       * 这里不要再读一遍，否则同一张图会被处理两次。 */
      this.stage.classList.remove('drop');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) return;
      const items = DragBus.read(e.dataTransfer);
      if (!items || !items.length) return;
      e.preventDefault();
      e.__htDropHandled = true;
      const it = items.find(x => x.path);
      if (!it) { toast('拖进来的是网页，不是图片', true); DragBus.clear(); return; }
      await this.loadPath(it.path);
      DragBus.clear();
    });

    /* —— 键盘：只在焦点落在本窗口时接管 —— */
    this._onKey = (e) => {
      if (!this.base) return;
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (!this.el.contains(document.activeElement)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); this.redo();
      } else if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); this.save();
      } else if (!mod && (e.key === '+' || e.key === '=')) {
        this.zoomBy(1.25);
      } else if (!mod && e.key === '-') {
        this.zoomBy(1 / 1.25);
      } else if (!mod && e.key === '0') {
        this.fit();
      } else if (!mod && e.key === '1') {
        this.setZoom(1);
      } else if (e.key === 'Escape') {
        this.drag = null;
        this._clearOv();
      }
    };
    this.el.addEventListener('keydown', this._onKey);

    /* —— 粘贴：从系统截图工具直接 Ctrl+V —— */
    this._onPaste = (e) => {
      if (!this.el.contains(document.activeElement)) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (!f) continue;
          e.preventDefault();
          contentToDataUrl(f, f.type).then(url => this.loadDataUrl(url, '剪贴板.png'))
            .catch(err => toast('粘贴失败：' + (err && err.message || err), true));
          return;
        }
      }
    };
    document.addEventListener('paste', this._onPaste);

    /* —— 窗口尺寸变了，适应模式要跟着重算 —— */
    let raf = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => {
        if (!this.autoFit || !this.base) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => this.fit());
      });
      this._ro.observe(this.stage);
    }
  }

  dispose() {
    try { this._ro && this._ro.disconnect(); } catch (e) {}
    document.removeEventListener('paste', this._onPaste);
    this.el.removeEventListener('keydown', this._onKey);
  }

  /* ---------------------------------------------------------------- 载入 */
  async openLocal() {
    const files = await pickFiles({ accept:'image/*' });
    if (!files.length) return;
    const f = files[0];
    try {
      const url = await contentToDataUrl(f, f.type || 'image/png');
      await this.loadDataUrl(url, f.name || 'image');
    } catch (e) {
      toast('打不开这个文件：' + (e && e.message || e), true);
    }
  }

  async openFromFs() {
    const p = await pickFileInFs({ title:'选择图片（.home）', dir:'.home' });
    if (p) await this.loadPath(p);
  }

  async loadPath(p) {
    try {
      const st = await FS.stat(p);
      if (!st) throw new Error('文件不存在');
      if (st.kind === 'dir') throw new Error('这是一个目录');
      const r = await FS.read(p);
      const mime = (r.meta && r.meta.mime) || guessMime(p, r.content) || 'application/octet-stream';
      const url = await contentToDataUrl(r.content, mime);
      this.path = p;
      this.savedPath = '';
      await this.loadDataUrl(url, spotExportName(baseName(p)));
      return true;
    } catch (e) {
      toast('打开失败：' + (e && e.message || e), true);
      return false;
    }
  }

  /* 全局拖拽导入之后回调：paths 是刚落到 .home 的文件 */
  async loadPaths(paths) {
    for (const p of (paths || [])) {
      /* loadPath 自己会 toast 失败原因，这里只需要知道有没有成功 */
      if (await this.loadPath(p)) return true;
    }
    toast('这些文件里没有能解码的图片', true);
    return false;
  }

  async loadDataUrl(url, name) {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('不是浏览器能解码的图片'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('图片尺寸为 0');
    const c = imgCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    this.base = c;
    this.name = String(name || 'image');
    this.savedPath = '';
    this.undoStack = [];
    this.redoStack = [];
    $('[data-f="empty"]', this.el).hidden = true;
    this.paper.hidden = false;
    this._sync();
    this.autoFit = true;
    this.fit();
    this._enable(true);
    if (this.onTitle) this.onTitle('看图 · ' + this.name);
  }

  /* ---------------------------------------------------------------- 视图 */
  _sync() {
    if (!this.base) return;
    const w = this.base.width, h = this.base.height;
    for (const c of [this.view, this.ov]) {
      c.width = w; c.height = h;
      c.style.width = (w * this.zoom) + 'px';
      c.style.height = (h * this.zoom) + 'px';
    }
    this.paper.style.width = (w * this.zoom) + 'px';
    this.paper.style.height = (h * this.zoom) + 'px';
    this._paint();
    this._zoomLabel();
  }
  _paint() {
    if (!this.base) return;
    this.vctx.clearRect(0, 0, this.view.width, this.view.height);
    this.vctx.drawImage(this.base, 0, 0);
    this._clearOv();
    if ($('[data-f="meta"]', this.el)) {
      $('[data-f="meta"]', this.el).textContent = this.base.width + '×' + this.base.height;
    }
  }
  _clearOv() {
    this.octx.clearRect(0, 0, this.ov.width, this.ov.height);
  }
  _zoomLabel() {
    const z = this.zoom;
    $('[data-f="zoom"]', this.el).textContent = Math.round(z * 100) + '%';
    this.paper.classList.toggle('pix', z >= 2);
  }
  setZoom(z, anchor) {
    if (!this.base) return;
    z = clamp(Number(z) || 1, 0.02, 8);
    if (Math.abs(z - this.zoom) < 1e-4) { this._zoomLabel(); return; }
    const stage = this.stage, paper = this.paper;
    const old = this.zoom;
    const sl = stage.scrollLeft, st = stage.scrollTop;
    let lx = 0, ly = 0;
    if (anchor) {
      const r = paper.getBoundingClientRect();
      lx = anchor.x - r.left; ly = anchor.y - r.top;
    }
    this.zoom = z;
    const w = this.base.width * z, h = this.base.height * z;
    for (const c of [this.view, this.ov]) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    paper.style.width = w + 'px';
    paper.style.height = h + 'px';
    if (anchor) {
      stage.scrollLeft = (sl + lx) * (z / old) - lx;
      stage.scrollTop = (st + ly) * (z / old) - ly;
    }
    this._zoomLabel();
  }
  zoomBy(k, anchor) {
    if (!this.base) return;
    this.autoFit = false;
    this.setZoom(this.zoom * k, anchor);
  }
  fit() {
    if (!this.base) return;
    const pad = 40;
    const z = Math.min(
      (this.stage.clientWidth - pad) / this.base.width,
      (this.stage.clientHeight - pad) / this.base.height,
      1
    );
    this.autoFit = true;
    this.setZoom(Math.max(0.02, z) || 1);
  }

  /* ---------------------------------------------------------------- 坐标 */
  _pt(e) {
    const r = this.ov.getBoundingClientRect();
    const kx = this.base.width / (r.width || 1);
    const ky = this.base.height / (r.height || 1);
    return {
      x: clamp((e.clientX - r.left) * kx, 0, this.base.width),
      y: clamp((e.clientY - r.top) * ky, 0, this.base.height)
    };
  }

  /* ---------------------------------------------------------------- 指针 */
  _down(e) {
    if (!this.base || e.button !== 0) return;
    this.el.focus({ preventScroll:true });
    if (e.altKey) { this.pickColor(e); return; }
    const p = this._pt(e);
    if (this.tool === 'move') {
      this.drag = { pan:true, x:e.clientX, y:e.clientY, sl:this.stage.scrollLeft, st:this.stage.scrollTop };
      this.paper.classList.add('panning');
      try { this.paper.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    if (this.tool === 'text') { this.addText(p); return; }
    this.drag = { tool:this.tool, a:p, b:p, pts:[p] };
    try { this.paper.setPointerCapture(e.pointerId); } catch (err) {}
    this._preview();
    e.preventDefault();
  }

  _move(e) {
    if (!this.base) return;
    const p = this._pt(e);
    $('[data-f="pos"]', this.el).textContent = Math.round(p.x) + ', ' + Math.round(p.y);
    const d = this.drag;
    if (!d) return;
    if (d.pan) {
      this.stage.scrollLeft = d.sl - (e.clientX - d.x);
      this.stage.scrollTop = d.st - (e.clientY - d.y);
      return;
    }
    d.b = p;
    if (d.tool === 'brush') {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) d.pts.push(p);
    }
    this._preview();
  }

  _up(e) {
    const d = this.drag;
    this.drag = null;
    this.paper.classList.remove('panning');
    try { this.paper.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!d || d.pan) return;
    this._commit(d);
  }

  /* ---------------------------------------------------------------- 预览 */
  _preview() {
    if (!this.drag) { this._clearOv(); return; }
    const ctx = this.octx;
    this._clearOv();
    const d = this.drag;
    if (d.tool === 'crop' || d.tool === 'mosaic') {
      const r = normRect(d.a, d.b);
      if (d.tool === 'crop') {
        /* 裁掉的部分压暗，保留的部分保持原样 */
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fillRect(0, 0, this.ov.width, r.y);
        ctx.fillRect(0, r.y + r.h, this.ov.width, this.ov.height - r.y - r.h);
        ctx.fillRect(0, r.y, r.x, r.h);
        ctx.fillRect(r.x + r.w, r.y, this.ov.width - r.x - r.w, r.h);
        ctx.strokeStyle = 'rgba(94,234,212,.95)';
        ctx.lineWidth = Math.max(1, 2 / this.zoom);
        ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
        ctx.strokeRect(r.x + .5, r.y + .5, r.w, r.h);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = 'rgba(94,234,212,.18)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(94,234,212,.9)';
        ctx.lineWidth = Math.max(1, 1.5 / this.zoom);
        ctx.setLineDash([5 / this.zoom, 4 / this.zoom]);
        ctx.strokeRect(r.x + .5, r.y + .5, r.w, r.h);
        ctx.restore();
      }
      return;
    }
    this._shape(ctx, d, this.color, this.lineW);
  }

  /* 把一条标注画进 ctx。预览和落笔共用，避免「预览一种、结果另一种」。
   * 每条线都画两遍：先一道半透明深色描边，再上颜色。截图底色不可控，
   * 红色标注落在红色按钮上会彻底消失——那层暗边就是保险。 */
  _shape(ctx, d, color, lw) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ink = (stroke, fill, w) => {
      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.lineWidth = w;
      if (d.tool === 'rect') {
        const r = normRect(d.a, d.b);
        ctx.strokeRect(r.x + w / 2, r.y + w / 2, Math.max(0, r.w - w), Math.max(0, r.h - w));
      } else if (d.tool === 'arrow') {
        this._arrow(ctx, d.a, d.b, w);
      } else if (d.tool === 'brush') {
        ctx.beginPath();
        d.pts.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        if (d.pts.length === 1) ctx.lineTo(d.a.x + 0.01, d.a.y + 0.01);
        ctx.stroke();
      } else if (d.tool === 'text') {
        this._textShape(ctx, d.text, d.a, color, lw);
      }
    };
    const halo = 'rgba(0,0,0,.45)';
    if (d.tool === 'text') {
      this._textShape(ctx, d.text, d.a, color, lw);
    } else {
      ink(halo, halo, lw + 2);
      ink(color, color, lw);
    }
    ctx.restore();
  }
  _arrow(ctx, a, b, lw) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(10, lw * 5);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x - Math.cos(ang) * head * 0.65, b.y - Math.sin(ang) * head * 0.65);
    ctx.stroke();
    const p1 = { x:b.x - Math.cos(ang - 0.42) * head, y:b.y - Math.sin(ang - 0.42) * head };
    const p2 = { x:b.x - Math.cos(ang + 0.42) * head, y:b.y - Math.sin(ang + 0.42) * head };
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fill();
  }
  _textShape(ctx, text, at, color, lw) {
    const size = Math.max(14, lw * 8);
    ctx.font = '600 ' + size + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const lines = String(text == null ? '' : text).split('\n');
    lines.forEach((line, i) => {
      const y = at.y + i * size * 1.25;
      /* 先描一圈深色再填色：截图底色可能正好和字同色，不描边会「写着写着消失了」 */
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = Math.max(2, size / 8);
      ctx.strokeText(line, at.x, y);
      ctx.fillStyle = color;
      ctx.fillText(line, at.x, y);
    });
  }

  /* ---------------------------------------------------------------- 落笔 */
  _commit(d) {
    const r = normRect(d.a, d.b);
    /* 只是点了一下、没真拖：不要往撤销栈里塞空操作 */
    if (d.tool === 'rect' && (r.w < 2 || r.h < 2)) { this._clearOv(); return; }
    if (d.tool === 'arrow' && Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < 3) { this._clearOv(); return; }
    if (d.tool === 'brush' && d.pts.length < 2) { this._clearOv(); return; }
    if (d.tool === 'crop') {
      this._clearOv();
      if (r.w < 4 || r.h < 4) { toast('裁剪区域太小了', true); return; }
      this._pushUndo();
      /* 用取整后的两条边相减，别拿 round(宽) 去配 round(起点)：
       * 半像素的起点会让裁剪窗口整体偏一格。 */
      const x0 = clamp(Math.round(r.x), 0, this.base.width);
      const y0 = clamp(Math.round(r.y), 0, this.base.height);
      const x1 = clamp(Math.round(r.x + r.w), 0, this.base.width);
      const y1 = clamp(Math.round(r.y + r.h), 0, this.base.height);
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      const c = imgCanvas(w, h);
      c.getContext('2d').drawImage(this.base, x0, y0, w, h, 0, 0, w, h);
      this.base = c;
      this._sync();
      if (this.autoFit) this.fit();
      this._setTool('move');
      toast('已裁剪到 ' + c.width + '×' + c.height + '（Ctrl+Z 撤销）');
      return;
    }
    if (d.tool === 'mosaic') {
      this._clearOv();
      if (r.w < 2 || r.h < 2) return;
      this._pushUndo();
      this._pixelate(r, Math.max(4, Math.round(Math.min(this.base.width, this.base.height) / 90)));
      this._paint();
      toast('已打码（Ctrl+Z 撤销）');
      return;
    }
    if (d.tool === 'brush' && d.pts.length < 2) this._clearOv();
    this._pushUndo();
    this._shape(this.vctx, d, this.color, this.lineW);
    this._clearOv();
    /* 落笔之后不再重画整张：直接把这一笔留在 view 上，并同步进 base。
     * 否则大图每次 commit 都要 drawImage 一次全图，画笔会顿。 */
    const bctx = this.base.getContext('2d');
    bctx.drawImage(this.view, 0, 0);
  }

  _pixelate(r, block) {
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    const w = Math.min(this.base.width - x, Math.round(r.w));
    const h = Math.min(this.base.height - y, Math.round(r.h));
    if (w < 1 || h < 1) return;
    const tw = Math.max(1, Math.round(w / block)), th = Math.max(1, Math.round(h / block));
    const tmp = imgCanvas(tw, th);
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(this.base, x, y, w, h, 0, 0, tw, th);
    const ctx = this.base.getContext('2d');
    const old = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h);
    ctx.imageSmoothingEnabled = old;
  }

  async addText(at) {
    /* 这里用 textarea 而不是 modalPrompt 的单行 input：截图标注经常要写两行 */
    const txt = await modal({
      title: '加文字',
      body: '<textarea class="ie-text" id="ieTxt" rows="3" spellcheck="false" '
        + 'placeholder="要写的字；Ctrl+Enter 确认"></textarea>',
      buttons: [
        { label:'取消', value:null },
        { label:'写上', primary:true, onClick:(w) => {
            const v = w.querySelector('#ieTxt').value.trim();
            return v || null;
          } }
      ],
      onMount: (w) => {
        const ta = w.querySelector('#ieTxt');
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            w.querySelector('.mfoot .btn.primary').click();
          }
        });
        setTimeout(() => ta.focus(), 40);
      }
    });
    if (!txt) return;
    this._pushUndo();
    this._shape(this.vctx, { tool:'text', text:txt, a:at, b:at }, this.color, this.lineW);
    this.base.getContext('2d').drawImage(this.view, 0, 0);
  }

  /* ---------------------------------------------------------------- 变换 */
  _pushUndo() {
    if (!this.base) return;
    this.undoStack.push(imgCopy(this.base));
    const max = this._maxUndo();
    while (this.undoStack.length > max) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  _maxUndo() {
    const px = this.base ? this.base.width * this.base.height : 0;
    if (px > 4e6) return 4;       // 一张 4K 截图约 33 MB/张，多存没意义
    if (px > 1.5e6) return 8;
    return IMG_MAX_UNDO;
  }
  undo() {
    if (!this.undoStack.length) { toast('没有可撤销的操作'); return; }
    this.redoStack.push(imgCopy(this.base));
    this.base = this.undoStack.pop();
    this._sync();
    if (this.autoFit) this.fit();
  }
  redo() {
    if (!this.redoStack.length) { toast('没有可重做的操作'); return; }
    this.undoStack.push(imgCopy(this.base));
    this.base = this.redoStack.pop();
    this._sync();
    if (this.autoFit) this.fit();
  }
  rotate(deg) {
    if (!this.base) return;
    this._pushUndo();
    const src = this.base;
    const c = imgCanvas(src.height, src.width);
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    this.base = c;
    this._sync();
    if (this.autoFit) this.fit();
  }
  flip(horizontal) {
    if (!this.base) return;
    this._pushUndo();
    const src = this.base;
    const c = imgCanvas(src.width, src.height);
    const ctx = c.getContext('2d');
    if (horizontal) { ctx.translate(src.width, 0); ctx.scale(-1, 1); }
    else { ctx.translate(0, src.height); ctx.scale(1, -1); }
    ctx.drawImage(src, 0, 0);
    this.base = c;
    this._sync();
  }
  async resizeAsk() {
    if (!this.base) return;
    const def = String(Math.round(this.base.width));
    const v = await modalPrompt('缩放图片', def, '输入目标宽度（像素）；高度按比例跟着变');
    if (!v) return;
    const w = Math.round(Number(v));
    if (!(w >= 1) || w > 20000) { toast('宽度要在 1 到 20000 之间', true); return; }
    const h = Math.max(1, Math.round(this.base.height * w / this.base.width));
    this._pushUndo();
    const src = this.base;
    const c = imgCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    this.base = c;
    this._sync();
    if (this.autoFit) this.fit();
    toast('已缩放到 ' + w + '×' + h);
  }

  /* ---------------------------------------------------------------- 取色 */
  pickColor(e) {
    const p = this._pt(e);
    const x = Math.min(this.base.width - 1, Math.max(0, Math.floor(p.x)));
    const y = Math.min(this.base.height - 1, Math.max(0, Math.floor(p.y)));
    try {
      const d = this.base.getContext('2d').getImageData(x, y, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('');
      this.color = hex;
      $('[data-f="color"]', this.el).value = hex;
      toast('取到 ' + hex + (d[3] < 255 ? '（半透明）' : ''));
    } catch (err) {
      toast('这个像素读不出来：' + (err && err.message || err), true);
    }
  }

  /* ---------------------------------------------------------------- 导出 */
  _type() { return $('[data-f="type"]', this.el).value || 'image/png'; }
  _export() {
    const type = this._type();
    let src = this.base;
    if (type === 'image/jpeg') {
      /* JPEG 没有 alpha：透明区域不铺白底会变成黑的，这是 canvas 的默认行为 */
      src = imgCanvas(this.base.width, this.base.height);
      const ctx = src.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, src.width, src.height);
      ctx.drawImage(this.base, 0, 0);
    }
    const url = src.toDataURL(type, 0.92);
    const mime = ToolKit.mimeOf(url);
    return { url, bytes:ToolKit.dataUrlBytes(url), mime };
  }
  _ext(mime) { return mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png'); }
  _fileName(ext) {
    let stem = spotExportName(this.name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
    if (!stem) stem = 'image';
    return stem + '-edit.' + ext;
  }
  async save() {
    if (!this.base) return;
    try {
      const { bytes, mime } = this._export();
      const nm = spotEscape(this._fileName(this._ext(mime)));
      let p = this.savedPath && FS.exists(this.savedPath) ? this.savedPath : uniquePathIn('.home', nm);
      await FS.write(p, bytes, { mime, hint:spotExportName(baseName(p)), origin:'image' });
      this.savedPath = p;
      toast('已保存到 ' + p);
    } catch (e) {
      toast('保存失败：' + (e && e.message || e), true);
    }
  }
  download() {
    if (!this.base) return;
    try {
      const { bytes, mime } = this._export();
      downloadBlob(this._fileName(this._ext(mime)), new Blob([bytes], { type:mime }));
    } catch (e) {
      toast('下载失败：' + (e && e.message || e), true);
    }
  }
  async copyImg() {
    if (!this.base) return;
    try {
      const { bytes, mime } = this._export();
      await navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes], { type:mime }) })]);
      toast('已复制图片');
    } catch (e) {
      toast('这个浏览器不让写图片剪贴板，请用「下载」', true);
    }
  }

  /* ---------------------------------------------------------------- 杂项 */
  _setTool(t) {
    this.tool = t;
    $$('[data-tool]', this.el).forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    this.paper.dataset.tool = t;
  }
  _enable(on) {
    ['save', 'down', 'copy'].forEach(a => {
      const b = $('[data-a="' + a + '"]', this.el);
      if (b) b.disabled = !on;
    });
  }
}

/* 两个角点 → 规范化的正矩形（宽高恒为正） */
function normRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w:Math.abs(b.x - a.x), h:Math.abs(b.y - a.y) };
}
