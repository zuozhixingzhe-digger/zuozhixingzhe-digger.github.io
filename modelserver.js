#!/usr/bin/env node
/*
 * hterminal modelserver — 无状态 Chat Completions 转发（Node.js / 标准库）
 * SPDX-License-Identifier: Apache-2.0 OR MIT
 * 由 AI 智能体生成并维护。
 *
 * 与 modelserver.py / modelserver.go 逻辑同步。只监听 127.0.0.1，只做格式转换与转发。
 * 不保存对话、不读文件、不执行工具、不写日志文件。密钥只在环境变量里。
 *
 * 环境变量：HT_PORT / OPENAI_API_KEY / OPENAI_BASE_URL /
 *           ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / HT_MODEL / HT_TIMEOUT / HT_DEFAULT_PROVIDER /
 *           HT_RPM / HT_BURST / HT_FETCH_RPM
 * 命令行（优先级高于环境变量）：--rpm 60  --burst 20  --fetch-rpm 120  --help
 * 需要 Node.js 18+（内置 fetch）。
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const nodePath = require('node:path');

function intEnv(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== '' ? Math.trunc(n) : def;
}

function parseArgs(argv) {
  const o = {
    rpm: intEnv('HT_RPM', 60),
    burst: intEnv('HT_BURST', 20),
    fetchRpm: intEnv('HT_FETCH_RPM', 120),
    noChat: false,
    noFetch: false,
    noSandbox: /^(1|true|yes)$/i.test(String(process.env.HT_NO_SELF_RESTRICT || ''))
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(`用法：node modelserver.js [选项]

  --rpm N        模型请求每分钟上限，0 关闭限流（默认 ${o.rpm}）
  --burst N      允许的瞬时突发次数（默认 ${o.burst}）
  --fetch-rpm N  抓网页每分钟上限，0 关闭（默认 ${o.fetchRpm}）
  --no-chat      关闭模型请求（/v1/chat/completions）
  --no-fetch     关闭网页抓取（/v1/fetch）
  --unsafe-no-self-restrict
                 跳过平台自沙箱（本实现未内置，保留参数以保持三份后端命令行一致）

也可用环境变量 HT_RPM / HT_BURST / HT_FETCH_RPM 设默认值。
两个功能不能同时关闭：全关等于没有服务，会直接退出。`);
      process.exit(0);
    }
    if (a === '--no-chat') { o.noChat = true; continue; }
    if (a === '--no-fetch') { o.noFetch = true; continue; }
    if (a === '--unsafe-no-self-restrict') { o.noSandbox = true; continue; }
    const m = /^--(rpm|burst|fetch-rpm)(?:=(.*))?$/.exec(a);
    if (!m) {
      console.error(`未知参数：${a}（--help 看用法）`);
      process.exit(2);
    }
    const v = m[2] !== undefined ? m[2] : argv[++i];
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < 0) {
      console.error(`--${m[1]} 需要一个非负整数`);
      process.exit(2);
    }
    if (m[1] === 'rpm') o.rpm = Math.trunc(n);
    else if (m[1] === 'burst') o.burst = Math.trunc(n);
    else o.fetchRpm = Math.trunc(n);
  }
  return o;
}

const ARGS = Object.freeze(parseArgs(process.argv.slice(2)));
const BURST = Math.max(1, ARGS.burst);

/* 功能注册表。将来加接口只在这里加一行，全关判定和路由白名单自动跟着变。 */
const FEATURES = [
  { path: '/v1/chat/completions', label: '模型请求', off: ARGS.noChat },
  { path: '/v1/fetch', label: '网页抓取', off: ARGS.noFetch }
];
/* 冻结成数组：运行期没有任何代码能往白名单里 add 一条路由。
 * （Object.freeze(new Set()) 挡不住 .add()，所以不用 Set。） */
const ENABLED = Object.freeze(FEATURES.filter(f => !f.off).map(f => f.path));
if (ENABLED.length === 0) {
  /* 全关 = 没有可提供的服务。监听一个只回 403 的端口本身就是情报。 */
  console.error(`所有功能都被关闭了（${FEATURES.map(f => f.label).join('、')}），没有可提供的服务，拒绝启动`);
  process.exit(2);
}
/* 关闭的接口与「根本不存在的路径」回同一个东西：状态码、头、正文一致。
   绝不能回「该功能已关闭」——那等于承认这里本来有个接口。 */
