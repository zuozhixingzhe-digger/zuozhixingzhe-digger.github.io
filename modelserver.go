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
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "0.0.1.35"

var (
	port             = envInt("HT_PORT", 8787)
	openaiKey        = os.Getenv("OPENAI_API_KEY")
	openaiBase       = strings.TrimRight(envStr("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/")
	anthropicKey     = os.Getenv("ANTHROPIC_API_KEY")
	anthropicBase    = strings.TrimRight(envStr("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"), "/")
	anthropicVersion = envStr("ANTHROPIC_VERSION", "2023-06-01")
	// 模型与调用方式由服务端决定，前端说了不算（0.0.1.21）。
	// 前端仍按标准 OpenAI 格式发 model（格式要求），值会被覆盖；
	// 否则用户在页面上把 flash 改成 pro，账单就跟着变。
	serverModel    = envStr("HT_MODEL", "gpt-4o-mini")
	serverProvider = strings.ToLower(envStr("HT_PROVIDER", envStr("HT_DEFAULT_PROVIDER", "openai")))
	timeout        = time.Duration(envInt("HT_TIMEOUT", 120)) * time.Second
	maxBody        = int64(8 * 1024 * 1024)
	allowedHosts   = map[string]bool{
		fmt.Sprintf("127.0.0.1:%d", port): true,
		fmt.Sprintf("localhost:%d", port): true,
		fmt.Sprintf("[::1]:%d", port):     true,
	}
	client = &http.Client{Timeout: timeout}
)

/*
限流桶：nil = 该通道关闭（--rpm 0）。main 里 flag.Parse 之后才填，

	那时还没有连接进来，不存在并发写。
*/
var (
	chatBucket  *tokenBucket
	fetchBucket *tokenBucket
	/* 启用的路由白名单，main 里按 --no-chat / --no-fetch 填。
	   不在里面的路径——被关掉的或压根不存在的——都回同一个 403。 */
	/* 白名单在启动时构建成切片，之后只读；没有 map 可以被运行期写入。 */
	enabledRoutes []string
	/* index.html 的启动快照。请求阶段不碰磁盘：路径上的东西再怎么换，
	   也影响不到已经跑起来的实例（改文件要重启才生效）。 */
	indexRaw  []byte
	indexETag string
	/* file:// 页面的访问令牌。file:// 与「公网页面里的 <iframe sandbox>」
	   请求头逐字节相同（Origin: null / Sec-Fetch-Site: cross-site / 无 Referer），
	   放行 null 等于放行所有网站；唯一不可伪造的区别是知不知道该令牌。
	   只认 X-HTerm-Token 头，不认 query——query 会进日志和 Referer。 */
	fileOriginEnabled = true
	fileToken         string
)

/*
关闭的接口与「根本不存在的路径」回同一个东西：状态码、头、正文一致。

	绝不能回「该功能已关闭」——那等于承认这里本来有个接口。
*/
var rejectedBody = map[string]any{"error": map[string]any{"message": "请求不被接受", "type": "forbidden"}}

/*
令牌桶：按时间连续补令牌，不用「每分钟 N 次」的固定窗口——

	固定窗口在边界会放过两倍突发（59 秒 N 次 + 下一秒 N 次）。
	burst 留给正常用法：智能体一轮任务会连着调 3~8 次模型。
*/
type tokenBucket struct {
	mu       sync.Mutex
	rpm      int
	rate     float64
	burst    float64
	tokens   float64
	last     time.Time
	rejected int
}

func newTokenBucket(rpm, burst int) *tokenBucket {
	if rpm < 1 {
		rpm = 1
	}
	if burst < 1 {
		burst = 1
	}
	return &tokenBucket{
		rpm: rpm, rate: float64(rpm) / 60, burst: float64(burst),
		tokens: float64(burst), last: time.Now(),
	}
}

/*
取一个令牌：0 = 放行，否则是建议等待的秒数。失败不扣令牌。

	第二个返回值是累计拒绝次数，只用于日志。
*/
func (b *tokenBucket) take() (float64, int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.tokens = math.Min(b.burst, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return 0, b.rejected
	}
	b.rejected++
	return (1 - b.tokens) / b.rate, b.rejected
}

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
		log.Printf("[upstream] 编码请求失败：%v", err)
		return 500, map[string]any{"error": map[string]any{"message": "服务暂时不可用", "type": "internal"}}
	}
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("[upstream] 构造上游请求失败：%v", err)
		return 500, map[string]any{"error": map[string]any{"message": "服务暂时不可用", "type": "internal"}}
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[upstream] 连不上上游：%v", err)
		return 502, map[string]any{"error": map[string]any{"message": "连不上上游", "type": "upstream_unreachable"}}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		log.Printf("[upstream] 上游返回非 JSON（HTTP %d）", resp.StatusCode)
		return 502, map[string]any{"error": map[string]any{"message": "上游返回了非 JSON", "type": "bad_upstream"}}
	}
	return resp.StatusCode, data
}

