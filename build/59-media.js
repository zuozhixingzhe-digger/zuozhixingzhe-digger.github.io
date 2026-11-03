/* ============================================================================
 * HTerMinaL · media（录音机 / 定位 / 3D 视图 / 音频播放）
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 这四个工具此前一直挂着「维护中」。之所以一直没做，是因为每个都有一道
 * 「浏览器到底给不给你」的硬边界：
 *   - 录音：要麦克风权限，而且关窗口时必须把音轨关掉，否则状态栏一直亮着红点；
 *   - 定位：只在 HTTPS / localhost 给，拒绝之后没有第二次机会（除非用户自己改站点设置）；
 *   - 3D：引 three.js 要几十万行和一个新依赖，自己写要矩阵 + 着色器；
 *   - 音频：解码格式由浏览器决定，flac/ape 这类不是「没做」，是「做不到」。
 * 这轮把边界写进界面，能让用户看到「为什么不行」，而不是转圈。
 * ==========================================================================*/

/* ---------------------------------------------------------------- 公共 */
function recStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function mediaErr(e, what) {
  const name = e && e.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return what + '被拒绝：浏览器或系统没有给权限。';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '找不到可用的' + what + '设备。';
  if (name === 'NotReadableError') return what + '被其他程序占用（会议软件、录音软件常见）。';
  if (!window.isSecureContext) return '当前页面不是安全上下文（https / localhost），浏览器不给' + what + '。';
  return what + '失败：' + (e && e.message || e);
}

/* ============================================================================
 * 1. 录音机
 * ==========================================================================*/