const REJECTED = { error: { message: '请求不被接受', type: 'forbidden' } };

const HOST = '127.0.0.1';
const PORT = Number(process.env.HT_PORT || 8787);
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const DEFAULT_MODEL = process.env.HT_MODEL || 'gpt-4o-mini';
const DEFAULT_PROVIDER = (process.env.HT_DEFAULT_PROVIDER || 'openai').toLowerCase();
const TIMEOUT = Number(process.env.HT_TIMEOUT || 120);
const MAX_BODY = 8 * 1024 * 1024;
const FETCH_MAX = 3 * 1024 * 1024;
const FETCH_TIMEOUT = Number(process.env.HT_FETCH_TIMEOUT || 20);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const VERSION = '0.0.1.19';

/* 启动时把 index.html 读成一份不可变快照。
 *
 * 用「先 open 拿到 fd、再 fstat 验它」而不是「先 stat 路径、再读路径」：
 * 后者是两步，中间那个名字能被换成软链或别的文件；前者只做一次，
 * 验的对象就是马上要读的那个句柄（O_NOFOLLOW 顺带拒掉软链）。 */
const INDEX = (() => {
  let fd;
  try {
    fd = fs.openSync(nodePath.join(__dirname, 'index.html'),
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!fs.fstatSync(fd).isFile()) return { raw: null, etag: null };
    return {
      raw: fs.readFileSync(fd),
      etag: null
    };
  } catch (e) {
    return { raw: null, etag: null };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
  }
})();
const INDEX_RAW = INDEX.raw;
const INDEX_ETAG = INDEX_RAW
  ? '"' + require('node:crypto').createHash('sha256').update(INDEX_RAW).digest('hex').slice(0, 20) + '"'
  : null;
Object.freeze(INDEX);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

/* 令牌桶：按时间连续补令牌，不用「每分钟 N 次」的固定窗口——
 * 固定窗口在边界会放过两倍突发（59 秒 N 次 + 下一秒 N 次）。
 * burst 是留给正常用法的：智能体一轮任务会连着调 3~8 次模型。 */
class TokenBucket {
  constructor(rpm, burst) {
    this.rpm = Math.max(1, Math.trunc(rpm));
    this.rate = this.rpm / 60;
    this.burst = Math.max(1, Math.trunc(burst));
    this.tokens = this.burst;
    this.last = Date.now();
    this.rejected = 0;
  }
  /* 返回 0 = 放行；否则是建议等待的秒数。失败不扣令牌。 */
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    this.rejected++;
    return (1 - this.tokens) / this.rate;
  }
}

const chatBucket = ARGS.rpm > 0 ? new TokenBucket(ARGS.rpm, BURST) : null;
const fetchBucket = ARGS.fetchRpm > 0 ? new TokenBucket(ARGS.fetchRpm, BURST) : null;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => {
      if (p && typeof p === 'object' && ['text', 'input_text', 'output_text'].includes(p.type)) return String(p.text || '');
      if (typeof p === 'string') return p;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content == null) return '';
  return String(content);
}

function joinUrl(base, path) {
  base = base.replace(/\/+$/, '');
  return base.endsWith(path) ? base : base + path;
}

async function upstream(url, payload, headers) {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT * 1000)
    });
    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return [502, { error: { message: `上游返回了非 JSON（HTTP ${resp.status}）`, type: 'bad_upstream' } }]; }
    return [resp.status, data];
  } catch (e) {
    return [502, { error: { message: `连不上上游：${e.message}`, type: 'upstream_unreachable' } }];
  }
}

/* ---------------------------------------------------------------- OpenAI / custom */
async function doOpenAI(body) {
  const payload = Object.assign({}, body);
  delete payload.provider;
  if (!payload.model) payload.model = DEFAULT_MODEL;
  const headers = { 'Content-Type': 'application/json' };
  if (OPENAI_KEY) headers.Authorization = 'Bearer ' + OPENAI_KEY;
  return upstream(joinUrl(OPENAI_BASE, '/chat/completions'), payload, headers);
}

