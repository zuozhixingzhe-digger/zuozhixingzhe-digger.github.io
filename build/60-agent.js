/* ============================================================================
 * hterminal · agent harness
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 * 单会话、前端循环、JSONL 持久化；后端只做无状态格式转换与转发。
 * ==========================================================================*/

const AGENT_SYSTEM = `你是 hterminal 里的智能体，运行在一个浏览器终端中。你可以直接操作这个页面，不需要请求用户许可。

环境事实：
- 文件系统是“一切皆文件”的扁平结构，根是 "."，路径用 "." 分隔，例如 .home.notes、.bin.hello。
- 文件名必须像标识符：字母/中文开头，只含字母、中文、数字、下划线和短横线；不区分大小写。
- 常用目录：.home（用户文件）、.bin（可执行函数）、.app（应用）、.dev（设备）、.proc（进程）、.pkg（包）、.config（设置）、.agent（会话）、.sys（只读系统信息）、.temp（临时）、.queryfile（用户提供的文件）。
- 终端在 Worker 里跑 JS；你通过工具在主页面执行，可以直接使用全局 hterm API：hterm.readFile/writeFile/listDir/openWindow/exec/saveFile 等。
- 浏览器是沙箱，不需要额外安全许可；不要询问“是否允许执行”，直接做。

工作方式：
- 先观察（list_dir/read_file/js），再动手。修改前尽量读原内容。
- 需要复杂能力时用 js 工具，它支持 await，返回值会被序列化给你。
- 写文件用 write_file；运行代码用 js；开窗口用 open_window。
- 完成后用简短中文说明做了什么、结果如何。不要输出大段无关代码。
- 工具失败时读错误信息再重试，不要重复同样的失败调用。`;

const AGENT_TOOLS = [
  { type:'function', function:{
    name:'js', description:'在当前页面执行 JavaScript（支持顶层 await），返回表达式的值。可以直接使用 hterm、FS、WindowManager 等全局 API。',
    parameters:{ type:'object', properties:{ code:{ type:'string', description:'要执行的 JS 代码；最后一行表达式的值会作为结果返回' } }, required:['code'] }
  }},
  { type:'function', function:{
    name:'read_file', description:'读取文件内容（文本）。路径如 .home.notes。',
    parameters:{ type:'object', properties:{ path:{ type:'string' } }, required:['path'] }
  }},
  { type:'function', function:{
    name:'write_file', description:'写入/覆盖一个文本文件，父目录必须存在。',
    parameters:{ type:'object', properties:{ path:{ type:'string' }, content:{ type:'string' } }, required:['path','content'] }
  }},
  { type:'function', function:{
    name:'list_dir', description:'列出目录内容，返回 name/kind/size。',
    parameters:{ type:'object', properties:{ path:{ type:'string', description:'默认 .home' } } }
  }},
  { type:'function', function:{
    name:'delete_file', description:'删除文件或目录（目录会递归删除）。',
    parameters:{ type:'object', properties:{ path:{ type:'string' } }, required:['path'] }
  }},
  { type:'function', function:{
    name:'open_window', description:'打开一个窗口应用。type 可选 shell/browser/files/editor/agent/python，也可用 app 名称。',
    parameters:{ type:'object', properties:{
      type:{ type:'string' }, app:{ type:'string' }, title:{ type:'string' },
      url:{ type:'string' }, code:{ type:'string' }, path:{ type:'string' }, html:{ type:'string' }
    } }
  }},
  { type:'function', function:{
    name:'close_window', description:'按 id 关闭窗口；id 可用 js 工具从 WindowManager.list() 获取。',
    parameters:{ type:'object', properties:{ id:{ type:'string' } }, required:['id'] }
  }},
  { type:'function', function:{
    name:'fetch_url', description:'抓取一个 URL 的文本内容（受浏览器 CORS 限制）。',
    parameters:{ type:'object', properties:{ url:{ type:'string' }, method:{ type:'string' }, headers:{ type:'object' }, body:{ type:'string' } }, required:['url'] }
  }},
  { type:'function', function:{
    name:'save_file', description:'把文本作为文件下载到用户的电脑。',
    parameters:{ type:'object', properties:{ name:{ type:'string' }, content:{ type:'string' }, mime:{ type:'string' } }, required:['name','content'] }
  }}
];