/* ---------------------------------------------------------------- 响应最小化（0.0.1.22）
 * 零信任第 3 条：请求者只该拿到「这一问的答案」。上游那套 model / id / created /
 * object / usage / system_fingerprint 一个都不给，fromAnthropic / fromResponses
 * 自己造的 model / id / usage 也一并挡掉——统一在路由出口做白名单，不逐个函数删。
 */
var chatMessageFields = []string{"content", "reasoning_content", "tool_calls", "function_call", "refusal"}

func minimizeChat(status int, data map[string]any) map[string]any {
	if data == nil {
		return map[string]any{"error": map[string]any{"message": "上游响应异常"}}
	}
	if status >= 400 || data["error"] != nil {
		msg := ""
		switch e := data["error"].(type) {
		case map[string]any:
			msg = asStr(e["message"])
		case string:
			msg = e
		}
		if strings.TrimSpace(msg) == "" {
			msg = "上游请求失败"
		}
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		return map[string]any{"error": map[string]any{"message": msg}}
	}
	choices := []any{}
	for _, raw := range asSlice(data["choices"]) {
		c, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		m := asMap(c["message"])
		msg := map[string]any{"role": "assistant"}
		if role := asStr(m["role"]); role != "" {
			msg["role"] = role
		}
		for _, k := range chatMessageFields {
			if v, ok := m[k]; ok {
				msg[k] = v
			}
		}
		ch := map[string]any{"message": msg}
		if v, ok := c["index"]; ok {
			ch["index"] = v
		}
		if v, ok := c["finish_reason"]; ok {
			ch["finish_reason"] = v
		}
		choices = append(choices, ch)
	}
	return map[string]any{"choices": choices}
}

/* ---------------------------------------------------------------- OpenAI / custom */
/*
controlFields：请求体里「不属于 OpenAI 接口、但能改变上游行为」的字段。

前端（或本机任何脚本）可以往 body 里塞 base_url / api_key / headers；有些
聚合网关会认这些字段，用它们覆盖上游地址或鉴权头。后端已经从环境变量决定
用哪个上游、哪把钥匙，就不能让请求体把决定权拿回去。只剥这几个控制字段，
不做白名单——白名单会挡住上游以后加的新参数。
*/
// 不做白名单——白名单会挡住上游以后加的新参数。比对前归一化：
// Base_Url / API-KEY / apiKey 都得算同一个东西，否则换个大小写就钻过去了。
var controlFields = map[string]bool{
	"provider": true, "url": true,
	"base_url": true, "baseurl": true, "api_base": true, "apibase": true, "endpoint": true,
	"api_key": true, "apikey": true, "key": true, "authorization": true,
	"headers": true, "proxy": true,
}

func isControlField(k string) bool {
	return controlFields[strings.ToLower(strings.TrimSpace(strings.ReplaceAll(k, "-", "_")))]
}