class RecorderApp {
  constructor(container) {
    this.el = container;
    this.rec = null;
    this.stream = null;
    this.ac = null;
    this.chunks = [];
    this.blob = null;
    this.url = '';
    this.t0 = 0;
    this.elapsed = 0;
    this.paused = false;
    this.raf = 0;
    this.timer = 0;
    this.state = 'idle';
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd"><b class="tl-tag">录音机</b>
        <span style="flex:1 1 auto"></span>
        <button class="tl-btn sm rec-dot" data-a="start">● 开始</button>
        <button class="tl-btn sm" data-a="pause" disabled>‖ 暂停</button>
        <button class="tl-btn sm" data-a="stop" disabled>■ 停止</button>
      </div>
      <div class="tl-body">
        <div class="tl-card" style="padding:12px 12px 10px">
          <div class="rec-clock" data-f="clock">00:00</div>
          <canvas class="rec-wave" data-f="wave" height="86"></canvas>
          <div class="tl-note" data-f="state">待机 · 点「开始」向浏览器申请麦克风</div>
        </div>
        <div class="tl-row"><label>输入设备</label>
          <select class="tl-in" data-f="dev" style="flex:1 1 auto"><option value="">默认麦克风</option></select>
          <button class="tl-btn sm" data-a="refresh" title="重新枚举（授权后才有名字）">↻</button></div>
        <div class="tl-row"><label>格式</label>
          <select class="tl-in" data-f="mime" style="flex:1 1 auto"></select></div>
        <div class="rec-out" data-f="out"></div>
        <div class="tl-note" style="margin-top:8px">
          录音只在本地：结束前不落盘，关掉窗口就没了。停下来之后可以<b>存进 .home</b>，
          也可以直接下载。想边录边存（长录音防丢）这版没做，因为 MediaRecorder 的分片
          要自己拼容器，容易得到一个播不动的文件。
        </div>
      </div>
    </div>`;
    this.clock = $('[data-f="clock"]', this.el);
    this.canvas = $('[data-f="wave"]', this.el);
    this.stateEl = $('[data-f="state"]', this.el);
    this.out = $('[data-f="out"]', this.el);
    this.mimeSel = $('[data-f="mime"]', this.el);
    this.devSel = $('[data-f="dev"]', this.el);

    const types = [
      ['audio/webm;codecs=opus', 'WebM · Opus（推荐）'],
      ['audio/webm', 'WebM'],
      ['audio/mp4', 'MP4 / AAC（Safari）'],
      ['audio/ogg;codecs=opus', 'Ogg · Opus']
    ].filter(([t]) => !window.MediaRecorder || !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(t));
    this.mimeSel.innerHTML = types.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('') ||
      '<option value="">浏览器默认</option>';

    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'start') this.start();
      else if (a === 'pause') this.togglePause();
      else if (a === 'stop') this.stop();
      else if (a === 'refresh') this.listDevices(true);
      else if (a === 'save') this.saveFs();
      else if (a === 'down') saveFileRaw(this.fileName(), this.blob, this.blob.type || 'audio/webm');
      else if (a === 'discard') this.discard();
    });
    this.listDevices(false);
    this.drawIdle();
  }

  fileName() {
    const t = (this.blob && this.blob.type) || '';
    const ext = /mp4/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : 'webm';
    return 'rec-' + recStamp() + '.' + ext;
  }

  async listDevices(ask) {
    try {
      if (ask && navigator.mediaDevices.getUserMedia) {
        const s = await navigator.mediaDevices.getUserMedia({ audio:true });
        s.getTracks().forEach(t => t.stop());
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter(d => d.kind === 'audioinput');
      this.devSel.innerHTML = '<option value="">默认麦克风</option>' + mics.map((d, i) =>
        `<option value="${esc(d.deviceId)}">${esc(d.label || ('麦克风 ' + (i + 1)))}</option>`).join('');
    } catch (e) { /* 没授权时只有一条空标签，不影响录音 */ }
  }

  async start() {
    if (this.state === 'rec') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast('这个浏览器不支持 MediaRecorder', true); return;
    }
    try {
      const dev = this.devSel.value;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: dev ? { deviceId:{ exact:dev } } : { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
      });
    } catch (e) { this.stateEl.textContent = mediaErr(e, '麦克风'); toast(this.stateEl.textContent, true); return; }

    this.chunks = [];
    this.blob = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = ''; }
    this.out.innerHTML = '';
    const mime = this.mimeSel.value;
    try {
      this.rec = new MediaRecorder(this.stream, mime ? { mimeType:mime } : undefined);
    } catch (e) {
      try { this.rec = new MediaRecorder(this.stream); }
      catch (e2) { this.stateEl.textContent = '这台浏览器无法创建录音器：' + (e2.message || e2); return; }
    }
    this.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) this.chunks.push(ev.data); };
    this.rec.onstop = () => this.finish();
    this.rec.start(1000);
    this.state = 'rec';
    this.paused = false;
    this.elapsed = 0;
    this.t0 = Date.now();
    this.timer = setInterval(() => { if (!this.paused) { this.elapsed = Date.now() - this.t0; this.clock.textContent = fmtClock(this.elapsed); } }, 200);
    this.clock.textContent = '00:00';
    this.stateEl.textContent = '正在录音 · ' + (this.mimeSel.selectedOptions[0] || {}).textContent;
    this.btn('start', false); this.btn('pause', true); this.btn('stop', true);
    this.btn('pause').textContent = '‖ 暂停';
    this.el.classList.add('rec-on');
    this.meter();
    this.listDevices(false);
  }

  btn(a, on) { const b = this.el.querySelector('[data-a="' + a + '"]'); if (b) b.disabled = !on; return b; }

  togglePause() {
    if (!this.rec) return;
    if (this.rec.state === 'recording') { this.rec.pause(); this.paused = true; this.btn('pause').textContent = '▶ 继续'; this.stateEl.textContent = '已暂停'; }
    else if (this.rec.state === 'paused') { this.rec.resume(); this.paused = false; this.btn('pause').textContent = '‖ 暂停'; this.stateEl.textContent = '正在录音'; }
  }

  stop() {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.stopTracks();
    clearInterval(this.timer);
    this.timer = 0;
    this.state = 'idle';
    this.el.classList.remove('rec-on');
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.btn('start', true); this.btn('pause', false); this.btn('stop', false);
  }

  finish() {
    this.blob = new Blob(this.chunks, { type: (this.rec && this.rec.mimeType) || 'audio/webm' });
    this.chunks = [];
    if (!this.blob.size) { this.stateEl.textContent = '没有录到数据'; return; }
    this.url = URL.createObjectURL(this.blob);
    this.stateEl.textContent = '录完 · ' + fmtClock(this.elapsed) + ' · ' + ToolKit.bytes(this.blob.size);
    const dur = fmtClock(this.elapsed);
    this.out.innerHTML = `<div class="tl-card">
      <audio controls src="${this.url}" style="width:100%"></audio>
      <div class="tl-row" style="margin:8px 0 0">
        <button class="tl-btn" data-a="save">存到 .home</button>
        <button class="tl-btn" data-a="down">下载</button>
        <button class="tl-btn" data-a="discard">丢掉</button>
        <span class="tl-note">${esc(dur)} · ${esc(ToolKit.bytes(this.blob.size))}</span>
      </div></div>`;
    this.drawStatic();
  }

  async saveFs() {
    if (!this.blob) return;
    const name = this.fileName();
    try {
      /* 点号在这个文件系统里是路径分隔符：`rec-…​.webm` 会被拆成
       * 「.home / rec-… / webm」，父目录不存在直接报错。落盘时走 spotEscape，
       * 名字变成 rec-…-webm；下载到真机时才用回带点的原名。 */
      const stored = spotEscape(name);
      await FS.write('.home.' + stored, await this.blob.arrayBuffer(), { mime:this.blob.type || 'audio/webm', hint:'录音', origin:'recorder' });
      toast('已保存到 .home.' + stored);
    } catch (e) { toast('保存失败：' + (e.message || e), true); }
  }

  discard() {
    if (this.url) { URL.revokeObjectURL(this.url); this.url = ''; }
    this.blob = null;
    this.out.innerHTML = '';
    this.clock.textContent = '00:00';
    this.stateEl.textContent = '待机 · 点「开始」向浏览器申请麦克风';
    this.drawIdle();
  }

  stopTracks() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.ac) { this.ac.close().catch(() => {}); this.ac = null; }
  }

  /* 电平表：AnalyserNode 拿时域数据，画成一根来回的线。
   * 不用 MediaRecorder 的音量事件——它没有。 */
  meter() {
    try {
      this.ac = new AudioContext();
      const src = this.ac.createMediaStreamSource(this.stream);
      const an = this.ac.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const draw = () => {
        this.raf = requestAnimationFrame(draw);
        an.getByteTimeDomainData(buf);
        const c = this.canvas, dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = 86;
        if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#5eead4';
        g.lineWidth = 1.4;
        g.beginPath();
        for (let i = 0; i < buf.length; i++) {
          const x = i / (buf.length - 1) * w;
          const y = h / 2 + (buf[i] - 128) / 128 * (h / 2 - 6);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      draw();
    } catch (e) { /* 没有 AudioContext 也能录，只是没有波形 */ }
  }

  drawIdle() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300, h = 86;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(148,163,184,.35)';
    g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }

  drawStatic() { /* 停下来之后保留最后一帧波形，不重画 */ }

  dispose() {
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch (e) {}
    this.stopTracks();
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (this.url) { URL.revokeObjectURL(this.url); this.url = ''; }
  }
}

/* ============================================================================
 * 2. 定位
 * ==========================================================================*/
class GeoApp {
  constructor(container) {
    this.el = container;
    this.watchId = null;
    this.last = null;
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd"><b class="tl-tag">定位</b>
        <span style="flex:1 1 auto"></span>
        <button class="tl-btn sm" data-a="once">取一次</button>
        <button class="tl-btn sm" data-a="watch">持续跟踪</button>
        <button class="tl-btn sm" data-a="stop" disabled>停止</button>
      </div>
      <div class="tl-body">
        <div class="geo-panel">
          <div class="geo-cross"><i></i><i></i><span data-f="dot"></span></div>
          <div class="geo-acc" data-f="acc">尚未定位</div>
        </div>
        <div class="tl-card">
          <div class="tl-kv"><b>纬度</b><code data-f="lat">—</code></div>
          <div class="tl-kv"><b>经度</b><code data-f="lon">—</code></div>
          <div class="tl-kv"><b>精度</b><code data-f="acc2">—</code></div>
          <div class="tl-kv"><b>海拔</b><code data-f="alt">—</code></div>
          <div class="tl-kv"><b>速度</b><code data-f="spd">—</code></div>
          <div class="tl-kv"><b>方向</b><code data-f="hdg">—</code></div>
          <div class="tl-kv"><b>时间</b><code data-f="ts">—</code></div>
        </div>
        <div class="tl-row">
          <button class="tl-btn" data-a="copy" disabled>复制坐标</button>
          <button class="tl-btn" data-a="save" disabled>存成 .home.geo-json</button>
          <button class="tl-btn" data-a="map" disabled>在地图里打开</button>
        </div>
        <div class="tl-note" data-f="note"></div>
      </div>
    </div>`;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'once') this.get(false);
      else if (a === 'watch') this.get(true);
      else if (a === 'stop') this.stopWatch();
      else if (a === 'copy' && this.last) ToolKit.copy(this.last.coords.latitude + ',' + this.last.coords.longitude, '坐标已复制');
      else if (a === 'save') this.save();
      else if (a === 'map' && this.last) {
        const c = this.last.coords;
        WindowManager.open({ type:'browser', url:'https://www.openstreetmap.org/?mlat=' + c.latitude + '&mlon=' + c.longitude + '#map=16/' + c.latitude + '/' + c.longitude });
      }
    });
    const note = $('[data-f="note"]', this.el);
    if (!window.isSecureContext) {
      note.innerHTML = '⚠️ 当前页面不是安全上下文（https / localhost），<b>浏览器会直接拒绝定位</b>，无法绕过。';
    } else if (!navigator.geolocation) {
      note.innerHTML = '⚠️ 这个浏览器没有 Geolocation API。';
    } else {
      note.innerHTML = '定位是敏感权限：浏览器会弹窗问一次，拒绝后本页不会再问，只能去站点设置里改。坐标只留在本机，不自动上传。';
    }
  }

  get(track) {
    if (!navigator.geolocation) { toast('浏览器不支持定位', true); return; }
    this.stopWatch();
    const opts = { enableHighAccuracy:true, timeout:15000, maximumAge:0 };
    const ok = (p) => this.show(p);
    const bad = (e) => {
      const m = e.code === 1 ? '用户拒绝了定位权限'
        : e.code === 2 ? '定位不可用（没有 GPS / 网络定位被关）'
        : e.code === 3 ? '定位超时（室内常见，试试靠近窗边）' : ('定位失败：' + e.message);
      $('[data-f="acc"]', this.el).textContent = m;
      toast(m, true);
    };
    if (track) {
      this.watchId = navigator.geolocation.watchPosition(ok, bad, opts);
      this.act('watch', false); this.act('stop', true); this.act('once', false);
      $('[data-f="note"]', this.el).textContent = '正在持续跟踪（watchPosition）……精度会随卫星/基站情况变化。';
    } else {
      navigator.geolocation.getCurrentPosition(ok, bad, opts);
      $('[data-f="note"]', this.el).textContent = '正在取位置……';
    }
  }

  stopWatch() {
    if (this.watchId != null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    this.act('watch', true); this.act('stop', false); this.act('once', true);
  }

  act(a, on) { const b = this.el.querySelector('[data-a="' + a + '"]'); if (b) b.disabled = !on; }

  show(p) {
    this.last = p;
    const c = p.coords, f = (v, u, d) => v == null ? '—' : (Number(v).toFixed(d == null ? 6 : d) + (u || ''));
    const set = (k, v) => { const n = $('[data-f="' + k + '"]', this.el); if (n) n.textContent = v; };
    set('lat', f(c.latitude, '°', 6));
    set('lon', f(c.longitude, '°', 6));
    set('acc2', f(c.accuracy, ' m', 0));
    set('alt', c.altitude == null ? '—' : f(c.altitude, ' m', 0) + (c.altitudeAccuracy != null ? ' ±' + Math.round(c.altitudeAccuracy) + ' m' : ''));
    set('spd', c.speed == null ? '—' : f(c.speed * 3.6, ' km/h', 1));
    set('hdg', c.heading == null ? '—' : f(c.heading, '°', 0));
    set('ts', new Date(p.timestamp).toLocaleString('zh-CN', { hour12:false }));
    $('[data-f="acc"]', this.el).textContent = '精度 ±' + Math.round(c.accuracy) + ' m · ' + (c.accuracy <= 20 ? '较准' : c.accuracy <= 100 ? '一般' : '较粗');
    const note = $('[data-f="note"]', this.el);
    if (note && this.watchId == null) {
      note.textContent = '已定位（单次）。点「持续跟踪」可以让它随移动更新；坐标只留在本机。';
    }
    const dot = $('[data-f="dot"]', this.el);
    if (dot) {
      const r = Math.min(46, 6 + c.accuracy / 2);
      dot.style.width = dot.style.height = (r * 2) + 'px';
      dot.style.opacity = '0.9';
    }
    ['copy', 'save', 'map'].forEach(a => this.act(a, true));
  }

  async save() {
    if (!this.last) return;
    const c = this.last.coords;
    const data = {
      latitude:c.latitude, longitude:c.longitude, accuracy:c.accuracy,
      altitude:c.altitude, altitudeAccuracy:c.altitudeAccuracy,
      heading:c.heading, speed:c.speed, timestamp:this.last.timestamp,
      capturedAt:new Date().toISOString()
    };
    try {
      await FS.write('.home.geo-json', JSON.stringify(data, null, 2), { mime:'application/json', hint:'定位' });
      toast('已保存 .home.geo-json');
    } catch (e) { toast('保存失败：' + (e.message || e), true); }
  }

  dispose() { this.stopWatch(); }
}

