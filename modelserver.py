#!/usr/bin/env python3
# hterminal modelserver — 无状态 Chat Completions 转发（Python / 标准库）
# SPDX-License-Identifier: Apache-2.0 OR MIT
# 由 AI 智能体生成并维护。
#
# 它只做四件事：监听 127.0.0.1、校验请求确实来自本机浏览器、把前端发来的
# Chat Completions 请求翻译成上游格式、把上游响应翻译回 Chat Completions。
# 不保存对话、不读文件、不执行工具、不写日志文件。密钥只在环境变量里。
#
# 环境变量：
#   HT_PORT=8787                 监听端口
#   OPENAI_API_KEY=...           OpenAI / 兼容服务密钥
#   OPENAI_BASE_URL=...          默认 https://api.openai.com/v1
#   ANTHROPIC_API_KEY=...        Anthropic 密钥
#   ANTHROPIC_BASE_URL=...       默认 https://api.anthropic.com/v1
#   HT_MODEL=gpt-4o-mini         请求未带 model 时的兜底
#   HT_TIMEOUT=120               上游超时秒数
#   HT_DEFAULT_PROVIDER=openai   openai | anthropic | responses | custom

import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("HT_PORT", "8787"))
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1").rstrip("/")
ANTHROPIC_VERSION = os.environ.get("ANTHROPIC_VERSION", "2023-06-01")
DEFAULT_MODEL = os.environ.get("HT_MODEL", "gpt-4o-mini")
DEFAULT_PROVIDER = os.environ.get("HT_DEFAULT_PROVIDER", "openai").lower()
TIMEOUT = float(os.environ.get("HT_TIMEOUT", "120"))
MAX_BODY = 8 * 1024 * 1024
VERSION = "0.0.1.4"
# 脚本所在目录：index.html 会从这里读
ROOT = os.path.dirname(os.path.abspath(__file__))


