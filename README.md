# hterminal

> 在浏览器里运行的 JS 终端 —— 一切皆文件，桌面就是终端，窗口是线程。

`hterminal` 是一个**完全自包含的单文件网页**（`index.html`，约 200 KB，无构建依赖、无外链脚本、可直接双击打开）。
它把 xterm.js 当作前端渲染层，把浏览器的 JS 引擎（跑在 Web Worker 里）当作内核，
再往上长出一套 Unix 味道的文件系统、窗口管理器和 AI 智能体宿主。

```text
._.  hterminal v0.1.0
    JSHeL · 一切皆文件 · 桌面即终端

.home > 1 + 1
2
.home > ls('.home')
welcome        notes.md       .bin.add
.home > exec('.bin.add', 2, 3)
5
```

---

## 目录

- [三十秒上手](#三十秒上手)
- [快捷键](#快捷键)
- [JSHeL 速查](#jshel-速查)
- [文件系统](#文件系统)
- [一切皆文件](#一切皆文件)
- [窗口与线程](#窗口与线程)
- [Python 环境](#python-环境)
- [包管理器](#包管理器)
- [挂在 window 上的标准函数](#挂在-window-上的标准函数)
- [AI 智能体](#ai-智能体)
- [后端 modelserver](#后端-modelserver)
- [架构与代码地图](#架构与代码地图)
- [构建](#构建)
- [设计取舍与踩坑记录](#设计取舍与踩坑记录)
- [借鉴声明](#借鉴声明)
- [许可证](#许可证)
- [AI 生成内容声明](#ai-生成内容声明)

---

## 三十秒上手

1. 下载本仓库的 `index.html`，用**现代浏览器**（Chrome / Edge / Safari 16+ / Firefox 115+）打开。
   也可以是 `python3 -m http.server` 起个静态服务再访问——两种都行，没有后端也能跑全部功能。
2. 等启动进度条走完（首次会从 CDN 拉 xterm.js，之后走缓存）。
3. 直接敲 JS：`1 + 1`、`document.title`、`await fetch('/')`。
4. 敲 `help` 看命令表，敲 `ls('.home')` 看家目录，敲 `winOpen({type:'browser'})` 开个窗口。
5. 想让它说话：填一个后端（见[后端](#后端-modelserver)），按 `Ctrl+Shift+A` 开智能体。

> **数据在哪**：所有文件都在浏览器 IndexedDB 里（库名 `hterm-fs`）。
> 换浏览器、换设备、清缓存就没了——所以请定期在「更多 → 数据 → 导出文件系统」里备份成 JSON。

清空一切：终端里敲 `nuke()`，或「更多 → 数据 → 清除全部数据」。

---

## 快捷键

设计原则：**凡是 Ctrl / Alt 组合都尽量抢过来**（终端和输入框的原生编辑键除外），F1–F12 与 Win 键一律放行。

| 组合 | 作用 |
| --- | --- |
| `Ctrl+Shift+T` | 新开一个终端窗口（和底层终端一模一样） |
| `Ctrl+Shift+B` | 新开浏览器窗口 |
| `Ctrl+Shift+A` | 打开智能体 |
| `Ctrl+Shift+F` | 打开文件管理器 |
| `Ctrl+Shift+E` | 打开编辑器 |
| `Ctrl+Shift+P` | 打开 Python 窗口 |
| `Ctrl+Shift+W` | 关闭当前窗口 |
| `Ctrl+Shift+M` | 当前窗口最大化 / 还原 |
| `Ctrl+Shift+D` | 所有窗口最小化（露出桌面＝终端） |
| `Ctrl+,` | 打开 / 关闭「更多」抽屉 |
| `Esc` | 关闭抽屉 / 弹窗 |

终端内部的语义键保持不抢：`Ctrl+C`（取消当前行）、`Ctrl+D`（退出）、`Ctrl+L`（清屏）、`Ctrl+A/E/U/K/W/Z/R`。
输入框里的 `Ctrl+A/C/V/X/Z/Y` 也不抢。开发者工具留门：`Ctrl+Shift+I/J/C`、`F12`。

**底层终端只有一个**。它如果因为任何原因终止（`exit()`、`Ctrl+D`、Worker 异常），
会自动 `history.back()` 回到上一级页面；没有可回退的历史就 `location.reload()` 刷新整个页面。
换句话说：终端死了 = 这个「操作系统」关机了。

---

## JSHeL 速查

JSHeL = **JS HTML shell**。它不是一个语法，就是一个 REPL：**你敲的每一行都是 JavaScript**，
只不过一批常用操作被预置成了同名函数，所以看起来像 shell。

```js
1 + 1                       // 表达式：回显结果
const x = await ls('.home') // 声明：提升到全局，后续可用
help                        // 裸命令名自动调用（白名单内）
```

| 分类 | 命令 |
| --- | --- |
| 文件 | `ls(p)` `ll(p)` `cd(p)` `pwd()` `cat(p)` `write(p, data)` `mkdir(p)` `rm(p,{r})` `mv(a,b)` `cp(a,b)` `stat(p)` `tree(p)` `find(pat)` `grep(pat)` `head(p,n)` `tail(p,n)` `du(p)` `df()` `mount()` |
| 执行 | `exec(p, ...args)` `open(p)` `run(code)` `require('pkg')` `python()` `exit()` |
| 窗口 | `winOpen({type,title,url,code})` `spawn(code)` `winList()` `winClose(id)` `agentOpen()` |
| 系统 | `saveFile(name, body)` `askFile()` `fetchText(url)` `openUrl(url)` `notify(msg)` `perm(name)` `ps()` `kill(pid)` `clear()` `history()` |

几个容易误解的点：

- **`write` 不返回值**（像 shell 的 `>`）。想要文件对象请用 `fs.write` 或 `await write(...)` 之外的 `stat`。
- **`pwd()` 只返回路径**，由 REPL 负责回显，不会打印两遍。
- **`exec` 执行的是「可执行文件」**：`.bin` 里的 content 被编译成 `AsyncFunction`，`args` 是实参数组。
- **`rm` 默认不递归**，删目录要 `rm(p, {r:true})`。
- **多行**：行尾反斜杠续行；粘贴多行文本会被识别成一次提交（括号粘贴协议）。

---

## 文件系统

致敬 ext4 的目录树，但**路径分隔符是 `.` 而不是 `/`**。

```text
.                          根
├── .home                  家目录（默认 cwd）
├── .bin                   可执行文件（函数）
├── .app                   应用
├── .dev                   设备（tty / null / zero / random / time / console）
├── .proc                  进程（每个 Worker 是一个条目）
├── .pkg                   已安装的包
├── .config                配置
├── .agent                 智能体会话
├── .sys                   系统信息
├── .perm                  权限申请单
├── .temp                  临时变量（内存态，刷新即失）
├── .queryfile             向用户要文件（阻塞式）
└── .localstorage          localStorage 的镜像
```

**目录尽量扁平**：所有一级目录都挂在根下，不做深层嵌套。这是刻意的——用 `.` 当分隔符之后，
深层路径读起来像域名，越长越难认；扁平结构让 `ls('.')` 一眼看全。

### 命名规则

文件名必须满足「改造过的编程语言标识符」：

- 允许：各语言文字（`\p{L}`，中英日俄……都行）、数字、下划线 `_`、短横线 `-`
- 首字符必须是**字母**（含中文等），不能是数字、不能是 `_` / `-`
- 不允许空格和任何其他符号（`.` 是分隔符，自然也不行）
- 长度 1–64
- **不区分大小写**（统一转小写存储，`README` 与 `readme` 是同一个文件）

正则只有一行：

```js
const SEG_RE = /^[\p{L}][\p{L}\p{N}_-]{0,63}$/u;
```

违规名字会被 `sanitizeName()` 清洗（比如拖进来的文件），或者直接报错：

```text
名称必须以字母或中文开头，且只能包含字母、数字、下划线、短横线（> 2024report）
```

### 存储三层

| 层 | 位置 | 用途 |
| --- | --- | --- |
| 内存索引 | `FS.idx`（Map） | 每次操作的快速判定 |
| 索引快照 | `localStorage['ht.fs.index']` | 冷启动时先恢复索引，避免全表扫描 |
| 真身 | IndexedDB `hterm-fs` / store `files` | 文件正文、mtime、kind、meta |

`.temp` 是**例外**：它只活在内存里，页面刷新就没了，专门放临时变量和中间结果。

### 导出 / 导入

`更多 → 数据 → 导出文件系统` 会打包出一个 JSON（含目录结构与所有文件正文），
`导入` 则整体替换。`导出 localStorage 镜像` 单独把 `.localstorage` 那层导出成键值对。

---

## 一切皆文件

这是整个项目的核心脑洞：**能抽象成「有路径、可读、可执行」的东西，就都做成文件。**

| 文件 | 是什么 | 怎么用 |
| --- | --- | --- |
| 普通文件 | 文本 / JSON / 二进制 base64 | `cat`、`write`、编辑器、文件管理器 |
| **可执行文件** | 一段函数体，`.bin.add` 之类 | `exec('.bin.add', 2, 3)` → `5` |
| **JS 对象** | 文件正文是 JSON，`meta.kind='object'` | 直接读出来就是对象，可热改 |
| **权限申请单** | `.perm.*` 里的一条记录 | `perm('notify')` 弹出申请，用户同意后落盘 |
| **设备** | `.dev.tty` `.dev.null` `.dev.zero` `.dev.random` `.dev.time` `.dev.console` | 读 `.dev.time` 得到时间戳，写 `.dev.null` 丢弃 |
| **进程** | `.proc.<pid>` | 每个 Worker 一个条目，`ps()` 看，`kill(pid)` 杀 |
| **终端接口** | `.dev.tty` | 写进去就是往终端打印，行为贴近 Linux |
| **应用** | `.app.*` | `open('.app.browser')` 打开窗口应用 |
| **包** | `.pkg.<spec>` | `require('lodash@4')` 后自动出现 |

例子：

```js
// 造一个可执行文件
await write('.bin.add', 'return args[0] + args[1]', { kind: 'func' });
await exec('.bin.add', 2, 3);           // 5

// 造一个对象文件
await write('.home.conf', JSON.stringify({ theme: 'dark' }), { kind: 'object' });

// 读设备
await cat('.dev.time');                 // 1730000000000
await cat('.dev.random');               // 0.37281...

// 往终端打印（终端接口）
await write('.dev.tty', 'hello\n');     // 屏幕上直接出现 hello
```

`open(p)` 会按 `kind` / 扩展名分派：目录 → 文件管理器，`.js` → 编辑器，URL → 浏览器，应用 → 窗口。

---

## 窗口与线程

最底层是**桌面 = 终端**（唯一的那个 xterm 实例）。上面浮着窗口，像一台小电脑：

- 可拖拽移动（吸顶自动最大化）
- 八向拖拽改大小
- 最小化 / 最大化 / 关闭
- 点击聚焦、z-index 自动上浮
- 底部 dock 显示所有窗口，点击切换

窗口类型：`shell`（终端）、`python`、`browser`（iframe）、`files`、`editor`、`agent`、`html`、`about`。

```js
winOpen({ type:'browser', url:'https://example.com' });
winOpen({ type:'files' });
spawn('1 + 1');                    // = winOpen({type:'shell', code:'1 + 1'})
winList();                         // [{id, type, title, ...}]
winClose(id);
```

**每个终端窗口 = 一个 Web Worker**。不是单线程模拟，是真的多线程：

```text
主线程（UI）                           Worker N（内核）
  xterm.js  ←── 输出 ──────────────  LineEditor / execute()
  WindowManager ── 输入 ──────────→  fs / pkg / python
       │                                  │
       └── RPC {t:'rpc', id, op, args} ──→┘
           ←── {t:'rpc-result', id, ok, value} ──┘
```

Worker 通过 Blob URL 构造（源码内联在 `<script id="worker-src" type="text/js-worker">` 里），
所以整个页面不需要任何额外文件。

好处不只是"不卡界面"：Worker 崩了不会带走页面，主线程能捕获到并执行「退出→回退」逻辑；
`ps()` / `kill()` 也有了真实对象可管。

---

## Python 环境

底层终端里敲 `python()`（或按 `Ctrl+Shift+P` 开独立窗口）进入 **Pyodide**（Python 3.12.1，WASM）。

```text
.home > python()
Python 3.12.1 (Pyodide) ...
>>> print('hello from python')
hello from python
>>> import sys; sys.version
'3.12.1 (main, ...)'
>>> exit()            ← 回到 JS shell
```

- 首次进入要从 CDN 拉 Pyodide（约 10 MB，之后走浏览器缓存）
- stdout / stderr 被重定向到终端，batched 输出会补上换行
- `exit()` / `Ctrl+D` 回到 shell 层，不会连带关掉浏览器页面
- Python 循环跑飞了？`Ctrl+C` 打断

---

## 包管理器

```js
await require('lodash@4');        // 或 install('lodash@4')
_.chunk([1,2,3,4], 2);            // [ [1,2], [3,4] ]
```

- **智能 CDN 回退**：`esm.sh` → `jsdelivr` → `unpkg`，哪个通用哪个
- 索引写入 `localStorage['ht.packages']`（同时映到 `.pkg.<spec>`），**下次打开自动加载**
- `uninstall('lodash@4')` 移除索引；`.pkg` 目录里跟着消失
- 加载失败会带上三个 CDN 各自的错误，方便判断是网络问题还是包本身问题

> 只用 ESM 包。CJS-only 的包即使 esm.sh 能转，也不保证 `import()` 后行为正确。

---

## 挂在 window 上的标准函数

一套又短又统一的入口，全部挂 `window`（既在 `hterm.*` 下，也直挂顶层常用别名）：

```js
// —— 文件 ——
saveFile(name, body)        // 触发浏览器下载
askFile()                   // 弹出选择框，写进 .queryfile.<名>，返回路径
readFile(p) / writeFile(p, data, meta)
listDir(p) / stat(p) / remove(p, {r}) / mkdir(p) / move(a,b) / copy(a,b)

// —— 终端 / 线程 ——
exec(code)                  // 在底层终端执行一行
python()                    // 进入 Python
spawn(code, opts)           // 新开终端窗口
threads.list() / threads.kill(pid)

// —— 窗口 ——
openWindow({type, ...}) / closeWindow(id) / listWindows()

// —— 网络 / 系统 ——
fetchText(url) / openURL(url) / requestPermission(name) / notify(msg)
nuke()                      // 清空所有数据并刷新

// —— 设置 / 包 / 智能体 ——
settings.get(k) / settings.set(k, v) / settings.all()
pkg.install(spec) / pkg.list() / pkg.remove(spec)
agent.open() / agent.send(text) / agent.export() / agent.clear()

// —— 其它 ——
toast(msg) / modal({...}) / confirm(text) / clipboard.write(t) / clipboard.read()
about() / sleep(ms) / uuid() / storage(IDB)
```

设计上只有一条规则：**所有需要"授权 / 外部副作用"的动作，都必须经过这里的某个函数**。
用户（或智能体）想保存文件、问用户要文件、开网页、起线程，路径都收敛在这一层，
方便审计，也方便以后加拦截。

---

## AI 智能体

轻量 harness，**不是**框架。它做三件事：拼 prompt、跑工具循环、把会话存成 JSONL。

- **只有一个会话**（不是多会话）。存在 `.agent.session`，JSONL 格式，一行一条消息
- 会话随时可整体导入导出（JSONL，方便手工截断、去重、拼接）
- 工具集：`js`（在当前沙箱里直接执行 JS）、`read_file`、`write_file`、`list_dir`、`delete_file`、`open_window`、`close_window`、`fetch_url`、`save_file`
- **不问许可**。`js` 工具直接在当前上下文执行，没有沙箱、没有审批弹窗。这是设计选择，不是遗漏
- 停止按钮 = `AbortController.abort()`，随时掐断

`js` 工具走控制台语义：

```js
// 先尝试当表达式求值（回显值），SyntaxError 才当语句块执行
v = await new AsyncFunction('return (' + code + '\n)')();
// → 失败则：
v = await new AsyncFunction('"use strict";\n' + code)();
```

所以 `1+1` 返回 `2`，`await write('.home.a','x')` 返回文件对象，两者都能被模型看懂。

JSONL 会话长这样（每行一条）：

```jsonl
{"role":"system","content":"你是 hterminal 里的助手……"}
{"role":"user","content":"看看 .home 里有什么"}
{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\".home\"}"}}]}
{"role":"tool","tool_call_id":"c1","content":"[\"welcome\",\"notes.md\"]"}
{"role":"assistant","content":".home 里有两个文件：welcome 和 notes.md。"}
```

---

## 后端 modelserver

**可选**。纯前端已经能跑全部功能，后端只干一件事：**替你保管密钥、代理模型请求**。

它无状态、不做智能体循环、不读文件、不调工具——按需求原文，它「无权做任何外部操作」，
只是把前端的 Chat Completions 请求转成各家格式再转发出去。

三份实现，逻辑同步，都是**单文件、只用标准库**：

| 文件 | 运行 | 依赖 |
| --- | --- | --- |
| `modelserver.py` | `python3 modelserver.py` | Python 3.8+ 标准库 |
| `modelserver.js` | `node modelserver.js` | Node 18+（内置 fetch） |
| `modelserver.go` | `go run modelserver.go` | Go 1.21+ 标准库 |

### 配置（环境变量）

```bash
export HT_PORT=8787                       # 监听端口，默认 8787
export OPENAI_API_KEY=sk-...              # OpenAI / 兼容端点
export OPENAI_BASE_URL=https://api.openai.com/v1
export ANTHROPIC_API_KEY=sk-ant-...       # Anthropic
export ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
export HT_MODEL=gpt-4o-mini               # 默认模型
export HT_DEFAULT_PROVIDER=openai         # openai | anthropic | responses
export HT_TIMEOUT=120
```

```bash
python3 modelserver.py
#   listening  http://127.0.0.1:8787
#   provider   openai
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | `{"ok":true,...}`，前端启动后自动探测 |
| `POST` | `/v1/chat/completions` | Chat Completions 标准格式，**前后端之间只用这一种** |
| `OPTIONS` | `*` | CORS 预检，返回 204 |

请求头：

- `X-HTerm-Client: hterminal` —— 必带，否则 403（挡住误撞上来的扫描器）
- `X-HTerm-Provider: openai|anthropic|responses` —— 选上游格式，缺省用 `HT_DEFAULT_PROVIDER`

上游格式由它自己双向转换，包括 `tool_calls` ↔ Anthropic `tool_use` / Responses `function_call`。

### 安全模型

只允许本机访问，**三层校验，不靠请求头判断**：

1. **socket 层**：`remoteAddress` 必须是 loopback（`127.0.0.1` / `::1`），`::ffff:` 前缀会先剥掉
2. **Host 白名单**：必须是 `127.0.0.1:PORT` / `localhost:PORT` / `[::1]:PORT`（防 DNS rebinding）
3. **Origin 校验**：只允许 `null`（`file://` 打开的页面）或本机 origin

另外：非流式（拒绝 `stream:true`，简化实现）、body 上限 8 MB、上游超时 `HT_TIMEOUT`。

> 前端不登录、不带 token——因为只有本机能连上，鉴权靠网络位置而不是凭据。

### 在前端接上

「更多 → 智能体 → 后端地址」填 `http://127.0.0.1:8787`，点「检测」。
探测只打 `/health`，成功就亮绿灯；之后每次对话都会带 `X-HTerm-Client` 和 `X-HTerm-Provider`。

---

## 架构与代码地图

```text
index.html                 ← 产物：自包含单文件（由 build.sh 拼装，不要手改）
build.sh                   ← 拼装 + node --check 语法校验
build/
  00-head.html             ← doctype / 许可注释 / 全部 CSS（暗亮双主题变量）
  10-body.html             ← DOM 骨架：终端、窗口层、HUD、dock、抽屉、模态
  20-worker.js             ← Worker 内核：ANSI、行编辑器、execute()、全部 shell 命令
  30-core.js               ← 主线程底座：Settings / 路径规则 / FS / IDB / Pkg / 文件交互
  40-term.js               ← xterm 装载、TerminalSession、TerminalManager、WindowManager
  50-apps.js               ← BrowserApp / FilesApp / EditorApp
  60-agent.js              ← 智能体：prompt、工具定义、循环、JSONL 会话
  70-boot.js               ← RPC 分发、抽屉 UI、window API、快捷键、启动流程
modelserver.py             ← 后端（Python）
modelserver.js             ← 后端（Node）
modelserver.go             ← 后端（Go）
LICENSE                    ← 双许可声明（简短）
LICENSE-APACHE             ← Apache-2.0 全文
LICENSE-MIT                ← MIT 全文
licenses/                  ← 第三方许可见 licenses/README.md
```

**分层**：

```text
  ┌──────────────────────────────────────────┐
  │  UI 层   xterm / 窗口 / 抽屉 / 文件管理器   │  只管画，不做业务
  ├──────────────────────────────────────────┤
  │  环境层（"内核"）  RPC 分发 + 进程调度      │  极简，不区分用户态/内核态
  ├──────────────────────────────────────────┤
  │  Worker 运行时   execute / fs / pkg / py  │  真正的执行现场
  ├──────────────────────────────────────────┤
  │  存储层   IndexedDB + localStorage 镜像    │
  └──────────────────────────────────────────┘
```

「环境」刻意做得很薄：它只负责把消息路由到正确的 Worker、把 Worker 的输出送回正确的终端。
没有权限位、没有系统调用门、没有用户态/内核态之分——因为在浏览器里，这些抽象都是自欺欺人。

---

## 构建

改 `build/*.js` 或 `build/*.html`，然后：

```bash
./build.sh
# index.html: 205658 bytes
```

脚本做的事：拼接五段 → 内联 Worker 源码 → 写出 `index.html` → `node --check` 校验主线程与 Worker 两份 JS。

**不要直接编辑 `index.html`**，下次构建会被覆盖。

无头回归测试（可选，需 `playwright-core` + 系统 chromium）覆盖了：启动流程、REPL 求值、文件读写、
localStorage 镜像、可执行函数、多行粘贴、Tab 补全、窗口四开、浏览器 iframe 真实加载、
Python 进入/退出、包安装、智能体工具循环、三份后端的三种格式转换。

---

## 设计取舍与踩坑记录

按时间顺序，记下真正卡住过的问题，给后来者省点时间。

**1. `self = globalThis` 让 Worker 直接死掉**
Worker 里 `self` 是只读的，赋值抛 `TypeError` → Worker 启动失败 → 发 `exit` → 主线程
`exitDesktop()` → `location.reload()` → 白屏死循环。现象是"页面一闪就回 about:blank"，
排查了半天才发现根因在 Worker 第一行。**教训**：启动路径上任何一处未捕获异常，
如果它的兜底是 reload，就会变成无限重启。

**2. 输出函数被用户 API 覆盖**
`Object.assign(globalThis, api)` 把 shell 的 `write(p, data)` 挂上去之后，
Worker 内部的 `write()`（往终端打印）被顶掉，导致每敲一行都报"名称必须以字母或中文开头"。
**修法**：内部输出统一改名 `out()`，用户可见的 `write` 保留文件语义。
**教训**：把 API 倒进同一个全局作用域时，内部函数必须改名或放进闭包。

**3. 严格模式 + 剩余参数**
`AsyncFunction('...args', '"use strict"; ...')` 抛
`Illegal 'use strict' directive in function with non-simple parameter list`。
**修法**：包一层 `return (async()=>{ "use strict"; ... })()`——外层参数保持简单，内层函数带严格模式。

**4. `pwd()` 打印两遍**
`pwd` 既调 `out()` 又 `return path`，REPL 又把返回值回显一次。
**修法**：命令只返回值，回显交给 REPL。后来这也成了统一约定。

**5. `.localstorage` 里冒出 `map` 伪条目**
localStorage 键值映射表本来存 `ht.ls.map`，被 `lsKeys()` 当成普通键列出来了。
**修法**：映射表搬到 `ht.lsmap`（点在键名中间不作分隔），并在 `lsKeys()` 里过滤旧键做兼容。

**6. Python 输出粘在提示符上**
`hello from python>>>` —— Pyodide 的 batched stdout 不带尾换行。
**修法**：先补 `\n` 再统一转 `\r\n`（xterm 要 CRLF）。

**7. `exit()` / `Ctrl+D` 退不出去，反而层叠**
行编辑器认出 `EXIT` 后没调 `onEOF`，于是"退出"只清了当前行。
**修法**：在 `submit` / `submitText` 的 EXIT 分支显式调 `onEOF()`。

**8. 后端全 403 "缺少 X-HTerm-Client"**
Node 版把请求头写成 `x-htem-client`——少了个 `r`，且 Node 的 headers 是小写键。
**修法**：统一 `req.headers['x-hterm-client']` / `['x-hterm-provider']`。三份实现同步改。

**9. 浅色主题切完不重绘**
只改 `term.options.theme` 不生效，xterm 缓存了旧主题的渲染结果。
**修法**：改完调 `term.refresh(0, rows-1)` 强制重刷。

**10. Playwright 等不到 `#boot.gone`**
元素 `display:none` 之后 Playwright 判定为"不可见"，`waitForSelector` 默认等可见就超时。
**修法**：`{ state:'attached' }`。这个坑和产品代码无关，纯测试侧。

**11. 字体栈里的 `ui-monospace` 在 Windows Chrome 上让行高抖动**
参考项目踩过（见[借鉴声明](#借鉴声明)），本项目的 `--mono` 栈里就不放它。

---

## 借鉴声明

本项目的**大量设计决策与实现片段，主动借鉴了同作者的前作**
[draw-http-terminal-20261025](https://gitee.com/zuozhixingzhe-digger/draw-http-terminal-20261025)。

两个项目都出自本仓库作者之手，代码可任意互相引用（包括直接拷贝），不构成第三方版权问题。
具体借鉴的地方：

| 方面 | 借鉴内容 |
| --- | --- |
| 技术选型 | xterm.js + addon-fit 做终端渲染，而不是自己画 canvas |
| 「更多」抽屉 | 设置面板的信息架构（状态 / 外观 / 终端 / 文件系统 / 包 / 智能体 / 快捷键 / 数据分区） |
| 设置项设计 | 主题、字号、行高、光标样式、滚动回看行数等具体条目 |
| 字体栈 | 避开 `ui-monospace` 的踩坑结论 |
| 视觉基调 | 深色底 + 青绿强调色（`#5eead4`）+ 琥珀色次强调（`#fbbf24`） |

没有借鉴的部分：点分隔路径的文件系统、Worker 多线程模型、智能体 harness、三份后端——
这些是本项目新写的。

前作的 README 是主要参考材料，**强烈建议对照阅读**，能更快理解本项目的取舍来自哪里。

---

## 许可证

**Apache-2.0 OR MIT**，双许可，任选其一。

```text
SPDX-License-Identifier: Apache-2.0 OR MIT
```

- [LICENSE](LICENSE) —— 简短的双许可声明（推荐从这里开始读）
- [LICENSE-APACHE](LICENSE-APACHE) —— Apache License 2.0 全文
- [LICENSE-MIT](LICENSE-MIT) —— MIT 全文

每个源文件开头都带 SPDX 短声明（`index.html` 里严格放在 `<!DOCTYPE html>` **之后**）。
第三方组件的完整许可原文放在 [`licenses/`](licenses/README.md)。

### 兼容性红线

> **本项目不接受任何与 Apache-2.0 或 MIT 不兼容的代码、资源、字体、图标、示例文本。**
>
> 这条是**一票否决**：即使功能上确实需要、即使有人明确要求，也不加。
> 宁可功能缺失、宁可软件跑不起来，也不引入不兼容内容。

对应的实践：

- 前端依赖只用 CDN 上的 MIT / Apache-2.0 / MPL-2.0 项目（Pyodide 是 MPL-2.0，同为宽松/文件级 copyleft，与双许可共存无冲突）
- 不引入 GPL / AGPL / SSPL / Commons Clause / 非商业许可的任何东西
- 图标全部手写 SVG（见 `30-core.js` 的 `SVG_ICONS`），不用图标字体
- 示例文本、prompt、README 全部自己写，不抄有版权的内容
- 三份后端只用语言标准库，零第三方依赖

| 第三方 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [xterm.js](https://github.com/xtermjs/xterm.js) | 5.5.0 | MIT | 终端渲染 |
| [@xterm/addon-fit](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) | 0.10.0 | MIT | 终端自适应尺寸 |
| [Pyodide](https://pyodide.org/) | 0.26.4 | MPL-2.0 | Python 3.12 (WASM) |

---

## AI 生成内容声明

**本项目的绝大部分源代码、文档与测试由 AI 智能体（WorkBuddy）生成，经人类作者审阅、调试与定稿。**

具体来说：

- `index.html` 及其全部 `build/` 分片、`build.sh`、三份 `modelserver`、本 README —— AI 生成
- `LICENSE-APACHE`、`LICENSE-MIT`、`licenses/LICENSE.*.txt` —— 从各自上游复制原文（非 AI 创作）
- 调试过程（[踩坑记录](#设计取舍与踩坑记录) 里的 11 条）由 AI 与人类共同排查完成

这意味着：

- 代码风格可能有人味不足的地方，注释密度偏高
- 边界情况的处理可能不如人类老手周全，**不建议直接用于生产环境**
- 但每一处逻辑都经过真实浏览器验证，不是「看起来能跑」

采用 Apache-2.0 OR MIT 而非更严格的许可，部分原因就是让 AI 生成内容的使用权尽可能清晰：
你可以任意使用、修改、商用、闭源分发，只需保留版权与许可声明。

---

<p align="center">
  <sub>hterminal · 桌面就是终端 · 一切皆文件</sub>
</p>