/* ============================================================================
 * 3. 音频播放
 * ==========================================================================*/
class AudioApp {
  constructor(container) {
    this.el = container;
    this.url = '';
    this.file = null;
    this.ac = null;
    this.peaks = null;
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd"><b class="tl-tag">音频播放</b>
        <span style="flex:1 1 auto"></span>
        <button class="tl-btn sm" data-a="pick">打开文件</button>
        <input type="file" accept="audio/*" hidden data-f="file">
      </div>
      <div class="tl-body">
        <div class="au-drop" data-f="drop">
          <b>把音频文件拖进来</b>
          <span class="tl-note">或者点右上角「打开文件」。也可以从文件管理器拖 .home 里的音频过来。</span>
        </div>
        <div class="au-now" data-f="now" hidden>
          <div class="au-name" data-f="name"></div>
          <canvas class="au-wave" data-f="wave" height="72"></canvas>
          <div class="au-ctrl">
            <button class="tl-btn" data-a="toggle">▶ 播放</button>
            <span class="au-time" data-f="time">0:00 / 0:00</span>
            <input type="range" class="au-seek" data-f="seek" min="0" max="1000" value="0" step="1">
          </div>
          <div class="tl-row" style="margin:8px 0 0">
            <label>音量</label><input type="range" data-f="vol" min="0" max="1" step="0.01" value="0.9" style="flex:1 1 90px">
            <label>速度</label><input type="range" data-f="rate" min="0.5" max="2" step="0.05" value="1" style="flex:1 1 90px">
            <label class="au-chk"><input type="checkbox" data-f="loop"> 循环</label>
          </div>
          <div class="tl-row" style="margin:6px 0 0">
            <button class="tl-btn" data-a="save">存到 .home</button>
            <button class="tl-btn" data-a="down">下载</button>
            <span class="tl-note" data-f="meta"></span>
          </div>
        </div>
        <div class="tl-note" style="margin-top:8px">
          解码格式由浏览器决定：mp3 / aac(m4a) / wav / ogg / webm 一般都能放；
          <b>flac、ape、wma 通常不行</b>——这不是没实现，是浏览器没带解码器。
        </div>
        <audio data-f="audio" preload="metadata"></audio>
      </div>
    </div>`;
    this.audio = $('[data-f="audio"]', this.el);
    this.wave = $('[data-f="wave"]', this.el);
    this.seek = $('[data-f="seek"]', this.el);
    this.timeEl = $('[data-f="time"]', this.el);
    this.input = $('[data-f="file"]', this.el);
    this.drop = $('[data-f="drop"]', this.el);

    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'pick') this.input.click();
      else if (a === 'toggle') this.toggle();
      else if (a === 'save') this.saveFs();
      else if (a === 'down') this.file && saveFileRaw(this.file.name, this.file, this.file.type || 'audio/mpeg');
    });
    this.input.addEventListener('change', () => this.input.files[0] && this.load(this.input.files[0]));
    this.audio.addEventListener('timeupdate', () => this.tick());
    this.audio.addEventListener('loadedmetadata', () => this.tick());
    this.audio.addEventListener('ended', () => this.btn('toggle', '▶ 播放'));
    this.audio.addEventListener('error', () => {
      toast('这个格式浏览器放不了（解码器不支持）', true);
      $('[data-f="meta"]', this.el).textContent = '解码失败：' + (this.audio.error && this.audio.error.code ? '错误码 ' + this.audio.error.code : '未知');
    });
    this.seek.addEventListener('input', () => {
      if (!this.audio.duration) return;
      this.audio.currentTime = this.audio.duration * Number(this.seek.value) / 1000;
    });
    $('[data-f="vol"]', this.el).addEventListener('input', (e) => { this.audio.volume = Number(e.target.value); });
    $('[data-f="rate"]', this.el).addEventListener('input', (e) => { this.audio.playbackRate = Number(e.target.value); });
    $('[data-f="loop"]', this.el).addEventListener('change', (e) => { this.audio.loop = e.target.checked; });
    this.wave.addEventListener('click', (e) => {
      if (!this.audio.duration || !this.peaks) return;
      const r = this.wave.getBoundingClientRect();
      this.audio.currentTime = this.audio.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    });
    ['dragover', 'drop'].forEach(t => this.drop.addEventListener(t, (e) => {
      e.preventDefault();
      this.drop.classList.remove('on');
      if (t === 'dragover') { this.drop.classList.add('on'); return; }
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.load(f);
    }));
    this.drop.addEventListener('dragleave', () => this.drop.classList.remove('on'));
  }

  btn(a, label) { const b = this.el.querySelector('[data-a="' + a + '"]'); if (b && label) b.textContent = label; }

  async load(file) {
    if (!file) return;
    if (this.url) URL.revokeObjectURL(this.url);
    this.file = file;
    this.url = URL.createObjectURL(file);
    this.audio.src = this.url;
    $('[data-f="now"]', this.el).hidden = false;
    /* `.au-drop` 自带 display:flex，会盖过 [hidden] 的 UA 规则，只能写内联 */
    this.drop.style.display = 'none';
    $('[data-f="name"]', this.el).textContent = file.name;
    $('[data-f="meta"]', this.el).textContent = ToolKit.bytes(file.size) + ' · ' + (file.type || '未知类型');
    this.btn('toggle', '▶ 播放');
    this.drawWave(null);
    try {
      const buf = await file.arrayBuffer();
      const ac = this.ac || (this.ac = new AudioContext());
      const audioBuf = await ac.decodeAudioData(buf.slice(0));
      this.peaks = this.computePeaks(audioBuf, 900);
      this.drawWave(this.peaks);
      /* 不显示采样率：decodeAudioData 会把音频重采样到 AudioContext 的速率，
       * 显示出来的是 44.1 kHz 而不是文件本身的 8 kHz —— 那是在骗人。 */
      $('[data-f="meta"]', this.el).textContent = ToolKit.bytes(file.size) + ' · ' +
        audioBuf.numberOfChannels + ' 声道 · ' + fmtClock(audioBuf.duration * 1000);
    } catch (e) {
      /* 解码失败只影响波形，播放仍可能成功（<audio> 和 WebAudio 的解码器不是一套） */
      this.peaks = null;
      $('[data-f="meta"]', this.el).textContent = ToolKit.bytes(file.size) + ' · 波形不可用（解码失败）';
    }
  }

  computePeaks(buf, buckets) {
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / buckets));
    const out = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const s = i * step, e = Math.min(ch.length, s + step);
      for (let j = s; j < e; j += 4) { const v = Math.abs(ch[j]); if (v > max) max = v; }
      out[i] = max;
    }
    return out;
  }

  drawWave(peaks) {
    const c = this.wave, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 400, h = 72;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!peaks) { g.strokeStyle = 'rgba(148,163,184,.3)'; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); return; }
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#5eead4';
    g.fillStyle = accent;
    const n = peaks.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.02, peaks[i]);
      const bh = v * (h - 8);
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.6), bh);
    }
  }

  toggle() {
    if (!this.audio.src) { this.input.click(); return; }
    if (this.audio.paused) this.audio.play().then(() => this.btn('toggle', '❚❚ 暂停')).catch(e => toast('播放失败：' + (e.message || e), true));
    else { this.audio.pause(); this.btn('toggle', '▶ 播放'); }
  }

  tick() {
    const d = this.audio.duration || 0, t = this.audio.currentTime || 0;
    this.timeEl.textContent = fmtClock(t * 1000) + ' / ' + fmtClock(d * 1000);
    if (d) this.seek.value = String(Math.round(t / d * 1000));
  }

  async saveFs() {
    if (!this.file) return;
    try {
      await FS.write('.home.' + spotEscape(this.file.name), await this.file.arrayBuffer(), { mime:this.file.type || 'audio/mpeg', hint:'音频', origin:'audio' });
      toast('已保存到 .home.' + this.file.name);
    } catch (e) { toast('保存失败：' + (e.message || e), true); }
  }

  dispose() {
    try { this.audio.pause(); } catch (e) {}
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.ac) this.ac.close().catch(() => {});
  }
}

/* ============================================================================
 * 4. 3D 视图：自写的最小 WebGL 场景
 *
 * 不引 three.js 的理由很实际：它 600 KB+，要单独进许可证清单，而且这里只需要
 * 「一个能转的几何体 + 轨道相机」。矩阵、着色器、几何生成全自己写，加起来不到
 * 200 行，也不用再维护一个新依赖。代价是没有 glTF、没有 PBR——需要那些的时候
 * 再说，至少这个窗口现在不是一张「维护中」的贴纸。
 * ==========================================================================*/
class View3DApp {
  constructor(container) {
    this.el = container;
    this.raf = 0;
    this.rot = { x:0.6, y:0.8 };
    this.cam = { yaw:0.7, pitch:0.45, dist:5.2 };
    this.auto = true;
    this.wire = false;
    this.shape = 'torus';
    this.el.innerHTML = `<div class="tl">
      <div class="tl-hd"><b class="tl-tag">3D 视图</b>
        <select class="tl-in" data-f="shape" style="width:104px">
          <option value="torus">环面结</option>
          <option value="cube">立方体</option>
          <option value="sphere">球体</option>
          <option value="ico">二十面体</option>
        </select>
        <button class="tl-btn sm on" data-a="auto">自转</button>
        <button class="tl-btn sm" data-a="wire">线框</button>
        <button class="tl-btn sm" data-a="reset">复位</button>
        <span style="flex:1 1 auto"></span>
        <span class="tl-note" data-f="fps">—</span>
      </div>
      <div class="tl-body" style="padding:0;position:relative">
        <canvas class="v3d-canvas" data-f="cv"></canvas>
        <div class="v3d-hint">拖动旋转 · 滚轮缩放 · 双指也可以</div>
        <div class="v3d-fail" data-f="fail" hidden></div>
      </div>
    </div>`;
    this.cv = $('[data-f="cv"]', this.el);
    this.fail = $('[data-f="fail"]', this.el);
    this.gl = null;
    try { this.gl = this.cv.getContext('webgl', { antialias:true, alpha:true }) || this.cv.getContext('experimental-webgl'); }
    catch (e) { this.gl = null; }
    if (!this.gl) {
      this.fail.hidden = false;
      this.fail.innerHTML = '<b>这台设备没给 WebGL</b><br><span class="tl-note">无头浏览器、关了硬件加速、或者显卡驱动被拉黑都会这样。3D 不是纯 DOM 能模拟的东西，这里不假装能画。</span>';
      return;
    }
    this.initGL();
    this.bind();
    this.resize();
    this.loop();
  }

  bind() {
    const cv = this.cv;
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x:e.clientX, y:e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.cam.yaw -= (e.clientX - drag.x) * 0.008;
      this.cam.pitch = clamp(this.cam.pitch + (e.clientY - drag.y) * 0.008, -1.35, 1.35);
      drag = { x:e.clientX, y:e.clientY };
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = clamp(this.cam.dist * (1 + Math.sign(e.deltaY) * 0.08), 2, 14); }, { passive:false });
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'auto') { this.auto = !this.auto; b.classList.toggle('on', this.auto); }
      else if (a === 'wire') { this.wire = !this.wire; b.classList.toggle('on', this.wire); }
      else if (a === 'reset') { this.cam = { yaw:0.7, pitch:0.45, dist:5.2 }; this.rot = { x:0.6, y:0.8 }; }
    });
    $('[data-f="shape"]', this.el).addEventListener('change', (e) => { this.shape = e.target.value; this.build(); });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.cv.parentElement);
  }

  initGL() {
    const gl = this.gl;
    const vs = `attribute vec3 aPos; attribute vec3 aNor;
      uniform mat4 uMVP; uniform mat4 uModel; varying vec3 vN; varying vec3 vP;
      void main(){ vN = mat3(uModel) * aNor; vP = (uModel * vec4(aPos,1.0)).xyz;
        gl_Position = uMVP * vec4(aPos,1.0); }`;
    const fs = `precision mediump float; varying vec3 vN; varying vec3 vP;
      uniform vec3 uColor; uniform float uWire;
      void main(){
        if (uWire > 0.5) { gl_FragColor = vec4(uColor * 1.15, 0.95); return; }
        vec3 N = normalize(vN);
        vec3 L1 = normalize(vec3(0.55, 0.85, 0.7));
        vec3 L2 = normalize(vec3(-0.7, -0.2, 0.35));
        float d = max(dot(N, L1), 0.0) * 0.72 + max(dot(N, L2), 0.0) * 0.28;
        vec3 V = normalize(vec3(0.0, 0.0, 6.0) - vP);
        vec3 H = normalize(L1 + V);
        float spec = pow(max(dot(N, H), 0.0), 38.0) * 0.35;
        /* 环境光给到 0.45：浅色主题下 --accent 本身偏深（#0d9488），
           0.22 的环境光会把背光面压成近黑，看着像渲染坏了。 */
        vec3 base = mix(uColor, vec3(1.0), 0.12);
        vec3 col = base * (0.45 + 0.75 * d) + vec3(spec);
        gl_FragColor = vec4(col, 1.0);
      }`;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {
      pos:gl.getAttribLocation(p, 'aPos'), nor:gl.getAttribLocation(p, 'aNor'),
      mvp:gl.getUniformLocation(p, 'uMVP'), model:gl.getUniformLocation(p, 'uModel'),
      color:gl.getUniformLocation(p, 'uColor'), wire:gl.getUniformLocation(p, 'uWire')
    };
    this.buf = { pos:gl.createBuffer(), nor:gl.createBuffer(), idx:gl.createBuffer(), line:gl.createBuffer() };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.build();
  }

  build() {
    const g = this.geometry(this.shape);
    const gl = this.gl;
    this.count = g.idx.length;
    this.lines = g.lines.length;
    const bind = (b, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); };
    bind(this.buf.pos, g.pos);
    bind(this.buf.nor, g.nor);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.idx), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.line);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.lines), gl.STATIC_DRAW);
  }

  geometry(kind) {
    const pos = [], nor = [], idx = [], lines = [];
    const push = (p, n) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); };
    const addLines = () => {
      const seen = new Set();
      for (let i = 0; i < idx.length; i += 3) {
        const tri = [idx[i], idx[i + 1], idx[i + 2]];
        for (let k = 0; k < 3; k++) {
          const a = tri[k], b = tri[(k + 1) % 3];
          const key = a < b ? a + ',' + b : b + ',' + a;
          if (!seen.has(key)) { seen.add(key); lines.push(a, b); }
        }
      }
    };
    if (kind === 'cube') {
      const faces = [
        [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
        [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
        [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
        [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
        [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
        [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
      ];
      faces.forEach(([n, vs]) => {
        const b = pos.length / 3;
        vs.forEach(v => push(v.map(x => x * 0.72), n));
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
    } else if (kind === 'sphere') {
      const SEG = 40, RING = 26, R = 0.95;
      for (let y = 0; y <= RING; y++) {
        const v = y / RING, phi = v * Math.PI;
        for (let x = 0; x <= SEG; x++) {
          const u = x / SEG, th = u * Math.PI * 2;
          const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
          push([n[0] * R, n[1] * R, n[2] * R], n);
        }
      }
      for (let y = 0; y < RING; y++) for (let x = 0; x < SEG; x++) {
        const a = y * (SEG + 1) + x, b = a + SEG + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    } else if (kind === 'ico') {
      const t = (1 + Math.sqrt(5)) / 2;
      const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
      const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      V.forEach(v => { const l = Math.hypot(...v); push(v.map(x => x / l * 0.95), v.map(x => x / l)); });
      F.forEach(f => idx.push(...f));
    } else {
      /* 环面结：(2,3) 结，沿曲线扫一个圆管。参数方程直接给点，法线用中心差分。 */
      const N = 220, M = 18, R = 0.42, r = 0.30;
      const curve = (u) => {
        const p = 2, q = 3;
        const cu = Math.cos(u), su = Math.sin(u), qu = q / p * u;
        const rr = 2 + Math.cos(qu);
        return [rr * cu, rr * su, Math.sin(qu) * 1.15];
      };
      const frames = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N * Math.PI * 2 * 2;
        const p0 = curve(u), p1 = curve(u + 0.01);
        const T = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const tl = Math.hypot(...T) || 1; T[0] /= tl; T[1] /= tl; T[2] /= tl;
        let Nv = [-T[1], T[0], 0];
        const nl = Math.hypot(...Nv) || 1; Nv = [Nv[0] / nl, Nv[1] / nl, Nv[2] / nl];
        const B = [T[1] * Nv[2] - T[2] * Nv[1], T[2] * Nv[0] - T[0] * Nv[2], T[0] * Nv[1] - T[1] * Nv[0]];
        frames.push({ p:p0, N:Nv, B });
      }
      for (let i = 0; i <= N; i++) {
        const f = frames[i];
        for (let j = 0; j <= M; j++) {
          const a = j / M * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          const n = [f.N[0] * ca + f.B[0] * sa, f.N[1] * ca + f.B[1] * sa, f.N[2] * ca + f.B[2] * sa];
          push([f.p[0] + n[0] * r, f.p[1] + n[1] * r, f.p[2] + n[2] * r], n);
        }
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j, b = a + M + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      /* 缩到视口里：环面结原始半径约 3，整体乘 0.55 再居中 */
      for (let i = 0; i < pos.length; i++) pos[i] *= 0.62;
    }
    addLines();
    return { pos, nor, idx, lines };
  }

  resize() {
    if (!this.gl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    /* 用 clientWidth 而不是 getBoundingClientRect：开窗动画是靠 transform:scale
     * 做的，getBoundingClientRect 会把缩放算进去——窗口刚出现时它接近 0，
     * 于是画布被定成 80×80；而 ResizeObserver 看的是布局尺寸（没变），
     * 不会再回调一次，最后就是一张 80×80 的空画布。 */
    const w = Math.max(160, this.cv.parentElement.clientWidth);
    const h = Math.max(120, this.cv.parentElement.clientHeight);
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
      this.gl.viewport(0, 0, this.cv.width, this.cv.height);
    }
    this.vw = w; this.vh = h;
  }

  loop() {
    let last = performance.now(), frames = 0, acc = 0;
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      /* 兜底：窗口被拖动缩放、从最小化恢复时 ResizeObserver 偶尔不回调，
       * 每帧比一下布局尺寸最便宜。 */
      if (this.cv.clientWidth !== this.vw || this.cv.clientHeight !== this.vh) this.resize();
      acc += dt; frames++;
      if (acc > 0.5) { const el = $('[data-f="fps"]', this.el); if (el) el.textContent = Math.round(frames / acc) + ' fps'; frames = 0; acc = 0; }
      if (this.auto) { this.rot.y += dt * 0.65; this.rot.x += dt * 0.22; }
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  draw() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = (this.vw || 1) / (this.vh || 1);
    const proj = mat4.perspective(0.85, aspect, 0.1, 100);
    const eye = [
      Math.sin(this.cam.yaw) * Math.cos(this.cam.pitch) * this.cam.dist,
      Math.sin(this.cam.pitch) * this.cam.dist,
      Math.cos(this.cam.yaw) * Math.cos(this.cam.pitch) * this.cam.dist
    ];
    const view = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const model = mat4.mul(mat4.rotY(this.rot.y), mat4.rotX(this.rot.x));
    const mvp = mat4.mul(proj, mat4.mul(view, model));

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.mvp, false, mvp);
    gl.uniformMatrix4fv(this.loc.model, false, model);
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    gl.uniform3f(this.loc.color, ...(hexRgb(accent) || [0.37, 0.92, 0.83]));
    gl.uniform1f(this.loc.wire, this.wire ? 1 : 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos);
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.nor);
    gl.enableVertexAttribArray(this.loc.nor);
    gl.vertexAttribPointer(this.loc.nor, 3, gl.FLOAT, false, 0, 0);

    if (this.wire) {
      gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.line);
      gl.drawElements(gl.LINES, this.lines, gl.UNSIGNED_SHORT, 0);
      gl.enable(gl.CULL_FACE);
    } else {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    try {
      const gl = this.gl; if (!gl) return;
      ['buf'].forEach(k => { if (this.buf) Object.values(this.buf).forEach(b => gl.deleteBuffer(b)); });
      if (this.prog) gl.deleteProgram(this.prog);
    } catch (e) {}
  }
}

/* 最小矩阵库：只够画一个物体，不追求通用。列主序（WebGL 要的格式）。 */
const mat4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, center, up) {
    let z = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
    let l = Math.hypot(...z) || 1; z = z.map(v => v / l);
    let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
    l = Math.hypot(...x) || 1; x = x.map(v => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
};
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