/* ---------------------------------------------------------------- Anthropic */
function toAnthropic(body) {
  const system = [];
  const msgs = [];
  for (const m of body.messages || []) {
    const role = m.role;
    const content = m.content;
    if (role === 'system') {
      system.push(textOf(content));
    } else if (role === 'user') {
      msgs.push({ role: 'user', content: textOf(content) });
    } else if (role === 'assistant') {
      const blocks = [];
      if (textOf(content)) blocks.push({ type: 'text', text: textOf(content) });
      for (const tc of m.tool_calls || []) {
        const fn = tc.function || {};
        let args = {};
        try { args = JSON.parse(fn.arguments || '{}'); } catch (e) {}
        blocks.push({ type: 'tool_use', id: tc.id || ('call_' + Date.now()), name: fn.name || '', input: args });
      }
      if (!blocks.length) blocks.push({ type: 'text', text: '' });
      msgs.push({ role: 'assistant', content: blocks });
    } else if (role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id || '', content: textOf(content) };
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'user' && last._toolbatch) last.content.push(block);
      else msgs.push({ role: 'user', content: [block], _toolbatch: true });
    }
  }
  for (const m of msgs) delete m._toolbatch;

  const payload = {
    model: body.model || DEFAULT_MODEL,
    max_tokens: Number(body.max_tokens || body.max_completion_tokens || 4096),
    messages: msgs
  };
  if (system.length) payload.system = system.join('\n\n');
  if (body.temperature != null) payload.temperature = body.temperature;
  if (body.top_p != null) payload.top_p = body.top_p;
  if (body.stop != null) payload.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];

  const tools = [];
  for (const t of body.tools || []) {
    if (t.type !== 'function') continue;
    const fn = t.function || {};
    tools.push({
      name: fn.name || '',
      description: fn.description || '',
      input_schema: fn.parameters || { type: 'object', properties: {} }
    });
  }
  if (tools.length) {
    payload.tools = tools;
    const tc = body.tool_choice;
    if (tc === 'auto') payload.tool_choice = { type: 'auto' };
    else if (tc === 'required') payload.tool_choice = { type: 'any' };
    else if (tc && tc.type === 'function') payload.tool_choice = { type: 'tool', name: (tc.function || {}).name || '' };
  }
  return payload;
}

function fromAnthropic(data, model) {
  const text = [];
  const calls = [];
  for (const b of data.content || []) {
    if (b.type === 'text') text.push(b.text || '');
    else if (b.type === 'tool_use') {
      calls.push({
        id: b.id || ('call_' + Date.now()),
        type: 'function',
        function: { name: b.name || '', arguments: JSON.stringify(b.input || {}) }
      });
    }
  }
  const msg = { role: 'assistant', content: text.join('') };
  if (calls.length) msg.tool_calls = calls;
  const reason = { end_turn: 'stop', tool_use: 'tool_calls', max_tokens: 'length', stop_sequence: 'stop' }[data.stop_reason] || 'stop';
  const u = data.usage || {};
  return {
    id: data.id || ('chatcmpl-' + Date.now()),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [{ index: 0, message: msg, finish_reason: reason }],
    usage: {
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0)
    }
  };
}

async function doAnthropic(body) {
  const payload = toAnthropic(body);
  const headers = { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION };
  if (ANTHROPIC_KEY) headers['x-api-key'] = ANTHROPIC_KEY;
  const [status, data] = await upstream(joinUrl(ANTHROPIC_BASE, '/messages'), payload, headers);
  if (status >= 400) {
    const err = data && data.error;
    const msg = err && err.message ? err.message : JSON.stringify(data).slice(0, 400);
    return [status, { error: { message: msg || '上游错误', type: 'upstream_error', provider: 'anthropic' } }];
  }
  return [200, fromAnthropic(data, payload.model)];
}