def text_of(content):
    """OpenAI content 可能是字符串，也可能是 [{type:text,text:...}]。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("text", "input_text", "output_text"):
                out.append(str(part.get("text", "")))
            elif isinstance(part, str):
                out.append(part)
        return "\n".join(out)
    if content is None:
        return ""
    return str(content)


def join_url(base, path):
    base = base.rstrip("/")
    if base.endswith(path):
        return base
    return base + path


def upstream(url, payload, headers):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except Exception as e:
        return 502, {"error": {"message": "连不上上游：%s" % e, "type": "upstream_unreachable"}}
    try:
        return status, json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return 502, {"error": {"message": "上游返回了非 JSON（HTTP %s）" % status, "type": "bad_upstream"}}


# ------------------------------------------------------------------ OpenAI / custom
def do_openai(body, base, key):
    url = join_url(base, "/chat/completions")
    payload = dict(body)
    payload.pop("provider", None)
    if not payload.get("model"):
        payload["model"] = DEFAULT_MODEL
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    return upstream(url, payload, headers)


# ------------------------------------------------------------------ Anthropic
def to_anthropic(body):
    system = []
    msgs = []
    for m in body.get("messages", []):
        role = m.get("role")
        content = m.get("content")
        if role == "system":
            system.append(text_of(content))
        elif role == "user":
            msgs.append({"role": "user", "content": text_of(content)})
        elif role == "assistant":
            blocks = []
            if text_of(content):
                blocks.append({"type": "text", "text": text_of(content)})
            for tc in (m.get("tool_calls") or []):
                fn = tc.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                blocks.append({"type": "tool_use", "id": tc.get("id") or "call_%d" % int(time.time() * 1000),
                               "name": fn.get("name", ""), "input": args})
            if not blocks:
                blocks = [{"type": "text", "text": ""}]
            msgs.append({"role": "assistant", "content": blocks})
        elif role == "tool":
            block = {"type": "tool_result", "tool_use_id": m.get("tool_call_id") or "",
                     "content": text_of(content)}
            last = msgs[-1] if msgs else None
            if last and last.get("role") == "user" and last.pop("_toolbatch", False):
                last["content"].append(block)
                last["_toolbatch"] = True
            else:
                msgs.append({"role": "user", "content": [block], "_toolbatch": True})
    for m in msgs:
        m.pop("_toolbatch", None)

    payload = {
        "model": body.get("model") or DEFAULT_MODEL,
        "max_tokens": int(body.get("max_tokens") or body.get("max_completion_tokens") or 4096),
        "messages": msgs,
    }
    if system:
        payload["system"] = "\n\n".join(system)
    if body.get("temperature") is not None:
        payload["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        payload["top_p"] = body["top_p"]
    if body.get("stop") is not None:
        payload["stop_sequences"] = body["stop"] if isinstance(body["stop"], list) else [body["stop"]]

    tools = []
    for t in body.get("tools", []) or []:
        if t.get("type") != "function":
            continue
        fn = t.get("function") or {}
        tools.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    if tools:
        payload["tools"] = tools
        tc = body.get("tool_choice")
        if tc == "auto":
            payload["tool_choice"] = {"type": "auto"}
        elif tc == "required":
            payload["tool_choice"] = {"type": "any"}
        elif isinstance(tc, dict) and tc.get("type") == "function":
            payload["tool_choice"] = {"type": "tool", "name": (tc.get("function") or {}).get("name", "")}
    return payload


def from_anthropic(data, model):
    text = []
    calls = []
    for b in data.get("content", []) or []:
        if b.get("type") == "text":
            text.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            calls.append({
                "id": b.get("id") or "call_%d" % int(time.time() * 1000),
                "type": "function",
                "function": {"name": b.get("name", ""),
                             "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False)},
            })
    msg = {"role": "assistant", "content": "".join(text)}
    if calls:
        msg["tool_calls"] = calls
    reason = {"end_turn": "stop", "tool_use": "tool_calls", "max_tokens": "length",
              "stop_sequence": "stop"}.get(data.get("stop_reason"), "stop")
    u = data.get("usage") or {}
    return {
        "id": data.get("id") or "chatcmpl-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": data.get("model") or model,
        "choices": [{"index": 0, "message": msg, "finish_reason": reason}],
        "usage": {
            "prompt_tokens": u.get("input_tokens", 0),
            "completion_tokens": u.get("output_tokens", 0),
            "total_tokens": u.get("input_tokens", 0) + u.get("output_tokens", 0),
        },
    }


def do_anthropic(body):
    payload = to_anthropic(body)
    headers = {"Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION}
    if ANTHROPIC_KEY:
        headers["x-api-key"] = ANTHROPIC_KEY
    status, data = upstream(join_url(ANTHROPIC_BASE, "/messages"), payload, headers)
    if status >= 400:
        err = data.get("error") if isinstance(data, dict) else None
        msg = err.get("message") if isinstance(err, dict) else json.dumps(data, ensure_ascii=False)[:400]
        return status, {"error": {"message": msg or "上游错误", "type": "upstream_error", "provider": "anthropic"}}
    return 200, from_anthropic(data, payload["model"])


# ------------------------------------------------------------------ OpenAI Responses
def to_responses(body):
    instructions = []
    items = []
    for m in body.get("messages", []):
        role = m.get("role")
        content = text_of(m.get("content"))
        if role == "system":
            instructions.append(content)
        elif role == "user":
            items.append({"role": "user", "content": [{"type": "input_text", "text": content}]})
        elif role == "assistant":
            if content:
                items.append({"role": "assistant", "content": [{"type": "output_text", "text": content}]})
            for tc in (m.get("tool_calls") or []):
                fn = tc.get("function") or {}
                items.append({"type": "function_call", "call_id": tc.get("id") or "",
                              "name": fn.get("name", ""), "arguments": fn.get("arguments") or "{}"})
        elif role == "tool":
            items.append({"type": "function_call_output", "call_id": m.get("tool_call_id") or "",
                          "output": content})

    payload = {
        "model": body.get("model") or DEFAULT_MODEL,
        "input": items,
    }
    if instructions:
        payload["instructions"] = "\n\n".join(instructions)
    if body.get("max_tokens") or body.get("max_output_tokens"):
        payload["max_output_tokens"] = int(body.get("max_tokens") or body.get("max_output_tokens"))
    if body.get("temperature") is not None:
        payload["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        payload["top_p"] = body["top_p"]

    tools = []
    for t in body.get("tools", []) or []:
        if t.get("type") != "function":
            continue
        fn = t.get("function") or {}
        tools.append({"type": "function", "name": fn.get("name", ""),
                      "description": fn.get("description", ""),
                      "parameters": fn.get("parameters") or {"type": "object", "properties": {}}})
    if tools:
        payload["tools"] = tools
        tc = body.get("tool_choice")
        if isinstance(tc, str):
            payload["tool_choice"] = tc
        elif isinstance(tc, dict) and tc.get("type") == "function":
            payload["tool_choice"] = {"type": "function", "name": (tc.get("function") or {}).get("name", "")}
    return payload


def from_responses(data, model):
    text = []
    calls = []
    for item in data.get("output", []) or []:
        if item.get("type") == "message":
            for c in item.get("content", []) or []:
                if c.get("type") == "output_text":
                    text.append(c.get("text", ""))
        elif item.get("type") == "function_call":
            calls.append({
                "id": item.get("call_id") or item.get("id") or "call_%d" % int(time.time() * 1000),
                "type": "function",
                "function": {"name": item.get("name", ""),
                             "arguments": item.get("arguments") or "{}"},
            })
    msg = {"role": "assistant", "content": "".join(text)}
    if calls:
        msg["tool_calls"] = calls
    finish = "tool_calls" if calls else ("length" if data.get("status") == "incomplete" else "stop")
    u = data.get("usage") or {}
    return {
        "id": data.get("id") or "chatcmpl-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": data.get("model") or model,
        "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
        "usage": {
            "prompt_tokens": u.get("input_tokens", 0),
            "completion_tokens": u.get("output_tokens", 0),
            "total_tokens": u.get("total_tokens", u.get("input_tokens", 0) + u.get("output_tokens", 0)),
        },
    }


def do_responses(body):
    payload = to_responses(body)
    headers = {"Content-Type": "application/json"}
    if OPENAI_KEY:
        headers["Authorization"] = "Bearer " + OPENAI_KEY
    status, data = upstream(join_url(OPENAI_BASE, "/responses"), payload, headers)
    if status >= 400:
        err = data.get("error") if isinstance(data, dict) else None
        msg = err.get("message") if isinstance(err, dict) else json.dumps(data, ensure_ascii=False)[:400]
        return status, {"error": {"message": msg or "上游错误", "type": "upstream_error", "provider": "responses"}}
    return 200, from_responses(data, payload["model"])


# ------------------------------------------------------------------ HTTP
# 安全边界（三条，缺一不可）：
#   1. socket 层只绑 127.0.0.1，外面进不来
#   2. Host 头必须是本机名，挡 DNS rebinding（evil.com 解析到 127.0.0.1 也没用）
#   3. Origin / Sec-Fetch-Site 必须是「本机页面」，挡任意公网网页借浏览器打本地端口
ALLOWED_HOSTS = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT, "[::1]:%d" % PORT}
LOCAL_NAMES = ("127.0.0.1", "localhost", "::1")


def origin_allowed(origin):
    """Origin 只认本机页面。

    - 缺省（同源导航、curl、服务端调用）：允许
    - "null"：**拒绝**。sandbox iframe / data: 页面的 Origin 就是 null，
      不拒的话任何网站都能用 `<iframe sandbox srcdoc="fetch('http://127.0.0.1:8787')">`
      绕过同源策略打本地服务。
    - 其它：必须是 http(s) 且 host 是本机名。端口不卡死（本地开发常换端口），
      但公网域名一律不认。
    """
    if not origin:
        return True
    if origin.strip().lower() == "null":
        return False
    try:
        from urllib.parse import urlparse
        u = urlparse(origin)
        if u.scheme not in ("http", "https"):
            return False
        return (u.hostname or "").lower() in LOCAL_NAMES
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hterminal-modelserver/" + VERSION

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), (fmt % args)))

    def security_headers(self):
        """每个响应都带。X-Frame-Options / frame-ancestors 是重点：
        不让任何页面把本服务套进 iframe（点击劫持 + 借道读响应）。"""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

    def cors(self):
        """只对「已经通过 Origin 校验」的请求回 CORS 头，绝不回显任意 Origin，
        也绝不发 Allow-Credentials。"""
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-HTerm-Provider, X-HTerm-Client")
        self.send_header("Access-Control-Max-Age", "600")

    def reply(self, status, obj, extra=None):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.security_headers()
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _deny(self, reason, detail):
        sys.stderr.write("[%s] deny %s: %s\n" % (time.strftime("%H:%M:%S"), reason, detail))
        self.reply(403, {"error": {"message": detail, "type": "forbidden"}})
        return False

    def local_only(self):
        """四重校验：socket 层 / Host / Origin / Sec-Fetch-Site。"""
        peer = self.client_address[0]
        if peer not in ("127.0.0.1", "::1"):
            return self._deny("peer", "仅允许本机访问")
        host = self.headers.get("Host", "")
        if host not in ALLOWED_HOSTS:
            return self._deny("host", "Host 不被允许（只接受 127.0.0.1 / localhost）")
        origin = self.headers.get("Origin")
        if not origin_allowed(origin):
            return self._deny("origin", "Origin 不被允许（%s）" % origin)
        # Sec-Fetch-Site 是浏览器自己打的标，页面改不了：
        # cross-site 一律拒绝，等于把「公网网页 → 本地端口」这条路彻底堵死。
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        if site == "cross-site":
            return self._deny("fetch-site", "跨站请求被拒绝")
        return True

    def do_OPTIONS(self):
        if not self.local_only():
            return
        if not self.headers.get("Origin"):
            self.reply(403, {"error": {"message": "预检必须带 Origin", "type": "forbidden"}})
            return
        self.send_response(204)
        self.cors()
        self.security_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_index(self):
        """把同目录的 index.html 原样返回。
        这样「傻瓜式」：启动后端，浏览器打开 http://127.0.0.1:8787/ 就是应用本体，
        不需要再另开一个静态服务器。"""
        path = os.path.join(ROOT, "index.html")
        try:
            with open(path, "rb") as f:
                raw = f.read()
        except Exception:
            self.reply(404, {"error": {"message": "找不到 index.html（把它和本脚本放在同一目录）", "type": "not_found"}})
            return
        self.send_response(200)
        self.security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def deny(self):
        # 只放行页面、健康检查、补全接口。其余一律拒绝——不做文件服务器，
        # 免得本机任何一个网页都能借这个端口读你的磁盘。
        self.reply(403, {"error": {"message": "本服务只提供 index.html 与 /health、/v1/chat/completions", "type": "forbidden"}})

    def do_GET(self):
        if not self.local_only():
            return
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self.serve_index()
            return
        if path == "/health":
            self.reply(200, {
                "ok": True,
                "service": "hterminal-modelserver",
                "version": VERSION,
                "default_provider": DEFAULT_PROVIDER,
                "providers": {
                    "openai": bool(OPENAI_KEY),
                    "anthropic": bool(ANTHROPIC_KEY),
                    "responses": bool(OPENAI_KEY),
                    "custom": bool(OPENAI_KEY),
                },
            })
            return
        self.deny()

    def do_POST(self):
        if not self.local_only():
            return
        if self.path.split("?")[0] != "/v1/chat/completions":
            self.reply(403, {"error": {"message": "只接受 POST /v1/chat/completions", "type": "forbidden"}})
            return
        if self.headers.get("X-HTerm-Client", "") != "hterminal":
            self.reply(403, {"error": {"message": "缺少 X-HTerm-Client", "type": "forbidden"}})
            return
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            # 只收 application/json：挡住 text/plain、form-urlencoded 这类
            # 「不触发预检就能发出去」的简单请求。
            self.reply(415, {"error": {"message": "Content-Type 必须是 application/json", "type": "unsupported_media_type"}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except Exception:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.reply(400, {"error": {"message": "请求体为空或过大", "type": "bad_request"}})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8", "replace"))
        except Exception as e:
            self.reply(400, {"error": {"message": "JSON 解析失败：%s" % e, "type": "bad_request"}})
            return
        if body.get("stream"):
            self.reply(400, {"error": {"message": "本后端只支持非流式（stream:false）", "type": "bad_request"}})
            return

        provider = (self.headers.get("X-HTerm-Provider") or body.get("provider") or DEFAULT_PROVIDER).lower()
        started = time.time()
        try:
            if provider in ("openai", "custom"):
                status, data = do_openai(body, OPENAI_BASE, OPENAI_KEY)
            elif provider == "anthropic":
                status, data = do_anthropic(body)
            elif provider in ("responses", "response"):
                status, data = do_responses(body)
            else:
                status, data = 400, {"error": {"message": "未知 provider：%s" % provider, "type": "bad_request"}}
        except Exception as e:
            status, data = 500, {"error": {"message": "服务器内部错误：%s" % e, "type": "internal"}}
        self.reply(status, data)
        sys.stderr.write("[%s] POST /v1/chat/completions provider=%s status=%s %.0fms\n"
                         % (time.strftime("%H:%M:%S"), provider, status, (time.time() - started) * 1000))


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    print("hterminal modelserver %s" % VERSION)
    print("  listening  http://%s:%d" % (HOST, PORT))
    print("  providers  openai=%s anthropic=%s responses=%s" % (
        "yes" if OPENAI_KEY else "no", "yes" if ANTHROPIC_KEY else "no", "yes" if OPENAI_KEY else "no"))
    print("  密钥只在环境变量；不保存对话；不执行工具；不写文件。")
    print("  Ctrl-C 停止。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", file=sys.stderr)
        srv.server_close()


if __name__ == "__main__":
    main()
