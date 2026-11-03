// hterminal modelserver — 无状态 Chat Completions 转发（Go / 标准库）
// SPDX-License-Identifier: Apache-2.0 OR MIT
// 由 AI 智能体生成并维护。
//
// 与 modelserver.py / modelserver.js 逻辑同步。只监听 127.0.0.1，只做格式转换与转发。
// 不保存对话、不读文件、不执行工具、不写日志文件。密钥只在环境变量里。
//
// 环境变量：HT_PORT / OPENAI_API_KEY / OPENAI_BASE_URL /
//
//	ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / HT_MODEL / HT_TIMEOUT / HT_DEFAULT_PROVIDER
//
// 构建：go build -o modelserver modelserver.go
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const version = "0.0.1.10"

var (
	port             = envInt("HT_PORT", 8787)
	openaiKey        = os.Getenv("OPENAI_API_KEY")
	openaiBase       = strings.TrimRight(envStr("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/")
	anthropicKey     = os.Getenv("ANTHROPIC_API_KEY")
	anthropicBase    = strings.TrimRight(envStr("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"), "/")
	anthropicVersion = envStr("ANTHROPIC_VERSION", "2023-06-01")
	defaultModel     = envStr("HT_MODEL", "gpt-4o-mini")
	defaultProvider  = strings.ToLower(envStr("HT_DEFAULT_PROVIDER", "openai"))
	timeout          = time.Duration(envInt("HT_TIMEOUT", 120)) * time.Second
	maxBody          = int64(8 * 1024 * 1024)
	allowedHosts     = map[string]bool{
		fmt.Sprintf("127.0.0.1:%d", port): true,
		fmt.Sprintf("localhost:%d", port): true,
		fmt.Sprintf("[::1]:%d", port):     true,
	}
	client = &http.Client{Timeout: timeout}
)

func envStr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func asSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func asInt(v any, def int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return def
}

func asStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// textOf 处理 OpenAI content 的字符串或 [{type:text,text:...}] 形式。
func textOf(v any) string {
	switch c := v.(type) {
	case string:
		return c
	case []any:
		parts := []string{}
		for _, p := range c {
			pm := asMap(p)
			t := asStr(pm["type"])
			if t == "text" || t == "input_text" || t == "output_text" {
				parts = append(parts, asStr(pm["text"]))
			} else if s, ok := p.(string); ok {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, "\n")
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func joinURL(base, path string) string {
	base = strings.TrimRight(base, "/")
	if strings.HasSuffix(base, path) {
		return base
	}
	return base + path
}

func upstream(rawURL string, payload any, headers map[string]string) (int, map[string]any) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 500, map[string]any{"error": map[string]any{"message": "编码请求失败：" + err.Error(), "type": "internal"}}
	}
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return 500, map[string]any{"error": map[string]any{"message": "构造上游请求失败：" + err.Error(), "type": "internal"}}
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 502, map[string]any{"error": map[string]any{"message": "连不上上游：" + err.Error(), "type": "upstream_unreachable"}}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return 502, map[string]any{"error": map[string]any{"message": fmt.Sprintf("上游返回了非 JSON（HTTP %d）", resp.StatusCode), "type": "bad_upstream"}}
	}
	return resp.StatusCode, data
}

/* ---------------------------------------------------------------- OpenAI / custom */
func doOpenAI(body map[string]any) (int, map[string]any) {
	payload := map[string]any{}
	for k, v := range body {
		payload[k] = v
	}
	delete(payload, "provider")
	if asStr(payload["model"]) == "" {
		payload["model"] = defaultModel
	}
	headers := map[string]string{"Content-Type": "application/json"}
	if openaiKey != "" {
		headers["Authorization"] = "Bearer " + openaiKey
	}
	return upstream(joinURL(openaiBase, "/chat/completions"), payload, headers)
}

/* ---------------------------------------------------------------- Anthropic */
func toAnthropic(body map[string]any) map[string]any {
	system := []string{}
	msgs := []any{}
	for _, raw := range asSlice(body["messages"]) {
		m := asMap(raw)
		role := asStr(m["role"])
		content := m["content"]
		switch role {
		case "system":
			system = append(system, textOf(content))
		case "user":
			msgs = append(msgs, map[string]any{"role": "user", "content": textOf(content)})
		case "assistant":
			blocks := []any{}
			if textOf(content) != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": textOf(content)})
			}
			for _, tcRaw := range asSlice(m["tool_calls"]) {
				tc := asMap(tcRaw)
				fn := asMap(tc["function"])
				var input any = map[string]any{}
				if err := json.Unmarshal([]byte(asStr(fn["arguments"])), &input); err != nil {
					input = map[string]any{}
				}
				id := asStr(tc["id"])
				if id == "" {
					id = fmt.Sprintf("call_%d", time.Now().UnixNano())
				}
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": id, "name": asStr(fn["name"]), "input": input})
			}
			if len(blocks) == 0 {
				blocks = append(blocks, map[string]any{"type": "text", "text": ""})
			}
			msgs = append(msgs, map[string]any{"role": "assistant", "content": blocks})
		case "tool":
			block := map[string]any{"type": "tool_result", "tool_use_id": asStr(m["tool_call_id"]), "content": textOf(content)}
			if len(msgs) > 0 {
				last := asMap(msgs[len(msgs)-1])
				if asStr(last["role"]) == "user" && last["_toolbatch"] == true {
					last["content"] = append(asSlice(last["content"]), block)
					continue
				}
			}
			msgs = append(msgs, map[string]any{"role": "user", "content": []any{block}, "_toolbatch": true})
		}
	}
	for _, raw := range msgs {
		delete(asMap(raw), "_toolbatch")
	}

	payload := map[string]any{
		"model":      firstNonEmpty(asStr(body["model"]), defaultModel),
		"max_tokens": asInt(firstNonNil(body["max_tokens"], body["max_completion_tokens"]), 4096),
		"messages":   msgs,
	}
	if len(system) > 0 {
		payload["system"] = strings.Join(system, "\n\n")
	}
	if body["temperature"] != nil {
		payload["temperature"] = body["temperature"]
	}
	if body["top_p"] != nil {
		payload["top_p"] = body["top_p"]
	}
	if body["stop"] != nil {
		if arr, ok := body["stop"].([]any); ok {
			payload["stop_sequences"] = arr
		} else {
			payload["stop_sequences"] = []any{body["stop"]}
		}
	}

	tools := []any{}
	for _, tRaw := range asSlice(body["tools"]) {
		t := asMap(tRaw)
		if asStr(t["type"]) != "function" {
			continue
		}
		fn := asMap(t["function"])
		schema := fn["parameters"]
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		tools = append(tools, map[string]any{
			"name":         asStr(fn["name"]),
			"description":  asStr(fn["description"]),
			"input_schema": schema,
		})
	}
	if len(tools) > 0 {
		payload["tools"] = tools
		tc := body["tool_choice"]
		switch v := tc.(type) {
		case string:
			if v == "auto" {
				payload["tool_choice"] = map[string]any{"type": "auto"}
			} else if v == "required" {
				payload["tool_choice"] = map[string]any{"type": "any"}
			}
		case map[string]any:
			if asStr(v["type"]) == "function" {
				fn := asMap(v["function"])
				payload["tool_choice"] = map[string]any{"type": "tool", "name": asStr(fn["name"])}
			}
		}
	}
	return payload
}