/* ---------------------------------------------------------------- OpenAI Responses */
function toResponses(body) {
  const instructions = [];
  const items = [];
  for (const m of body.messages || []) {
    const role = m.role;
    const content = textOf(m.content);
    if (role === 'system') instructions.push(content);
    else if (role === 'user') items.push({ role: 'user', content: [{ type: 'input_text', text: content }] });
    else if (role === 'assistant') {
      if (content) items.push({ role: 'assistant', content: [{ type: 'output_text', text: content }] });
      for (const tc of m.tool_calls || []) {
        const fn = tc.function || {};
        items.push({ type: 'function_call', call_id: tc.id || '', name: fn.name || '', arguments: fn.arguments || '{}' });
      }
    } else if (role === 'tool') {
      items.push({ type: 'function_call_output', call_id: m.tool_call_id || '', output: content });
    }
  }
  const payload = { model: body.model || DEFAULT_MODEL, input: items };
  if (instructions.length) payload.instructions = instructions.join('\n\n');
  if (body.max_tokens || body.max_output_tokens) payload.max_output_tokens = Number(body.max_tokens || body.max_output_tokens);
  if (body.temperature != null) payload.temperature = body.temperature;
  if (body.top_p != null) payload.top_p = body.top_p;

  const tools = [];
  for (const t of body.tools || []) {
    if (t.type !== 'function') continue;
    const fn = t.function || {};
    tools.push({
      type: 'function', name: fn.name || '', description: fn.description || '',
      parameters: fn.parameters || { type: 'object', properties: {} }
    });
  }
  if (tools.length) {
    payload.tools = tools;
    const tc = body.tool_choice;
    if (typeof tc === 'string') payload.tool_choice = tc;
    else if (tc && tc.type === 'function') payload.tool_choice = { type: 'function', name: (tc.function || {}).name || '' };
  }
  return payload;
}

function fromResponses(data, model) {
  const text = [];
  const calls = [];
  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text') text.push(c.text || '');
      }
    } else if (item.type === 'function_call') {
      calls.push({
        id: item.call_id || item.id || ('call_' + Date.now()),
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '{}' }
      });
    }
  }
  const msg = { role: 'assistant', content: text.join('') };
  if (calls.length) msg.tool_calls = calls;
  const finish = calls.length ? 'tool_calls' : (data.status === 'incomplete' ? 'length' : 'stop');
  const u = data.usage || {};
  return {
    id: data.id || ('chatcmpl-' + Date.now()),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [{ index: 0, message: msg, finish_reason: finish }],
    usage: {
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      total_tokens: u.total_tokens != null ? u.total_tokens : ((u.input_tokens || 0) + (u.output_tokens || 0))
    }
  };
}

async function doResponses(body) {
  const payload = toResponses(body);
  const headers = { 'Content-Type': 'application/json' };
  if (OPENAI_KEY) headers.Authorization = 'Bearer ' + OPENAI_KEY;
  const [status, data] = await upstream(joinUrl(OPENAI_BASE, '/responses'), payload, headers);
  if (status >= 400) {
    const err = data && data.error;
    const msg = err && err.message ? err.message : JSON.stringify(data).slice(0, 400);
    return [status, { error: { message: msg || '上游错误', type: 'upstream_error', provider: 'responses' } }];
  }
  return [200, fromResponses(data, payload.model)];
}

/* ---------------------------------------------------------------- HTTP
 * 安全边界（缺一不可）：
 *   1. 只绑 127.0.0.1
 *   2. Host 必须是本机名 —— 挡 DNS rebinding
 *   3. Origin 必须是本机页面，且拒绝 "null" —— sandbox iframe 的 Origin 就是 null，
 *      放过它等于任何网站都能用 <iframe sandbox srcdoc="fetch(...)"> 打本地端口
 *   4. Sec-Fetch-Site: cross-site 一律拒绝 —— 浏览器自己打的标，页面改不了
 */
/* ---------------------------------------------------------------- /v1/fetch
 * 浏览器 fetch 受同源策略管，新闻站一律不带 CORS 头；r.jina.ai / allorigins
 * 在国内又经常连不上。由本机进程代抓是唯一稳定的一条路。
 * 它不是任意代理：只允许 http/https、80/443，目标必须解析到公网 IP，逐跳校验。 */
const PRIVATE = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
 ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
 ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([a, b]) => PRIVATE.addSubnet(a, b, 'ipv4'));