func doOpenAI(body map[string]any) (int, map[string]any) {
	payload := map[string]any{}
	for k, v := range body {
		if isControlField(k) {
			continue
		}
		payload[k] = v
	}
	if asStr(payload["model"]) == "" {
		payload["model"] = serverModel
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
		"model":      serverModel,
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
		return status, map[string]any{"error": map[string]any{"message": msg, "type": "upstream_error"}}
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
		"model": serverModel,
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
		return status, map[string]any{"error": map[string]any{"message": msg, "type": "upstream_error"}}
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
 *   - "null"：file:// 页面，也是 sandbox iframe / data: 页面的 Origin。
 *     两者请求头一模一样，只能靠令牌区分——没有令牌就当它是后者，拒绝。
 *   - 其它：必须 http(s) 且 host 是本机名。端口不卡死（本地开发常换端口）。
 */
func originAllowed(origin string, tokenOK bool) bool {
	if origin == "" {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(origin), "null") {
		return fileOriginEnabled && tokenOK
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := u.Hostname()
	return h == "127.0.0.1" || h == "localhost" || h == "::1"
}

/* tokenOK：常量时间比较，别用响应时间把令牌一位一位试出来。 */
func tokenOK(r *http.Request) bool {
	if fileToken == "" {
		return false
	}
	got := r.Header.Get("X-HTerm-Token")
	return subtle.ConstantTimeCompare([]byte(got), []byte(fileToken)) == 1
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
	/* self：沙箱自带录音机/定位；空值会让页内 getUserMedia 直接报
	   Permissions policy violation（0.0.1.15 修）。 */
	w.Header().Set("Permissions-Policy", "geolocation=(self), microphone=(self), camera=(self)")
}

func cors(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	/* null 只是「让页面能读到响应体」，不构成授权——授权靠令牌。
	   否则令牌填错时，用户只会看到一条 CORS 报错，无从排错。 */
	isNull := strings.EqualFold(strings.TrimSpace(origin), "null")
	if origin != "" && (originAllowed(origin, tokenOK(r)) || (isNull && fileOriginEnabled)) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-HTerm-Provider, X-HTerm-Client, X-HTerm-Token")
	w.Header().Set("Access-Control-Max-Age", "600")
}

func reply(w http.ResponseWriter, r *http.Request, status int, obj any) {
	raw, _ := json.Marshal(obj)
	cors(w, r)
	securityHeaders(w)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	/* 错误响应一律关连接：429/403/415 都发生在读 body 之前，请求体还躺在
	   socket 里；keep-alive 复用时下一轮会把它当请求行解析，报一个莫名其妙的
	   400。关掉连接，未读的字节跟着 socket 一起消失。 */
	if status >= 400 {
		w.Header().Set("Connection", "close")
	}
	w.WriteHeader(status)
	w.Write(raw)
}

func deny(w http.ResponseWriter, r *http.Request, reason, detail string) bool {
	log.Printf("deny %s: %s", reason, detail)
	reply(w, r, 403, rejectedBody) /* 细节只进日志，不把防线画给探测者 */
	return false
}

/* localOnly：四重校验 —— socket 层 / Host / Origin / Sec-Fetch-Site。 */
func localOnly(w http.ResponseWriter, r *http.Request, preflight bool) bool {
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
	origin := r.Header.Get("Origin")
	/* preflight 只用于 OPTIONS：预检由浏览器发，带不了自定义头，这里无从验令牌，
	   先放行。预检没有副作用，真正拦人的是随后那条带令牌的请求。 */
	if !originAllowed(origin, tokenOK(r) || preflight) {
		if strings.EqualFold(strings.TrimSpace(origin), "null") {
			return deny(w, r, "origin", "本地文件页面需要访问令牌（见后端启动横幅）")
		}
		return deny(w, r, "origin", "Origin 不被允许（"+origin+"）")
	}
	/* Sec-Fetch-Site 是浏览器自己打的标，页面改不了：cross-site 一律拒。
	   file:// 页面的请求天然是 cross-site（不透明源），令牌已验过就放行。 */
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") &&
		!((strings.EqualFold(strings.TrimSpace(origin), "null") && tokenOK(r)) || preflight) {
		return deny(w, r, "fetch-site", "跨站请求被拒绝")
	}
	return true
}

/*
loadIndex：启动时把 index.html 读成一份快照。

	"先 open 拿到句柄、再 fstat 验它"，而不是"先看路径、再打开"：后者是两步，
	中间那个名字能被换掉。验的对象必须是即将要读的那个句柄。
	非普通文件（管道、设备、目录）一律不认。
*/
func loadIndex() ([]byte, string, error) {
	f, err := os.Open(filepath.Join(scriptDir(), "index.html"))
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return nil, "", fmt.Errorf("index.html 不是普通文件")
	}
	raw, err := io.ReadAll(f)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return raw, "\"" + hex.EncodeToString(sum[:])[:20] + "\"", nil
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

/*
超限回 429。位置在鉴权之后、读 body 之前：未授权请求不白占额度，

	被拒的请求也不该让我们去读 8 MB 请求体。
*/
func rateGate(w http.ResponseWriter, r *http.Request, b *tokenBucket, label string) bool {
	if b == nil {
		return true
	}
	wait, rejected := b.take()
	if wait <= 0 {
		return true
	}
	retry := int(math.Ceil(wait))
	if retry < 1 {
		retry = 1
	}
	if rejected == 1 || rejected%50 == 0 {
		log.Printf("429 %s（累计拒绝 %d 次，%d 次/分）", label, rejected, b.rpm)
	}
	w.Header().Set("Retry-After", strconv.Itoa(retry)) /* 上限是服务配置，不外泄 */
	reply(w, r, http.StatusTooManyRequests, map[string]any{
		"error": map[string]any{
			"message": fmt.Sprintf("%s过于频繁，请 %d 秒后再试", label, retry),
			"type":    "rate_limit_error",
			"code":    "rate_limited",
		},
	})
	return false
}

func handler(w http.ResponseWriter, r *http.Request) {
	if !localOnly(w, r, r.Method == http.MethodOptions) {
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
			raw := indexRaw
			if raw == nil {
				reply(w, r, 404, map[string]any{"error": map[string]any{"message": "页面不可用", "type": "not_found"}})
				return
			}
			/* 单文件应用七百多 KB；no-store 让每次刷新重下整包。
			 * 改协商缓存：没变回 304，变了才重发正文。 */
			etag := indexETag
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
			/* 只报「活着」。以前列 providers 明细，等于一份能力清单：
			   关了哪个功能、有没有配 key，一问便知。前端只用状态码。 */
			/* 零信任：只回「活着」。版本号 / 程序名 / 功能清单 / 真实模型名一律不给。 */
			reply(w, r, 200, map[string]any{"ok": true})
			return
		}
		/* 其他 GET 一律拒绝：不做文件服务器，也不列接口清单 */
		reply(w, r, 403, rejectedBody)
		return
	}
	route := r.URL.Path
	/* 被 --no-chat / --no-fetch 关掉的接口，和瞎猜的路径走同一条分支：
	   状态码、头、正文完全一致，探不出「这里本来有个接口」。 */
	if r.Method != http.MethodPost || !slices.Contains(enabledRoutes, route) {
		reply(w, r, 403, rejectedBody)
		return
	}
	/* 大小写不敏感：0.0.1.2 起客户端头值是 "HTerMinaL"，这里曾小写全等比较，
	   自家前端每次都被自己 403（0.0.1.15 修）。 */
	/* 重复头一律拒：Header.Get 只取第一个，而不同实现取第一个/最后一个/拼接，
	   这种差异正是头走私的土壤（自测 C15）。 */
	if vals := r.Header.Values("X-HTerm-Client"); len(vals) != 1 ||
		strings.ToLower(strings.TrimSpace(vals[0])) != "hterminal" {
		reply(w, r, 403, map[string]any{"error": map[string]any{"message": "缺少、重复或错误的 X-HTerm-Client", "type": "forbidden"}})
		return
	}
	/* 只收 application/json：text/plain、form-urlencoded 属于「不触发预检的简单请求」 */
	if ctype := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); ctype != "application/json" {
		reply(w, r, 415, map[string]any{"error": map[string]any{"message": "Content-Type 必须是 application/json", "type": "unsupported_media_type"}})
		return
	}
	/* 两条通道分开算：抓网页是廉价代理，模型请求要花钱；
	   共用一个桶，抓 100 条新闻就会把对话额度吃光。 */
	if route == "/v1/fetch" {
		if !rateGate(w, r, fetchBucket, "抓网页请求") {
			return
		}
	} else if !rateGate(w, r, chatBucket, "模型请求") {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || int64(len(raw)) > maxBody || len(raw) == 0 {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "请求体为空或过大", "type": "bad_request"}})
		return
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "JSON 解析失败", "type": "bad_request"}})
		return
	}
	/* `null` 能通过 Unmarshal，且 body 会是 nil map —— 后面读 key 不会 panic，
	   于是它会被当成「空请求」一路送到上游。三份后端行为要一致：400。 */
	if body == nil {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "请求体必须是 JSON 对象", "type": "bad_request"}})
		return
	}
	if route == "/v1/fetch" {
		data, err := fetchPublic(asStr(body["url"]))
		if err != nil {
			log.Printf("[fetch] 失败：%v", err)
			reply(w, r, 502, map[string]any{"error": map[string]any{"message": "抓取失败", "type": "fetch_failed"}})
			return
		}
		reply(w, r, 200, data)
		return
	}
	if body["stream"] == true {
		reply(w, r, 400, map[string]any{"error": map[string]any{"message": "本后端只支持非流式（stream:false）", "type": "bad_request"}})
		return
	}
	// 调用方式与模型只听服务端的：X-HTerm-Provider / body.provider 一律不看，
	// body.model 用服务端配置覆盖。老前端照发也能用，只是不起作用（0.0.1.21）。
	provider := serverProvider
	body["model"] = serverModel
	delete(body, "provider")
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
		log.Printf("[chat] provider 配置无效：%s", provider)
		status, data = 500, map[string]any{"error": map[string]any{"message": "服务暂时不可用", "type": "server_config_error"}}
	}
	reply(w, r, status, minimizeChat(status, data))
	log.Printf("POST /v1/chat/completions provider=%s status=%d %dms", provider, status, time.Since(started).Milliseconds())
}