func fromAnthropic(data map[string]any, model string) map[string]any {
	text := []string{}
	calls := []any{}
	for _, bRaw := range asSlice(data["content"]) {
		b := asMap(bRaw)
		switch asStr(b["type"]) {
		case "text":
			text = append(text, asStr(b["text"]))
		case "tool_use":
			args, _ := json.Marshal(b["input"])
			id := asStr(b["id"])
			if id == "" {
				id = fmt.Sprintf("call_%d", time.Now().UnixNano())
			}
			calls = append(calls, map[string]any{
				"id": id, "type": "function",
				"function": map[string]any{"name": asStr(b["name"]), "arguments": string(args)},
			})
		}
	}
	msg := map[string]any{"role": "assistant", "content": strings.Join(text, "")}
	if len(calls) > 0 {
		msg["tool_calls"] = calls
	}
	reason := map[string]string{"end_turn": "stop", "tool_use": "tool_calls", "max_tokens": "length", "stop_sequence": "stop"}[asStr(data["stop_reason"])]
	if reason == "" {
		reason = "stop"
	}
	u := asMap(data["usage"])
	in := asInt(u["input_tokens"], 0)
	out := asInt(u["output_tokens"], 0)
	modelOut := asStr(data["model"])
	if modelOut == "" {
		modelOut = model
	}
	return map[string]any{
		"id":      firstNonEmpty(asStr(data["id"]), fmt.Sprintf("chatcmpl-%d", time.Now().UnixNano())),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   modelOut,
		"choices": []any{map[string]any{"index": 0, "message": msg, "finish_reason": reason}},
		"usage":   map[string]any{"prompt_tokens": in, "completion_tokens": out, "total_tokens": in + out},
	}
}