[['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
 ['100::', 64], ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:db8::', 32],
 ['5f00::', 8], ['64:ff9b::', 96]
].forEach(([a, b]) => PRIVATE.addSubnet(a, b, 'ipv6'));

function ipPublic(ip) {
  const fam = net.isIP(ip);
  if (!fam) return false;
  /* IPv4-mapped（::ffff:1.2.3.4）要先拆出 IPv4 再看：把 ::ffff:0:0/96 加进
   * BlockList 会把**所有** IPv4 都判成私网（写这版时踩过：toutiao 被拒）。 */
  if (fam === 6) {
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (m) return ipPublic(m[1]);
  }
  try { return !PRIVATE.check(ip, fam === 6 ? 'ipv6' : 'ipv4'); } catch (e) { return false; }
}

/* 解析一次，返回「全部是公网」的 IP 列表，供调用方钉住。
   任一 A/AAAA 落在私网就整体拒绝——多记录轮询是绕 IP 校验的常见手法。 */
async function resolvePublic(host) {
  host = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('目标不是公网地址：' + (host || '?'));
  }
  if (net.isIP(host)) {
    if (!ipPublic(host)) throw new Error('目标不是公网地址：' + host);
    return [host];
  }
  let list;
  try { list = await dns.lookup(host, { all: true }); }
  catch (e) { throw new Error('域名解析失败：' + host); }
  if (!list.length) throw new Error('域名解析失败：' + host);
  for (const a of list) {
    if (!ipPublic(a.address)) throw new Error('目标不是公网地址：' + host);
  }
  return [...new Set(list.map(a => a.address))];
}

/* 对钉死的 IP 发一次 GET，不跟随重定向。
 *
 * 直接把 hostname 写成 IP 建连，域名再也不会被查第二次；Host 头与 TLS SNI
 * 仍然用原域名，虚拟主机和证书校验都不受影响。
 * 不钉的话：校验(host) → 1.2.3.4 放行，连接(host) → 第二次解析 → 127.0.0.1，
 * 中间几毫秒换个答案，前面所有校验白做（DNS rebinding）。
 *
 * 这里不用 `lookup` 选项覆盖解析：Node 22 的 http.Agent 对它的处理与 net.connect
 * 不一致，实测报 "Invalid IP address: undefined"。直接写 IP 更稳，也更容易看懂。 */
function requestOnce(urlStr, ip) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const port = u.port ? Number(u.port) : (isHttps ? 443 : 80);
    let done = false;
    const finish = (status, headers, body) => {
      if (done) return;
      done = true;
      resolve({ status, headers, body });
    };
    const req = mod.request({
      protocol: u.protocol,
      hostname: ip,
      port,
      path: (u.pathname || '/') + (u.search || ''),
      method: 'GET',
      /* SNI 与证书域名校验都用原来的域名，不是 IP */
      servername: isHttps ? u.hostname : undefined,
      headers: {
        /* 显式 Host：连的是 IP，但对方看到的主机名必须是域名 */
        host: u.host,
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
        connection: 'close'
      }
    }, res => {
      /* 对端核对（以「事实」为准）：这里拿到的是实际承载本次响应的 socket，
       * remoteAddress 由内核给出，改不了。前面的解析、后面的任何代理都影响不到它。
       * 不是公网就直接掐——绝不把一个连到内网的响应交给上层。 */
      const peer = res.socket && res.socket.remoteAddress;
      if (!peer || !ipPublic(peer)) {
        res.destroy();
        reject(new Error('对端不是公网地址（连接后被拒）'));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        if (size >= FETCH_MAX) return;
        chunks.push(c);
        size += c.length;
        if (size >= FETCH_MAX) { res.destroy(); finish(res.statusCode, res.headers, Buffer.concat(chunks).subarray(0, FETCH_MAX)); }
      });
      const end = () => finish(res.statusCode, res.headers, Buffer.concat(chunks).subarray(0, FETCH_MAX));
      res.on('end', end);
      res.on('close', end);
      res.on('error', e => { if (!done) reject(e); });
    });
    /* 连上就立刻验，早于发请求：连错机器时连 URL 都不该发出去。 */
    req.on('socket', s => {
      let checked = false;
      const verify = () => {
        if (checked) return;
        checked = true;
        if (!s.remoteAddress || !ipPublic(s.remoteAddress)) {
          req.destroy(new Error('对端不是公网地址（连接后被拒）'));
        }
      };
      s.once('connect', verify);        /* http：TCP 建立 */
      s.once('secureConnect', verify);  /* https：握手完成（此时 TCP 早就建立了） */
    });
    req.setTimeout(FETCH_TIMEOUT * 1000, () => req.destroy(new Error('抓取超时')));
    req.on('error', e => { if (!done) reject(e); });
    req.end();
  });
}