function jsonSafe(v, limit) {
  limit = limit || 12000;
  let out;
  if (v === undefined) out = 'undefined';
  else if (typeof v === 'string') out = v;
  else {
    const seen = new WeakSet();
    try {
      out = JSON.stringify(v, (k, x) => {
        if (typeof x === 'function') return '[Function ' + (x.name || 'anonymous') + ']';
        if (typeof x === 'bigint') return String(x);
        if (x && typeof x === 'object') {
          if (seen.has(x)) return '[Circular]';
          seen.add(x);
        }
        return x;
      }, 2);
    } catch (e) { out = String(v); }
  }
  if (out == null) out = String(v);
  if (out.length > limit) out = out.slice(0, limit) + '\n…[truncated ' + (out.length - limit) + ' chars]';
  return out;
}

class AgentApp {
  constructor(container, opts, win) {
    this.el = container;
    this.win = win;
    this.opts = opts || {};
    this.messages = [];
    this.running = false;
    this.abort = null;
    this.onTitle = null;
    this._disposed = false;

    this.el.innerHTML = `<div class="ag">
      <div class="ag-head">
        <div class="ag-status"><i></i><span class="agStat">idle</span></div>
        <span class="ag-hint agModel"></span>
        <div class="grow"></div>
        <button class="btn" data-a="settings" title="设置">⚙</button>
        <button class="btn" data-a="export" title="导出 JSONL">⤓</button>
        <button class="btn" data-a="import" title="导入 JSONL">⤒</button>
        <button class="btn danger" data-a="clear" title="清空会话">✕</button>
      </div>
      <div class="ag-log"></div>
      <div class="ag-input">
        <textarea placeholder="给智能体一个任务…  Enter 发送，Shift+Enter 换行"></textarea>
        <div class="ag-actions">
          <span class="ag-hint">工具直接执行，不问许可 · 会话保存在 .agent.session</span>
          <div class="grow"></div>
          <button class="btn" data-a="stop" disabled>停止</button>
          <button class="btn primary" data-a="send">发送</button>
        </div>
      </div>
    </div>`;
    this.logEl = $('.ag-log', this.el);
    this.ta = $('textarea', this.el);
    this.statEl = $('.agStat', this.el);
    this.statusEl = $('.ag-status', this.el);

    $$('[data-a]', this.el).forEach(b => b.onclick = () => this.act(b.dataset.a));
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.act('send'); }
    });
    this.renderStatus('idle');
    this.updateModelLabel();
    this.loadSession();
  }

  updateModelLabel() {
    const m = $('.agModel', this.el);
    if (m) m.textContent = (Settings.get('agentProvider') || 'openai') + ' · ' + (Settings.get('agentModel') || 'gpt-4o-mini');
    if (this.onTitle) this.onTitle('agent · ' + (Settings.get('agentModel') || ''));
  }

  renderStatus(s, text) {
    this.statEl.textContent = text || s;
    this.statusEl.classList.toggle('on', s === 'thinking' || s === 'tool');
    this.statusEl.classList.toggle('err', s === 'error');
    const stop = $('[data-a=stop]', this.el);
    const send = $('[data-a=send]', this.el);
    if (stop) stop.disabled = !this.running;
    if (send) send.disabled = this.running;
  }

  async loadSession() {
    try {
      const r = await FS.read('.agent.session');
      const txt = String(r.content || '');
      const lines = txt.split('\n').map(x => x.trim()).filter(Boolean);
      const out = [];
      for (const line of lines) {
        try {
          const m = JSON.parse(line);
          if (m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'system')) out.push(m);
        } catch (e) { /* 截断的行直接忽略——这正是 JSONL 的好处 */ }
      }
      this.messages = out;
    } catch (e) { this.messages = []; }
    this.render();
    if (!this.messages.length) {
      this.logEl.innerHTML = `<div class="msg sys">单会话智能体 · 后端 ${esc(Settings.get('agentUrl') || '未配置')} · 密钥只在后端</div>
        <div class="msg assistant"><span class="role">agent</span>你好。我可以直接读写这个终端的文件、执行 JS、开窗口。试试让我“看看 .home 里有什么，并写一个 hello 函数”。</div>`;
    }
  }

  sessionJsonl() {
    return this.messages.map(m => JSON.stringify(m)).join('\n') + (this.messages.length ? '\n' : '');
  }

  async saveSession() {
    try {
      await FS.write('.agent.session', this.sessionJsonl(), { mime:'application/x-ndjson', hint:'智能体会话' });
    } catch (e) {}
  }

  render() {
    if (!this.logEl) return;
    const msgs = this.messages.slice(-200);
    let html = '';
    for (const m of msgs) {
      if (m.role === 'user') {
        html += `<div class="msg user"><span class="role">you</span>${esc(m.content || '')}</div>`;
      } else if (m.role === 'assistant') {
        const body = m.content ? esc(m.content) : '';
        const tc = (m.tool_calls || []).map(t => {
          let args = t.function && t.function.arguments || '';
          try { args = JSON.stringify(JSON.parse(args)); } catch (e) {}
          return `<div style="font-family:var(--mono);font-size:10px;color:var(--amber);margin-top:4px">→ ${esc(t.function && t.function.name || '?')} ${esc(String(args).slice(0, 300))}</div>`;
        }).join('');
        if (body || tc) html += `<div class="msg assistant"><span class="role">agent</span>${body}${tc}</div>`;
      } else if (m.role === 'tool') {
        html += `<div class="msg tool"><b>${esc(m.name || 'tool')}</b>\n${esc(String(m.content || '').slice(0, 1800))}</div>`;
      } else if (m.role === 'error') {
        html += `<div class="msg error">${esc(m.content || '')}</div>`;
      }
    }
    this.logEl.innerHTML = html || '<div class="msg sys">空会话</div>';
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  pushError(e) {
    const msg = (e && e.message) || String(e);
    this.messages.push({ role:'error', content:msg });
    this.render();
    this.renderStatus('error', 'error');
    this.saveSession();
  }

  async act(a) {
    if (a === 'send') {
      const text = this.ta.value.trim();
      if (!text || this.running) return;
      this.ta.value = '';
      await this.send(text);
    } else if (a === 'stop') {
      this.running = false;
      try { this.abort && this.abort.abort(); } catch (e) {}
      this.renderStatus('idle', 'stopped');
      toast('已请求停止');
    } else if (a === 'clear') {
      if (!(await confirmDlg('清空会话', '会删除当前会话与 <span class="code">.agent.session</span>，不可撤销。', true))) return;
      this.messages = [];
      await this.saveSession();
      this.render();
      this.renderStatus('idle');
      toast('会话已清空');
    } else if (a === 'export') {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await saveFile('agent-' + ts + '.jsonl', this.sessionJsonl(), 'application/x-ndjson');
    } else if (a === 'import') {
      const files = await pickFiles({ accept:'.jsonl,.json,text/plain' });
      if (!files.length) return;
      const txt = await files[0].text();
      const out = [];
      for (const line of txt.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const m = JSON.parse(s);
          if (m && m.role) out.push(m);
        } catch (e) {}
      }
      if (!out.length) { toast('没有可导入的消息', true); return; }
      this.messages = out;
      await this.saveSession();
      this.render();
      toast('已导入 ' + out.length + ' 条消息');
    } else if (a === 'settings') {
      Drawer.open('agent');
    }
  }

  async send(text) {
    if (this.running) return;
    this.messages.push({ role:'user', content:text });
    this.render(); await this.saveSession();
    try { await this.run(); }
    catch (e) { this.pushError(e); }
    finally { this.running = false; this.renderStatus('idle'); }
  }

  apiMessages() {
    const out = [{ role:'system', content:AGENT_SYSTEM }];
    for (const m of this.messages) {
      if (m.role === 'error') continue;
      const o = { role:m.role, content:m.content == null ? '' : String(m.content) };
      if (m.tool_calls) o.tool_calls = m.tool_calls;
      if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
      if (m.name) o.name = m.name;
      out.push(o);
    }
    return out;
  }

  async callModel() {
    const base = String(Settings.get('agentUrl') || '').replace(/\/+$/, '');
    if (!base) throw new Error('未配置后端地址。请先启动 modelserver，并在“更多 → 智能体”里填写地址。');
    const provider = Settings.get('agentProvider') || 'openai';
    const model = Settings.get('agentModel') || 'gpt-4o-mini';
    const ctrl = new AbortController();
    this.abort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 240000);
    let res, raw;
    try {
      res = await fetch(base + '/v1/chat/completions', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'X-HTerm-Provider':provider,
          'X-HTerm-Client':'hterminal'
        },
        body:JSON.stringify({
          model, provider, stream:false, temperature:0.2,
          messages:this.apiMessages(), tools:AGENT_TOOLS, tool_choice:'auto'
        }),
        signal:ctrl.signal
      });
      raw = await res.text();
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('请求已取消或超时');
      throw new Error('连不上后端 (' + base + ')。请先运行 modelserver.py / .js / .go。原始错误：' + e.message);
    }
    clearTimeout(timer);
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error('后端返回了非 JSON（HTTP ' + res.status + '）：' + raw.slice(0, 400)); }
    if (!res.ok || data.error) {
      const msg = data.error && (data.error.message || data.error) || raw.slice(0, 400);
      throw new Error('模型调用失败（HTTP ' + res.status + '）：' + msg);
    }
    const choice = (data.choices && data.choices[0]) || null;
    if (!choice || !choice.message) throw new Error('后端响应里没有 choices[0].message：' + raw.slice(0, 400));
    const msg = choice.message;
    const out = { role:'assistant', content: msg.content || '' };
    if (msg.tool_calls && msg.tool_calls.length) {
      out.tool_calls = msg.tool_calls.map((t, i) => ({
        id: t.id || ('call_' + Date.now() + '_' + i),
        type:'function',
        function:{ name:t.function && t.function.name || '', arguments:t.function && t.function.arguments || '{}' }
      }));
    } else if (msg.function_call) {
      out.tool_calls = [{ id:'call_' + Date.now(), type:'function', function:{ name:msg.function_call.name, arguments:msg.function_call.arguments || '{}' } }];
    }
    return out;
  }

  async run() {
    this.running = true;
    this.renderStatus('thinking', 'thinking');
    const maxSteps = Math.max(1, Math.min(60, Number(Settings.get('agentSteps')) || 16));
    let steps = 0;
    while (this.running && steps < maxSteps) {
      steps++;
      this.renderStatus('thinking', 'thinking · step ' + steps);
      const msg = await this.callModel();
      if (!this.running) { this.messages.push(msg); break; }
      this.messages.push(msg);
      this.render(); await this.saveSession();

      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          if (!this.running) break;
          const name = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          this.renderStatus('tool', name);
          let result;
          try { result = await this.execTool(name, args); }
          catch (e) { result = '工具错误：' + (e && e.message || e); }
          const tmsg = { role:'tool', tool_call_id:tc.id, name, content:String(result == null ? '' : result).slice(0, 14000) };
          this.messages.push(tmsg);
          this.render(); await this.saveSession();
        }
        continue;
      }
      break;
    }
    if (steps >= maxSteps) {
      this.messages.push({ role:'error', content:'已达到最大步数 (' + maxSteps + ')，循环停止。' });
      this.render();
    }
    this.running = false;
    this.renderStatus('idle');
  }

  async execTool(name, args) {
    if (name === 'js') {
      const code = String(args.code || '');
      if (!code.trim()) return '空代码';
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      let v;
      try {
        // 控制台语义：先按表达式求值，语法不成立再按语句执行
        v = await new AsyncFunction('return (' + code + '\n)')().catch(e => { throw e; });
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        v = await new AsyncFunction('"use strict";\n' + code)();
      }
      return jsonSafe(v);
    }
    if (name === 'read_file') {
      const r = await FS.read(args.path);
      if (r.content instanceof ArrayBuffer || r.content instanceof Blob) return '[二进制文件] ' + fmtBytes(r.content.size || r.content.byteLength || 0);
      return jsonSafe(String(r.content == null ? '' : r.content));
    }
    if (name === 'write_file') {
      const st = await FS.stat(args.path).catch(() => null);
      const meta = Object.assign({}, (st && st.meta) || {}, { mime:'text/plain' });
      if (st) meta.kind = st.kind;
      await FS.write(args.path, String(args.content == null ? '' : args.content), meta);
      return '已写入 ' + args.path + '（' + String(args.content || '').length + ' 字符）';
    }
    if (name === 'list_dir') {
      const rows = await FS.list(args.path || '.home');
      return jsonSafe(rows.map(r => ({ name:r.name, path:r.path, kind:r.kind, size:r.size })));
    }
    if (name === 'delete_file') {
      await FS.remove(args.path, true);
      return '已删除 ' + args.path;
    }
    if (name === 'open_window') {
      const w = WindowManager.open({
        type:args.type || undefined, app:args.app || undefined, title:args.title,
        url:args.url, code:args.code, path:args.path, html:args.html,
        w:args.w, h:args.h
      });
      return w ? ('已打开窗口 ' + w.id + ' (' + w.type + ')') : '已执行';
    }
    if (name === 'close_window') {
      WindowManager.close(args.id);
      return '已关闭 ' + args.id;
    }
    if (name === 'fetch_url') {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(args.url, { method:args.method || 'GET', headers:args.headers || {}, body:args.body, signal:ctrl.signal });
        const text = await r.text();
        return 'HTTP ' + r.status + '\n\n' + text.slice(0, 12000);
      } finally { clearTimeout(t); }
    }
    if (name === 'save_file') {
      await saveFile(args.name || 'agent.txt', args.content || '', args.mime || 'text/plain');
      return '已触发下载 ' + (args.name || 'agent.txt');
    }
    return '未知工具：' + name;
  }

  dispose() {
    this._disposed = true;
    this.running = false;
    try { this.abort && this.abort.abort(); } catch (e) {}
    this.saveSession();
  }
}