func doAnthropic(body map[string]any) (int, map[string]any) {
	payload := toAnthropic(body)
	headers := map[string]string{"Content-Type": "application/json", "anthropic-version": anthropicVersion}
	if anthropicKey != "" {
		headers["x-api-key"] = anthropicKey
	}
	status, data := upstream(joinURL(anthropicBase, "/messages"), payload, headers)
	if status >= 400 {
		msg := "上游错误"
		if e := asMap(data["error"]); asStr(e["message"]) != "" {
			msg = asStr(e["message"])
		}
		return status, map[string]any{"error": map[string]any{"message": msg, "type": "upstream_error", "provider": "anthropic"}}
	}
	return 200, fromAnthropic(data, asStr(payload["model"]))
}

/* ---------------------------------------------------------------- OpenAI Responses */
func toResponses(body map[string]any) map[string]any {
	instructions := []string{}
	items := []any{}
	for _, raw := range asSlice(body["messages"]) {
		m := asMap(raw)
		role := asStr(m["role"])
		content := textOf(m["content"])
		switch role {
		case "system":
			instructions = append(instructions, content)
		case "user":
			items = append(items, map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": content}}})
		case "assistant":
			if content != "" {
				items = append(items, map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": content}}})
			}
			for _, tcRaw := range asSlice(m["tool_calls"]) {
				tc := asMap(tcRaw)
				fn := asMap(tc["function"])
				items = append(items, map[string]any{
					"type": "function_call", "call_id": asStr(tc["id"]),
					"name": asStr(fn["name"]), "arguments": firstNonEmpty(asStr(fn["arguments"]), "{}"),
				})
			}
		case "tool":
			items = append(items, map[string]any{"type": "function_call_output", "call_id": asStr(m["tool_call_id"]), "output": content})
		}
	}
	payload := map[string]any{
		"model": firstNonEmpty(asStr(body["model"]), defaultModel),
		"input": items,
	}
	if len(instructions) > 0 {
		payload["instructions"] = strings.Join(instructions, "\n\n")
	}
	if body["max_tokens"] != nil || body["max_output_tokens"] != nil {
		payload["max_output_tokens"] = asInt(firstNonNil(body["max_tokens"], body["max_output_tokens"]), 4096)
	}
	if body["temperature"] != nil {
		payload["temperature"] = body["temperature"]
	}
	if body["top_p"] != nil {
		payload["top_p"] = body["top_p"]
	}
	tools := []any{}
	for _, tRaw := range asSlice(body["tools"]) {
		t := asMap(tRaw)
		if asStr(t["type"]) != "function" {
			continue
		}
		fn := asMap(t["function"])
		schema := fn["parameters"]
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		tools = append(tools, map[string]any{
			"type": "function", "name": asStr(fn["name"]),
			"description": asStr(fn["description"]), "parameters": schema,
		})
	}
	if len(tools) > 0 {
		payload["tools"] = tools
		switch v := body["tool_choice"].(type) {
		case string:
			payload["tool_choice"] = v
		case map[string]any:
			if asStr(v["type"]) == "function" {
				payload["tool_choice"] = map[string]any{"type": "function", "name": asStr(asMap(v["function"])["name"])}
			}
		}
	}
	return payload
}

func fromResponses(data map[string]any, model string) map[string]any {
	text := []string{}
	calls := []any{}
	for _, itemRaw := range asSlice(data["output"]) {
		item := asMap(itemRaw)
		switch asStr(item["type"]) {
		case "message":
			for _, cRaw := range asSlice(item["content"]) {
				c := asMap(cRaw)
				if asStr(c["type"]) == "output_text" {
					text = append(text, asStr(c["text"]))
				}
			}
		case "function_call":
			id := firstNonEmpty(asStr(item["call_id"]), asStr(item["id"]))
			if id == "" {
				id = fmt.Sprintf("call_%d", time.Now().UnixNano())
			}
			calls = append(calls, map[string]any{
				"id": id, "type": "function",
				"function": map[string]any{"name": asStr(item["name"]), "arguments": firstNonEmpty(asStr(item["arguments"]), "{}")},
			})
		}
	}
	msg := map[string]any{"role": "assistant", "content": strings.Join(text, "")}
	if len(calls) > 0 {
		msg["tool_calls"] = calls
	}
	finish := "stop"
	if len(calls) > 0 {
		finish = "tool_calls"
	} else if asStr(data["status"]) == "incomplete" {
		finish = "length"
	}
	u := asMap(data["usage"])
	in := asInt(u["input_tokens"], 0)
	out := asInt(u["output_tokens"], 0)
	total := asInt(u["total_tokens"], in+out)
	modelOut := asStr(data["model"])
	if modelOut == "" {
		modelOut = model
	}
	return map[string]any{
		"id":      firstNonEmpty(asStr(data["id"]), fmt.Sprintf("chatcmpl-%d", time.Now().UnixNano())),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   modelOut,
		"choices": []any{map[string]any{"index": 0, "message": msg, "finish_reason": finish}},
		"usage":   map[string]any{"prompt_tokens": in, "completion_tokens": out, "total_tokens": total},
	}
}

func doResponses(body map[string]any) (int, map[string]any) {
	payload := toResponses(body)
	headers := map[string]string{"Content-Type": "application/json"}
	if openaiKey != "" {
		headers["Authorization"] = "Bearer " + openaiKey
	}
	status, data := upstream(joinURL(openaiBase, "/responses"), payload, headers)
	if status >= 400 {
		msg := "上游错误"
		if e := asMap(data["error"]); asStr(e["message"]) != "" {
			msg = asStr(e["message"])
		}
		return status, map[string]any{"error": map[string]any{"message": msg, "type": "upstream_error", "provider": "responses"}}
	}
	return 200, fromResponses(data, asStr(payload["model"]))
}

/* ---------------------------------------------------------------- HTTP */
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstNonNil(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

/* originAllowed：只认本机页面。
 *
 *   - 空（同源导航 / curl）：允许
 *   - "null"：拒绝。sandbox iframe / data: 页面的 Origin 就是 null，
 *     放过它等于任何网站都能用 <iframe sandbox srcdoc="fetch(...)"> 打本地端口。
 *   - 其它：必须 http(s) 且 host 是本机名。端口不卡死（本地开发常换端口）。
 */
func originAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(origin), "null") {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := u.Hostname()
	return h == "127.0.0.1" || h == "localhost" || h == "::1"
}

/* securityHeaders：每个响应都带。X-Frame-Options / frame-ancestors 是重点，
 * 不让任何页面把本服务套进 iframe（点击劫持 + 借道读响应）。 */
func securityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
}

func cors(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" && originAllowed(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-HTerm-Provider, X-HTerm-Client")
	w.Header().Set("Access-Control-Max-Age", "600")
}