async function fetchPublic(rawUrl) {
  let cur = String(rawUrl || '').trim();
  if (!cur) throw new Error('url 为空');
  const redirects = [];
  let prevScheme = null;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(cur);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只支持 http/https');
    /* 重定向只能平级或升级，不能降级：https → http 等于把后面的内容交给明文链路。 */
    if (prevScheme === 'https:' && u.protocol === 'http:') throw new Error('拒绝从 HTTPS 降级到 HTTP 的重定向');
    prevScheme = u.protocol;
    if (u.username || u.password) throw new Error('URL 不能带账号密码');
    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    if (port !== 80 && port !== 443) throw new Error('只允许 80/443 端口');
    const ips = await resolvePublic(u.hostname);
    let out = null, last = null;
    /* 多 A 记录时按解析顺序试，最多 3 个。全部来自上面那一次解析，
       任何一个都校验过，换 IP 重试不会把校验绕过去。 */
    for (const ip of ips.slice(0, 3)) {
      try { out = await requestOnce(cur, ip); break; }
      catch (e) { last = e; }
    }
    if (!out) throw new Error('抓取失败：' + ((last && last.message) || last));
    const resp = { status: out.status, headers: out.headers };
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.location;
      if (!loc) throw new Error('HTTP ' + resp.status + ' 但没给 Location');
      cur = new URL(loc, cur).toString();
      redirects.push(cur);
      continue;
    }
    const buf = out.body;
    const ct = resp.headers['content-type'] || '';
    const cs = (/charset=([\w-]+)/i.exec(ct) || [])[1] ||
      (/charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
    let text;
    try { text = new TextDecoder(cs).decode(buf); } catch (e) { text = new TextDecoder('utf-8').decode(buf); }
    return { status: resp.status, finalUrl: cur, contentType: ct, text, redirects };
  }
  throw new Error('重定向太多');
}

const LOCAL_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function originAllowed(origin) {
  if (!origin) return true;                       // 同源导航 / curl
  if (String(origin).trim().toLowerCase() === 'null') return false;
  try {
    const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    return LOCAL_NAMES.has(u.hostname);
  } catch (e) { return false; }
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  /* self 而不是空：沙箱自带录音机/定位，空值会让页内 getUserMedia 直接报
     Permissions policy violation（0.0.1.15 修）。第三方 iframe 仍然拿不到。 */
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self)');
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-HTerm-Provider, X-HTerm-Client');
  res.setHeader('Access-Control-Max-Age', '600');
}

function reply(req, res, status, obj, extra) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  cors(req, res);
  securityHeaders(res);
  /* 错误响应一律关连接：429/403/415 都发生在读 body 之前，请求体还躺在
     socket 里；keep-alive 复用时下一轮会把它当请求行解析，报一个莫名其妙的
     400。关掉连接，未读的字节跟着 socket 一起消失。 */
  if (status >= 400) res.setHeader('Connection', 'close');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': raw.length,
    'Cache-Control': 'no-store'
  }, extra || {}));
  res.end(raw);
}

/* 超限回 429。位置在鉴权之后、读 body 之前：未授权请求不白占额度，
   被拒的请求也不该让我们去读 8 MB 请求体。 */