/*
---------------------------------------------------------------- /v1/fetch

	浏览器 fetch 受同源策略管，新闻站一律不带 CORS 头；r.jina.ai / allorigins
	在国内又经常连不上。由本机进程代抓是唯一稳定的一条路。
	它不是任意代理：只允许 http/https、80/443，目标必须解析到公网 IP，逐跳校验。
*/
const fetchMax = 3 * 1024 * 1024

var fetchTimeout = time.Duration(envInt("HT_FETCH_TIMEOUT", 20)) * time.Second

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

/*
nonPublicNets：标准库判断不够用的那些段。

net.IP.IsGlobalUnicast() 只排除「不是单播」的地址，它把 100.64.0.0/10、
198.18.0.0/15、192.0.2.0/24 这些**保留段**都算成全球单播；IsPrivate() 又只管
RFC 1918 与 fc00::/7，管不到它们。Python 的 ipaddress.is_global 按 IANA 特殊
用途注册表逐段判，JS 版也有一张显式表——只有 Go 版在这里漏了，三份对不上。

100.64.0.0/10 最要紧：RFC 6598 的运营商级 NAT 段，Tailscale / ZeroTier 这类
虚拟局域网默认就拿它当内网地址。漏掉它，装了 Tailscale 的机器上 /v1/fetch
就能被诱导去读整个虚拟内网（NAS、路由器、同事的机器），响应原样带回前端——
这正是「局域网越权」在单机服务上最常见的一种形态。
*/
var nonPublicNets = func() []*net.IPNet {
	var out []*net.IPNet
	for _, s := range []string{
		"100.64.0.0/10",   // RFC 6598 CGNAT / Tailscale / ZeroTier
		"192.0.0.0/24",    // IETF 协议分配
		"192.0.2.0/24",    // TEST-NET-1
		"192.88.99.0/24",  // 6to4 中继（已废弃）
		"198.18.0.0/15",   // 基准测试
		"198.51.100.0/24", // TEST-NET-2
		"203.0.113.0/24",  // TEST-NET-3
		"2001:db8::/32",   // 文档
		"2001::/32",       // Teredo（内嵌 IPv4）
		"2001:2::/48",     // 基准测试
		"2001:10::/28",    // ORCHID
		"64:ff9b::/96",    // NAT64（内嵌 IPv4 可能是内网）
		"100::/64",        // 丢弃前缀
		"5f00::/8",        // SRv6 SID
	} {
		if _, n, err := net.ParseCIDR(s); err == nil {
			out = append(out, n)
		}
	}
	return out
}()