func reply(w http.ResponseWriter, r *http.Request, status int, obj any) {
	raw, _ := json.Marshal(obj)
	cors(w, r)
	securityHeaders(w)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(raw)
}

func deny(w http.ResponseWriter, r *http.Request, reason, detail string) bool {
	log.Printf("deny %s: %s", reason, detail)
	reply(w, r, 403, map[string]any{"error": map[string]any{"message": detail, "type": "forbidden"}})
	return false
}

/* localOnly：四重校验 —— socket 层 / Host / Origin / Sec-Fetch-Site。 */
func localOnly(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return deny(w, r, "peer", "仅允许本机访问")
	}
	if !allowedHosts[r.Host] {
		return deny(w, r, "host", "Host 不被允许（只接受 127.0.0.1 / localhost）")
	}
	if !originAllowed(r.Header.Get("Origin")) {
		return deny(w, r, "origin", "Origin 不被允许（"+r.Header.Get("Origin")+"）")
	}
	/* Sec-Fetch-Site 是浏览器自己打的标，页面改不了：cross-site 一律拒。 */
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		return deny(w, r, "fetch-site", "跨站请求被拒绝")
	}
	return true
}


/* scriptDir：可执行文件所在目录。go run 时是临时目录，所以优先用可执行文件路径；
 * 找不到就退回当前工作目录——两种情况都能覆盖「把 index.html 放在旁边」的用法。 */