function rateGate(bucket, label, req, res) {
  if (!bucket) return true;
  const wait = bucket.take();
  if (wait <= 0) return true;
  const retry = Math.max(1, Math.ceil(wait));
  if (bucket.rejected === 1 || bucket.rejected % 50 === 0) {
    process.stderr.write(`[${new Date().toTimeString().slice(0, 8)}] 429 ${label}（累计拒绝 ${bucket.rejected} 次，${bucket.rpm} 次/分）\n`);
  }
  reply(req, res, 429, {
    error: {
      message: `${label}过于频繁（上限 ${bucket.rpm} 次/分），请 ${retry} 秒后再试`,
      type: 'rate_limit_error',
      code: 'rate_limited'
    }
  }, {
    'Retry-After': String(retry),
    'X-RateLimit-Limit': String(bucket.rpm),
    'X-RateLimit-Remaining': '0'
  });
  return false;
}

function deny(req, res, reason, detail) {
  process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] deny ${reason}: ${detail}\n`);
  reply(req, res, 403, { error: { message: detail, type: 'forbidden' } });
  return false;
}

function localOnly(req, res) {
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', '::1'].includes(peer)) return deny(req, res, 'peer', '仅允许本机访问');
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return deny(req, res, 'host', 'Host 不被允许（只接受 127.0.0.1 / localhost）');
  const origin = req.headers.origin;
  if (!originAllowed(origin)) return deny(req, res, 'origin', 'Origin 不被允许（' + origin + '）');
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    return deny(req, res, 'fetch-site', '跨站请求被拒绝');
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!localOnly(req, res)) return;
  try {
    if (req.method === 'OPTIONS') {
      if (!req.headers.origin) {
        reply(req, res, 403, { error: { message: '预检必须带 Origin', type: 'forbidden' } });
        return;
      }
      cors(req, res);
      securityHeaders(res);
      res.writeHead(204, { 'Content-Length': 0 });
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const reqPath = String(req.url || '').split('?')[0];
      /* 根路径直接给页面：启动后端 = 启动应用，不用再开静态服务器 */
      if (reqPath === '/' || reqPath === '/index.html') {
        /* 发启动时读进内存的那一份：请求阶段不碰磁盘，路径上的东西再怎么换
           也影响不到已启动的实例（改文件要重启才生效）。 */
        const raw = INDEX_RAW;
        if (!raw) {
          reply(req, res, 404, { error: { message: '找不到 index.html（和本脚本放同一目录）', type: 'not_found' } });
          return;
        }
        /* 单文件应用七百多 KB，no-store 会让每次刷新都重下整包。
         * 改成协商缓存：内容没变回 304（只有头），改了才重发正文。 */
        const etag = INDEX_ETAG;
        securityHeaders(res);
        if (String(req.headers['if-none-match'] || '').split(',').map(x => x.trim()).includes(etag)) {
          res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': raw.length,
          'Cache-Control': 'no-cache',
          'ETag': etag
        });
        res.end(raw);
        return;
      }
      if (reqPath === '/health') {
        /* 只报「活着」。以前列 providers 明细，等于一份能力清单：
           关了哪个功能、有没有配 key，一问便知。前端只用 r.ok。 */
        reply(req, res, 200, { ok: true, service: 'hterminal-modelserver', version: VERSION });
        return;
      }
      /* 其他所有 GET 一律拒绝：不做文件服务器，也不列接口清单 */
      reply(req, res, 403, REJECTED);
      return;
    }
    const route = String(req.url || '').split('?')[0];
    /* 被 --no-chat / --no-fetch 关掉的接口，和瞎猜的路径走同一条分支：
       状态码、头、正文完全一致，探不出「这里本来有个接口」。 */
    if (req.method !== 'POST' || !ENABLED.includes(route)) {
      reply(req, res, 403, REJECTED);
      return;
    }
    /* 大小写不敏感：0.0.1.2 起客户端头值是 "HTerMinaL"，而这里一直小写全等比较，
     * 自家前端每次都被自己 403（0.0.1.15 修）。这个头只用来强制预检 + 自证同源页面。 */
    if (String(req.headers['x-hterm-client'] || '').trim().toLowerCase() !== 'hterminal') {
      reply(req, res, 403, { error: { message: '缺少或错误的 X-HTerm-Client', type: 'forbidden' } });
      return;
    }
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      /* 只收 application/json：text/plain / form-urlencoded 属于「不触发预检的简单请求」，
         一律挡掉。 */
      reply(req, res, 415, { error: { message: 'Content-Type 必须是 application/json', type: 'unsupported_media_type' } });
      return;
    }
    /* 两条通道分开算：抓网页是廉价代理，模型请求要花钱；
       共用一个桶，抓 100 条新闻就会把对话额度吃光。 */
    const isFetch = route === '/v1/fetch';
    if (!rateGate(isFetch ? fetchBucket : chatBucket, isFetch ? '抓网页请求' : '模型请求', req, res)) return;
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      reply(req, res, 400, { error: { message: 'JSON 解析失败：' + e.message, type: 'bad_request' } });
      return;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      /* 合法 JSON 不等于合法请求体：null / "x" / [] 都能通过 JSON.parse，
         后面 body.stream 会抛 TypeError，变成一句 500「服务器内部错误」。 */
      reply(req, res, 400, { error: { message: '请求体必须是 JSON 对象', type: 'bad_request' } });
      return;
    }
    if (route === '/v1/fetch') {
      try {
        reply(req, res, 200, await fetchPublic(body.url));
      } catch (e) {
        reply(req, res, 502, { error: { message: '抓取失败：' + e.message, type: 'fetch_failed' } });
      }
      return;
    }
    if (body.stream) {
      reply(req, res, 400, { error: { message: '本后端只支持非流式（stream:false）', type: 'bad_request' } });
      return;
    }
    const provider = String(req.headers['x-hterm-provider'] || body.provider || DEFAULT_PROVIDER).toLowerCase();
    const started = Date.now();
    let status, data;
    if (provider === 'openai' || provider === 'custom') [status, data] = await doOpenAI(body);
    else if (provider === 'anthropic') [status, data] = await doAnthropic(body);
    else if (provider === 'responses' || provider === 'response') [status, data] = await doResponses(body);
    else [status, data] = [400, { error: { message: '未知 provider：' + provider, type: 'bad_request' } }];
    reply(req, res, status, data);
    process.stderr.write(`[${new Date().toTimeString().slice(0, 8)}] POST /v1/chat/completions provider=${provider} status=${status} ${Date.now() - started}ms\n`);
  } catch (e) {
    if (!res.headersSent) reply(req, res, 500, { error: { message: '服务器内部错误：' + e.message, type: 'internal' } });
    else res.end();
  }
});

/* 连接边界（对齐 Python 版）：Node 默认 headersTimeout 60s、requestTimeout 300s，
 * 一个半开连接可以占住 5 分钟；maxConnections 默认无限。 */
server.headersTimeout = 15000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 15000;
server.maxConnections = 256;

server.listen(PORT, HOST, () => {
  console.log(`hterminal modelserver ${VERSION}`);
  console.log(`  listening  http://${HOST}:${PORT}`);
  console.log(`  features   ${[...ENABLED].sort().join(' · ')}`);
  console.log(`  index.html ${INDEX_RAW ? INDEX_RAW.length + ' B（启动时快照）' : '缺失（/ 会 404）'}`);
  console.log(`  sandbox    ${ARGS.noSandbox ? '已跳过（--unsafe-no-self-restrict）' : 'off 本实现未内置平台沙箱（Python 版提供 Landlock/seatbelt）'}`);
  console.log('  limits     headers 15s · request 60s · max 256 连接');
  const rateText = (path, bucket, rpm) =>
    !ENABLED.includes(path) ? 'closed' : (bucket ? `${rpm}/min burst ${BURST}` : 'off');
  console.log(`  rate       chat ${rateText('/v1/chat/completions', chatBucket, ARGS.rpm)} · fetch ${rateText('/v1/fetch', fetchBucket, ARGS.fetchRpm)}`);
  console.log(`  providers  openai=${OPENAI_KEY ? 'yes' : 'no'} anthropic=${ANTHROPIC_KEY ? 'yes' : 'no'} responses=${OPENAI_KEY ? 'yes' : 'no'}`);
  console.log('  密钥只在环境变量；不保存对话；不执行工具；不写文件。');
  console.log('  Ctrl-C 停止。');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用，用 HT_PORT 换一个。`);
  else console.error(e);
  process.exit(1);
});