func ipPublic(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return false
	}
	// IPv4-mapped（::ffff:1.2.3.4）先摊平成 IPv4 再查表，
	// 否则 100.64/10 这种只写在 v4 表里的段会被漏过去。
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, n := range nonPublicNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

/*
解析一次，返回「全部是公网」的 IP 列表，供调用方钉住。

	任一 A/AAAA 落在私网就整体拒绝——多记录轮询是绕 IP 校验的常见手法。
*/
func resolvePublic(host string) ([]string, error) {
	host = strings.ToLower(strings.Trim(host, "[]"))
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return nil, fmt.Errorf("目标不是公网地址：%s", host)
	}
	if ip := net.ParseIP(host); ip != nil {
		if !ipPublic(ip) {
			return nil, fmt.Errorf("目标不是公网地址：%s", host)
		}
		return []string{ip.String()}, nil
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("域名解析失败：%s", host)
	}
	out := make([]string, 0, len(ips))
	seen := map[string]bool{}
	for _, ip := range ips {
		if !ipPublic(ip) {
			return nil, fmt.Errorf("目标不是公网地址：%s", host)
		}
		s := ip.String()
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out, nil
}

/* 对钉死的 IP 发一次 GET，不跟随重定向。
 *
 * DialContext 把地址换掉：URL 里还是域名（Host 头、TLS SNI、证书校验都按域名来），
 * 但 socket 只知道这颗已经校验过的 IP，域名不会被查第二次。
 * 不钉的话：校验(host) → 1.2.3.4 放行，连接时 Transport 再解析 → 127.0.0.1，
 * 中间几毫秒换个答案，前面所有校验白做（DNS rebinding）。
 *
 * Proxy 显式置 nil：http.DefaultTransport 会走 HTTP_PROXY/HTTPS_PROXY，
 * 而代理会自己解析域名 —— 钉 IP 等于白钉。 */
