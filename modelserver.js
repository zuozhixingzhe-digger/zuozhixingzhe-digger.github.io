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
 *           ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / HT_MODEL / HT_TIMEOUT / HT_DEFAULT_PROVIDER
 * 需要 Node.js 18+（内置 fetch）。
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const nodePath = require('node:path');

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
const VERSION = '0.0.1.14';
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

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
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
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

function reply(req, res, status, obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  cors(req, res);
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': raw.length,
    'Cache-Control': 'no-store'
  });
  res.end(raw);
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
        let raw;
        try { raw = fs.readFileSync(nodePath.join(__dirname, 'index.html')); }
        catch (e) {
          reply(req, res, 404, { error: { message: '找不到 index.html（和本脚本放同一目录）', type: 'not_found' } });
          return;
        }
        /* 单文件应用七百多 KB，no-store 会让每次刷新都重下整包。
         * 改成协商缓存：内容没变回 304（只有头），改了才重发正文。 */
        const etag = '"' + require('crypto').createHash('sha256').update(raw).digest('hex').slice(0, 20) + '"';
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
        reply(req, res, 200, {
          ok: true,
          service: 'hterminal-modelserver',
          version: VERSION,
          default_provider: DEFAULT_PROVIDER,
          providers: {
            openai: !!OPENAI_KEY,
            anthropic: !!ANTHROPIC_KEY,
            responses: !!OPENAI_KEY,
            custom: !!OPENAI_KEY
          }
        });
        return;
      }
      /* 其他所有 GET 一律拒绝：不做文件服务器，避免本机网页借端口读磁盘 */
      reply(req, res, 403, { error: { message: '本服务只提供 index.html、/health 与 /v1/chat/completions', type: 'forbidden' } });
      return;
    }
    if (req.method !== 'POST' || String(req.url || '').split('?')[0] !== '/v1/chat/completions') {
      reply(req, res, 403, { error: { message: '只接受 POST /v1/chat/completions', type: 'forbidden' } });
      return;
    }
    if (req.headers['x-hterm-client'] !== 'hterminal') {
      reply(req, res, 403, { error: { message: '缺少 X-HTerm-Client', type: 'forbidden' } });
      return;
    }
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      /* 只收 application/json：text/plain / form-urlencoded 属于「不触发预检的简单请求」，
         一律挡掉。 */
      reply(req, res, 415, { error: { message: 'Content-Type 必须是 application/json', type: 'unsupported_media_type' } });
      return;
    }
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      reply(req, res, 400, { error: { message: 'JSON 解析失败：' + e.message, type: 'bad_request' } });
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

server.listen(PORT, HOST, () => {
  console.log(`hterminal modelserver ${VERSION}`);
  console.log(`  listening  http://${HOST}:${PORT}`);
  console.log(`  providers  openai=${OPENAI_KEY ? 'yes' : 'no'} anthropic=${ANTHROPIC_KEY ? 'yes' : 'no'} responses=${OPENAI_KEY ? 'yes' : 'no'}`);
  console.log('  密钥只在环境变量；不保存对话；不执行工具；不写文件。');
  console.log('  Ctrl-C 停止。');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用，用 HT_PORT 换一个。`);
  else console.error(e);
  process.exit(1);
});