func scriptDir() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "."
}

func handler(w http.ResponseWriter, r *http.Request) {
	if !localOnly(w, r) {
		return
	}
	if r.Method == http.MethodOptions {
		if r.Header.Get("Origin") == "" {
			reply(w, r, 403, map[string]any{"error": map[string]any{"message": "预检必须带 Origin", "type": "forbidden"}})
			return
		}
		cors(w, r)
		securityHeaders(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method == http.MethodGet {
		/* 根路径直接返回页面：启动后端就等于启动应用 */
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			raw, err := os.ReadFile(filepath.Join(scriptDir(), "index.html"))
			if err != nil {
				reply(w, r, 404, map[string]any{"error": map[string]any{"message": "找不到 index.html（和本脚本放同一目录）", "type": "not_found"}})
				return
			}
			/* 单文件应用七百多 KB；no-store 让每次刷新重下整包。
			 * 改协商缓存：没变回 304，变了才重发正文。 */
			sum := sha256.Sum256(raw)
			etag := "\"" + hex.EncodeToString(sum[:])[:20] + "\""
			securityHeaders(w)
			if strings.Contains(r.Header.Get("If-None-Match"), etag) {
				w.Header().Set("ETag", etag)
				w.Header().Set("Cache-Control", "no-cache")
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("ETag", etag)
			w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
			w.WriteHeader(http.StatusOK)
			w.Write(raw)
			return
		}
		if r.URL.Path == "/health" {
			reply(w, r, 200, map[string]any{
				"ok": true, "service": "hterminal-modelserver", "version": version,
				"default_provider": defaultProvider,
				"providers": map[string]any{
					"openai": openaiKey != "", "anthropic": anthropicKey != "",
					"responses": openaiKey != "", "custom": openaiKey != "",
				},
			})
			return
		}
		/* 其他 GET 一律拒绝：不做文件服务器 */
		reply(w, r, 403, map[string]any{"error": map[string]any{"message": "本服务只提供 index.html、/health 与 /v1/chat/completions", "type": "forbidden"}})
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
		reply(w, r, 403, map[string]any{"error": map[string]any{"message": "只接受 POST /v1/chat/completions", "type": "forbidden"}})
		return
	}
	if r.Header.Get("X-HTerm-Client") != "hterminal" {
		reply(w, r, 403, map[string]any{"error": map[string]any{"message": "缺少 X-HTerm-Client", "type": "forbidden"}})
		return
	}
	/* 只收 application/json：text/plain、form-urlencoded 属于「不触发预检的简单请求」 */
	if ctype := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); ctype != "application/json" {
		reply(w, r, 415, map[string]any{"error": map[string]any{"message": "Content-Type 必须是 application/json", "type": "unsupported_media_type"}})
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || int64(len(raw)) > maxBody || len(raw) == 0 {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "请求体为空或过大", "type": "bad_request"}})
		return
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "JSON 解析失败：" + err.Error(), "type": "bad_request"}})
		return
	}
	if body["stream"] == true {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "本后端只支持非流式（stream:false）", "type": "bad_request"}})
		return
	}
	provider := strings.ToLower(firstNonEmpty(r.Header.Get("X-HTerm-Provider"), asStr(body["provider"]), defaultProvider))
	started := time.Now()
	var status int
	var data map[string]any
	switch provider {
	case "openai", "custom":
		status, data = doOpenAI(body)
	case "anthropic":
		status, data = doAnthropic(body)
	case "responses", "response":
		status, data = doResponses(body)
	default:
		status, data = 400, map[string]any{"error": map[string]any{"message": "未知 provider：" + provider, "type": "bad_request"}}
	}
	reply(w, r, status, data)
	log.Printf("POST /v1/chat/completions provider=%s status=%d %dms", provider, status, time.Since(started).Milliseconds())
}

func main() {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           http.HandlerFunc(handler),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.SetOutput(os.Stderr)
	fmt.Printf("hterminal modelserver %s\n", version)
	fmt.Printf("  listening  http://%s\n", addr)
	fmt.Printf("  providers  openai=%v anthropic=%v responses=%v\n", openaiKey != "", anthropicKey != "", openaiKey != "")
	fmt.Println("  密钥只在环境变量；不保存对话；不执行工具；不写文件。")
	fmt.Println("  Ctrl-C 停止。")
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