func fetchOnce(cur, ip string) (*http.Response, error) {
	pinned := ip
	tr := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(addr)
			if err != nil {
				port = "80"
			}
			d := &net.Dialer{Timeout: 10 * time.Second}
			conn, err := d.DialContext(ctx, network, net.JoinHostPort(pinned, port))
			if err != nil {
				return nil, err
			}
			/* 连上后核对对端：RemoteAddr() 是内核给的事实，不是 DNS 的预测。
			   解析结果可能被缓存、被代理改写、被下一次查询覆盖；这个不会。
			   不合格就把连接关掉，绝不交给 Transport。 */
			host, _, e := net.SplitHostPort(conn.RemoteAddr().String())
			if e != nil || !ipPublic(net.ParseIP(host)) {
				conn.Close()
				return nil, fmt.Errorf("对端不是公网地址（连接后被拒）")
			}
			return conn, nil
		},
		DisableKeepAlives: true,
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   fetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse /* 自己处理，才能逐跳校验 */
		},
	}
	req, _ := http.NewRequest(http.MethodGet, cur, nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6")
	return client.Do(req)
}

/*
标准库只有 UTF-8：GB18030/GBK 这类没有解码表，只能原样返回并在 charset 里标注。

	今日头条、新浪这两个新闻源都是 UTF-8；真遇到 GBK 站点，用 Python 版后端更准。
*/
func decodeBody(ct string, buf []byte) (string, string) {
	cs := ""
	if mt, params, err := mime.ParseMediaType(ct); err == nil {
		_ = mt
		cs = strings.ToLower(params["charset"])
	}
	if cs == "" {
		head := strings.ToLower(string(buf[:min(len(buf), 4096)]))
		if i := strings.Index(head, "charset="); i >= 0 {
			rest := head[i+8:]
			rest = strings.TrimLeft(rest, "\"' ")
			j := 0
			for j < len(rest) && (rest[j] == '-' || rest[j] == '_' || (rest[j] >= '0' && rest[j] <= '9') || (rest[j] >= 'a' && rest[j] <= 'z')) {
				j++
			}
			cs = rest[:j]
		}
	}
	if cs == "utf8" {
		cs = "utf-8"
	}
	return string(buf), cs
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func fetchPublic(rawURL string) (map[string]any, error) {
	cur := strings.TrimSpace(rawURL)
	if cur == "" {
		return nil, fmt.Errorf("url 为空")
	}
	redirects := []string{}
	prevScheme := ""
	for hop := 0; hop < 5; hop++ {
		u, err := url.Parse(cur)
		if err != nil {
			return nil, fmt.Errorf("URL 解析失败：%v", err)
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return nil, fmt.Errorf("只支持 http/https")
		}
		/* 重定向只能平级或升级，不能降级：https → http 等于把后面的内容交给明文链路。 */
		if prevScheme == "https" && u.Scheme == "http" {
			return nil, fmt.Errorf("拒绝从 HTTPS 降级到 HTTP 的重定向")
		}
		prevScheme = u.Scheme
		if u.User != nil {
			return nil, fmt.Errorf("URL 不能带账号密码")
		}
		port := u.Port()
		if port == "" {
			if u.Scheme == "https" {
				port = "443"
			} else {
				port = "80"
			}
		}
		if port != "80" && port != "443" {
			return nil, fmt.Errorf("只允许 80/443 端口")
		}
		ips, err := resolvePublic(u.Hostname())
		if err != nil {
			return nil, err
		}
		var resp *http.Response
		var lastErr error
		/* 多 A 记录时按解析顺序试，最多 3 个。全部来自上面那一次解析，
		   任何一个都校验过，换 IP 重试不会把校验绕过去。 */
		for i, ip := range ips {
			if i >= 3 {
				break
			}
			resp, err = fetchOnce(cur, ip)
			if err == nil {
				break
			}
			lastErr = err
		}
		if resp == nil {
			return nil, fmt.Errorf("抓取失败：%v", lastErr)
		}
		if resp.StatusCode == 301 || resp.StatusCode == 302 || resp.StatusCode == 303 || resp.StatusCode == 307 || resp.StatusCode == 308 {
			loc := resp.Header.Get("Location")
			resp.Body.Close()
			if loc == "" {
				return nil, fmt.Errorf("HTTP %d 但没给 Location", resp.StatusCode)
			}
			next, err := u.Parse(loc)
			if err != nil {
				return nil, err
			}
			cur = next.String()
			redirects = append(redirects, cur)
			continue
		}
		buf, _ := io.ReadAll(io.LimitReader(resp.Body, fetchMax+1))
		resp.Body.Close()
		if len(buf) > fetchMax {
			buf = buf[:fetchMax]
		}
		ct := resp.Header.Get("Content-Type")
		text, cs := decodeBody(ct, buf)
		return map[string]any{
			"status":      resp.StatusCode,
			"finalUrl":    cur,
			"contentType": ct,
			"charset":     cs,
			"text":        text,
			"redirects":   redirects,
		}, nil
	}
	return nil, fmt.Errorf("重定向太多")
}

func main() {
	rpm := flag.Int("rpm", envInt("HT_RPM", 60), "模型请求每分钟上限，0 关闭限流")
	burst := flag.Int("burst", envInt("HT_BURST", 20), "允许的瞬时突发次数")
	fetchRpm := flag.Int("fetch-rpm", envInt("HT_FETCH_RPM", 120), "抓网页每分钟上限，0 关闭")
	noChat := flag.Bool("no-chat", false, "关闭模型请求（/v1/chat/completions）")
	noFetch := flag.Bool("no-fetch", false, "关闭网页抓取（/v1/fetch）")
	fileTokenFlag := flag.String("file-token", envStr("HT_FILE_TOKEN", ""),
		"file:// 页面用的访问令牌；默认每次启动随机生成（打印在横幅里）")
	noFileOrigin := flag.Bool("no-file-origin", false, "不接受 file:// 打开的页面（Origin: null 一律拒）")
	modelFlag := flag.String("model", serverModel, "固定模型名；前端传的 model 会被忽略")
	providerFlag := flag.String("provider", serverProvider, "固定调用方式；前端传的 provider 会被忽略")
	/* 与 Python 版同名同义。Go 版没有内置平台沙箱（见 README §13.6），
	   这个开关保留是为了三份后端命令行一致，脚本不用为它们写分支。 */
	noSandbox := flag.Bool("unsafe-no-self-restrict", false,
		"跳过平台自沙箱（本实现未内置，保留参数以保持三份后端命令行一致）")
	flag.Parse()
	_ = noSandbox
	// 命令行 > 环境变量 > 内置默认。改完立刻生效于所有请求；前端无从置喙。
	serverModel = strings.TrimSpace(*modelFlag)
	serverProvider = strings.ToLower(strings.TrimSpace(*providerFlag))
	if serverModel == "" {
		log.Fatal("--model 不能为空")
	}

	fileOriginEnabled = !*noFileOrigin
	if fileOriginEnabled {
		fileToken = strings.TrimSpace(*fileTokenFlag)
		if fileToken == "" {
			// 每次启动换一把。重启后要重新粘一次——这是有意的：
			// 固定令牌迟早会被写进脚本、截图、聊天记录里。
			buf := make([]byte, 18)
			if _, err := rand.Read(buf); err != nil {
				log.Fatalf("生成访问令牌失败：%v", err)
			}
			fileToken = base64.RawURLEncoding.EncodeToString(buf)
		} else if len(fileToken) < 12 {
			log.Fatal("--file-token 太短（至少 12 字符），会被轻易猜中")
		}
	}

	/* 功能注册表。将来加接口只在这里加一行，全关判定与路由白名单自动跟着变。 */
	features := []struct {
		path, label string
		off         bool
	}{
		{"/v1/chat/completions", "模型请求", *noChat},
		{"/v1/fetch", "网页抓取", *noFetch},
	}
	var enabledPaths, allLabels []string
	for _, f := range features {
		allLabels = append(allLabels, f.label)
		if !f.off {
			enabledRoutes = append(enabledRoutes, f.path)
			enabledPaths = append(enabledPaths, f.path)
		}
	}
	if len(enabledRoutes) == 0 {
		/* 全关 = 没有可提供的服务。监听一个只回 403 的端口本身就是情报。 */
		fmt.Fprintf(os.Stderr, "所有功能都被关闭了（%s），没有可提供的服务，拒绝启动\n",
			strings.Join(allLabels, "、"))
		os.Exit(2)
	}
	sort.Strings(enabledPaths)

	/* 只在启动时读一次。之后请求阶段不碰磁盘。 */
	if raw, etag, err := loadIndex(); err == nil {
		indexRaw, indexETag = raw, etag
	}

	if *rpm > 0 {
		chatBucket = newTokenBucket(*rpm, *burst)
	}
	if *fetchRpm > 0 {
		fetchBucket = newTokenBucket(*fetchRpm, *burst)
	}
	rateText := func(path string, on bool, n int) string {
		if !slices.Contains(enabledRoutes, path) {
			return "closed"
		}
		if !on {
			return "off"
		}
		return fmt.Sprintf("%d/min burst %d", n, *burst)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           http.HandlerFunc(handler),
		ReadHeaderTimeout: 10 * time.Second,
		/* IdleTimeout 不设会用 ReadTimeout（0 = 永不超时），keep-alive 连接
		   可以一直挂着；MaxHeaderBytes 默认 1MB，本地服务用不到这么大。 */
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 64 << 10,
	}
	log.SetOutput(os.Stderr)
	fmt.Printf("hterminal modelserver %s\n", version)
	fmt.Printf("  listening  http://%s\n", addr)
	fmt.Printf("  features   %s\n", strings.Join(enabledPaths, " · "))
	fmt.Printf("  model      %s / %s（前端传的 model、provider 会被忽略）\n", serverProvider, serverModel)
	fmt.Printf("  sandbox    off 本实现未内置平台沙箱（Python 版提供 Landlock/seatbelt）\n")
	if indexRaw != nil {
		fmt.Printf("  index.html %d B（启动时快照）\n", len(indexRaw))
	} else {
		fmt.Printf("  index.html 缺失（/ 会 404）\n")
	}
	if fileOriginEnabled {
		fmt.Printf("  file://    %s\n", fileToken)
		fmt.Printf("             ↑ 双击 index.html 打开时，把它粘进页面顶部的提示条；重启会换\n")
	} else {
		fmt.Printf("  file://    已关闭（Origin: null 一律拒）\n")
	}
	fmt.Printf("  rate       chat %s · fetch %s\n",
		rateText("/v1/chat/completions", *rpm > 0, *rpm),
		rateText("/v1/fetch", *fetchRpm > 0, *fetchRpm))
	fmt.Printf("  providers  openai=%v anthropic=%v responses=%v\n", openaiKey != "", anthropicKey != "", openaiKey != "")
	fmt.Println("  密钥只在环境变量；不保存对话；不执行工具；不写文件。")
	fmt.Println("  Ctrl-C 停止。")
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
