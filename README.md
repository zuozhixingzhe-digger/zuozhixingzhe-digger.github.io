# HTerMinaL

> 在浏览器里运行的 JS 终端 —— 一切皆文件，桌面就是终端，窗口是线程。
> 当前版本 **0.0.1.1**（四段式版本号，默认末位 +1；第三位 +1 表示「上一个台阶」，见[版本号与提交规则](#2-版本号与提交规则)）。

`HTerMinaL` 是一个**完全自包含的单文件网页**（`index.html`，约 644 KB，无构建依赖、可直接双击打开）。
它把 xterm.js 当作前端渲染层，把浏览器的 JS 引擎（跑在 Web Worker 里）当作内核，
再往上长出一套 Unix 味道的文件系统、窗口管理器和 AI 智能体宿主。
依赖（xterm / Pyodide / marked / html2canvas）走 CDN，**首次加载后统一进 IndexedDB**，
之后离线也能开。

```text
  _   _ _____
 | | | |_   _|__ _ _ _ __ _ _ __
 | |_| | | |/ -_) '_| '  \| '  \
  \__,_| |_|\___|_| |_|_|_|_|_|_|
        js in the browser · everything is a file

> 1 + 1
2
> ls('.home')
readme     welcome
> exec('.bin.add', 2, 3)
5
```

---

## 目录

**第一部分 · 使用文档**

1. [这是什么](#1-这是什么)
2. [三十秒上手](#2-三十秒上手)
3. [界面：顶栏 / 桌面 / 更多](#3-界面顶栏--桌面--更多)
4. [快捷键](#4-快捷键)
5. [JSHeL 速查](#5-jshel-速查)
6. [文件系统](#6-文件系统)
7. [一切皆文件](#7-一切皆文件)
8. [窗口与线程](#8-窗口与线程)
9. [Python 环境](#9-python-环境)
10. [包管理器](#10-包管理器)
11. [挂在 window 上的标准函数](#11-挂在-window-上的标准函数)
12. [AI 智能体](#12-ai-智能体)
13. [后端 modelserver](#13-后端-modelserver)
14. [常见问题](#14-常见问题)
15. [沙箱里的工具](#15-沙箱里的工具)
16. [设计理念 · 给用户的话](#16-设计理念--给用户的话)

**第二部分 · 维护指南（给接手的 AI / 人看）**

1. [交接速览](#1-交接速览)
2. [版本号与提交规则](#2-版本号与提交规则)
3. [目录与文件地图](#3-目录与文件地图)
4. [架构](#4-架构)
5. [前端布局规范](#5-前端布局规范)
6. [构建与验证](#6-构建与验证)
7. [设计取舍与踩坑记录](#7-设计取舍与踩坑记录)
8. [借鉴声明](#8-借鉴声明)
9. [开发日志](#9-开发日志)
10. [智能体操作记录](#10-智能体操作记录)
11. [许可证](#11-许可证)
12. [AI 生成内容声明](#12-ai-生成内容声明)

**附**：[想法池 `IDEAS.md`](IDEAS.md) —— 还没开工的点子，目前三条：
**在浏览器里跑 Linux 程序**（原名 HSL，但 HSL 这三个字母现在已经是本项目的交互 shell 名字，真开工前得先改名）、
**移植第三方程序的许可证规则**、**`sptm` 挂载要先把五件事想清楚**。

---

# 第一部分 · 使用文档

## 1. 这是什么

一个网页，打开就是一台小电脑：

| 层 | 是什么 |
| --- | --- |
| 最底层「桌面」 | **唯一的**一个终端（xterm.js），死了就等于关机 |
| 上面浮的窗口 | 终端、浏览器（iframe）、文件管理器、编辑器、Python、智能体 |
| 文件系统 | 点分隔路径、命名像标识符、**一切皆文件**（函数、设备、进程、权限都是文件） |
| 内核 | 每个终端窗口一个 Web Worker，真多线程 |
| 智能体 | 单会话 harness，能直接在当前沙箱执行 JS，不问许可 |
| 工具 | 计算器 / 数据转换 / 调色盘 / Markdown / 截图 / 链接即状态（见[§15](#15-沙箱里的工具)） |

它**不需要后端**。后端（`modelserver.*`）只用于替你保管 API 密钥，可选。

定位上我们很清楚自己不是什么：**这不是一个「能演示的 WebOS」，而是一个沙箱运行时**
（浏览器沙箱 + 文件系统 + JS 执行 + 工具 + 可选的 AI）。完整的想法写在
[§16 设计理念 · 给用户的话](#16-设计理念--给用户的话)，包括安全边界与「哪些事我们不做」。

## 2. 三十秒上手

1. 下载本仓库的 `index.html`，用**现代浏览器**（Chrome / Edge / Safari 16+ / Firefox 115+）打开。
   也可以 `python3 -m http.server` 起个静态服务再访问——两种都行，没有后端也能跑全部功能。
2. 等启动进度条走完（首次会从 CDN 拉 xterm.js，之后走缓存）。
3. 直接敲 JS：`1 + 1`、`document.title`、`await fetch('/')`。
4. 敲 `help()` 看 JS 侧 API，敲 `ls('.home')` 看家目录，点顶栏 `▦` 开个窗口。
5. 想敲 Linux 命令：敲 `hsl` 进 shell（`ls -la`、`cat readme`、`fastfetch`），`exit` 回来。
   想让它说话：填一个后端（见[后端](#13-后端-modelserver)），按 `Ctrl+Shift+A` 开智能体。

> **双击打开 ≠ 能用后端**。`file://` 页面的 Origin 是 `null`，和恶意网页里的
> `<iframe sandbox>` 一模一样，浏览器给不出区别（连 `Sec-Fetch-Site` 都是 `cross-site`）。
> 0.0.0.5 起后端**一律拒绝 `null` Origin**，所以用 `file://` 打开时后端连不上——
> 这是刻意的，不是 bug。要用智能体（后端模式）请走 `python3 modelserver.py` 之后打开
> `http://127.0.0.1:8787/`；只想临时测试，可以在设置里勾「直连 API」。

> **数据在哪**：所有文件都在浏览器 IndexedDB 里（库名 `hterm-fs`）。
> 换浏览器、换设备、清缓存就没了——所以请定期在「≥ 更多 → 文件系统 → 导出为 JSON」里备份。

清空一切：终端里敲 `nuke()`，或「更多 → 数据 → 清除本页全部数据」。

## 3. 界面：顶栏 / 桌面 / 更多

界面是**三段式**：顶部控制栏、占满剩余画布的桌面、右侧滑出的「更多」抽屉。
这套结构直接沿用参考项目 `draw-http-terminal`（见[借鉴声明](#8-借鉴声明)），因为它对「终端优先」的
窄屏与宽屏都成立：顶栏只占一条，终端永远拿到剩下的全部高度。

### 顶栏

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ⌃   ⌥   ⇧   (◉)   ␛   ⇥                                    ▦  ⛶  ≥ │
└────────────────────────────────────────────────────────────────────────────┘
  修饰键        摇杆   Esc Tab                              右按钮
```

- **左**：**从 `⌃` 开始，前面什么都没有**。原来的品牌名、版本号、当前目录全部删掉——
  顶栏是用来按的，不是用来读的；版本号在「更多 → 状态」里，当前目录在提示符里。
- **中**：`⌃ ⌥ ⇧` 修饰键 + **方向摇杆** + `␛`/`⇥`。手机上没有实体键盘时，
  `Ctrl+C`、`Tab` 补全、历史翻页全靠它。摇杆拖动中心圆点按主导方向发方向键，按住连发（180 ms）。
- **右**：`▦` 应用启动器 / `⛶` 全屏 / **`≥` 更多**（原来的 `☰` 换成 `≥`，单字符更利落）。

`▦` 里分三段：基础应用（终端/浏览器/文件/编辑器/Python/智能体）、**工具**
（计算器/数据转换/调色盘/Markdown/截图/链接即状态，见[§15](#15-沙箱里的工具)）、
以及四个置灰的「维护中」（录音机/定位/3D/音频）。置灰不是禁用：点进去会看到
「计划怎么做」和「为什么先不做」，比一个点了没反应的按钮诚实。

> 为什么用 `≥`：它本身是「大于等于」的数学符号，视觉上是一个指向右侧的折角，
> 天然表达「展开到右边」；`☰` 会被不少系统当成列表/菜单图标做特粗处理，字重不可控。

`⛶` 与键盘 `F11` 是**同一条路径**：都调 `toggleFullscreen()`，都进出软件全屏（`body.fs`，
隐藏顶栏与 dock，把桌面铺满视口），也都在可用时请求浏览器 Fullscreen API。
不存在「按按钮是一种全屏、按 F11 是另一种」。`Esc` 退出。

符号控制键的规则（与参考项目一致）：

| 操作 | 效果 |
| --- | --- |
| **短按** `⌃` / `⌥` / `⇧` | 切换锁定（实心高亮），下一次输入带上该修饰键，再按一次解锁 |
| **按住不放** | 临时生效，松手即失效（组合键手感） |
| 按住期间**有输入** | 松手自动解锁，不会残留锁定 |

锁定 `⌃` 后敲 `c` 就是 `Ctrl+C`（取消当前行），敲 `d` 就是 `Ctrl+D`（退出）；
锁定 `⌥` 后敲字符等于 `Alt+字符`（发 `ESC` 前缀）。`⇧` 只影响字符大小写，不改写字节。

### 桌面

**底层终端只有一个**，永远铺在窗口下面。窗口可以拖拽移动、八向改大小、最小化 / 最大化 / 关闭；
拖到屏幕边缘会吸附成半屏或全屏。底部 dock 列出所有窗口，点击切换。

**提示符**固定是「当前路径 + `> ` + 一个空格」，没有设置项：

```text
.home>  1 + 1              ← JSHeL：只认 JavaScript
.home $  ls -la            ← HSL：只认命令（提示符多一个 $）
. $      cd /              ← 嵌套的第二层，自己记自己的目录
```

路径里的 `@` 表示当前目录（`cd @` 原地不动、`cat @.notes` 读当前目录下的文件），
`~` 是 `.home`，`..` 是上一级，`/` 与 `.` 在 JSHeL 里等价。

在 **HSL** 里规则换成 shell 那一套：路径相对当前目录（`ls` 列 cwd、`cd ..` 上一级），
`.` 开头的点分路径仍按根解析。提示符末尾的 `$` 就是「我在 shell 里」的唯一标志。

**光标**照参考项目的做法，不给任何设置项：一个 `div` 叠在 xterm 上（xterm 自己的光标设成全透明），
用 `requestAnimationFrame` 每帧向目标点逼近 22%，所以移动是滑过去的、不是跳过去的。
聚焦时是 2px 竖线，失焦变成 7px 的椭圆（不闪），备用屏（vim/nano）下是虚线框，空闲 1 秒后开始呼吸。
xterm 的 `cursorBlink` 关掉，闪烁完全由这一层控制。

**窗口动效**（`prefers-reduced-motion` 下全部降级为直接显示）：

| 动作 | 效果 |
| --- | --- |
| 打开 | 从触发点（启动器图标 / dock 图标坐标）一个小点扩散成完整窗口 |
| 关闭 | 反向收成一个点并淡出，像溶进桌面 |
| 最大化 | 从当前位置向外扩到整块桌面；还原时向内缩回原尺寸 |
| 最小化 | 沉向 dock 里对应图标的位置并缩小淡出 |
| 恢复 | 从 dock 图标位置长回窗口 |

### 更多（`≥` / `Ctrl+,`）

右侧滑出，分八段：**状态 · 外观 · 终端 · 文件系统 · 软件包 · 智能体 · 快捷键 · 数据**。
`Esc` 或点遮罩关闭。外观段只有四项：主题（只读，跟系统）、**终端字号**、**显示行数**（固定高度，
0 = 自动铺满）、行高。光标样式、背景网格、提示符格式**故意不提供设置**——
它们属于「这个终端长什么样」，一旦可配就会有人配出难看的组合。
（0.0.0.2 曾有「按键振动」开关，0.0.0.3 删了：打字时手在键上，再震是干扰；
振动只保留给方向摇杆。）

## 4. 快捷键

设计原则：**凡是 Ctrl / Alt 组合都尽量抢过来**（终端和输入框的原生编辑键除外），
**F5 / F11 / F12 有明确归属**，其余 F 键放行。

| 组合 | 作用 |
| --- | --- |
| `Ctrl+Shift+T` | 新开一个终端窗口（和底层终端一模一样） |
| `Ctrl+Shift+B` | 新开浏览器窗口 |
| `Ctrl+Shift+A` | 打开智能体 |
| `Ctrl+Shift+F` | 打开文件管理器 |
| `Ctrl+Shift+E` | 打开编辑器（默认打开 `.home.welcome`） |
| `Ctrl+Shift+P` | 打开 Python 窗口 |
| `Ctrl+Shift+Enter` | 全屏 / 退出全屏 |
| `Ctrl+Shift+W` | 关闭当前窗口 |
| `Ctrl+Shift+M` | 当前窗口最大化 / 还原 |
| `Ctrl+Shift+D` | 所有窗口最小化（露出桌面＝终端） |
| `Ctrl+,` | 打开 / 关闭「更多」抽屉 |
| `Esc` | 关闭抽屉 / 启动器 / 弹窗 |
| `F5` | **交给浏览器**——刷新整个页面（不拦截） |
| `F11` | **软件级接管**——`preventDefault()` 后走 `toggleFullscreen()`，与顶栏 `⛶` 同一路径 |
| `F12` | **交给浏览器**——开发者工具（不拦截） |

`F5` / `F12` 是刻意放行的：它们属于浏览器外壳，抢过来只会让用户以为键盘坏了。
`F11` 是唯一的例外——浏览器全屏会把顶栏一起藏掉，用户就再也点不到 `⛶` 退出，
所以由软件接管，并且**保证和按钮完全同一套行为**。

终端内部的语义键保持不抢：`Ctrl+C`（取消当前行）、`Ctrl+D`（退出）、`Ctrl+L`（清屏）、`Ctrl+A/E/U/K/W/Z/R`。
输入框里的 `Ctrl+A/C/V/X/Z/Y` 也不抢。开发者工具留门：`Ctrl+Shift+I/J/C`、`F12`。

**振动反馈只给摇杆**：拖动摇杆 / 连发方向键时 `navigator.vibrate(7ms)`，节流 60ms
（小于 180ms 连发间隔，所以每次都能感到）。**键盘输入不振动**——打字时手本来就在键上，
再震一下纯属干扰。桌面浏览器没有振动马达，`navigator.vibrate` 不存在时静默跳过。

**底层终端只有一个**。它如果因为任何原因终止（`exit()`、`Ctrl+D`、Worker 异常），
会自动回到浏览器上一级页面（有真实来源页时）或刷新整个页面（否则）。
换句话说：终端死了 = 这个「操作系统」关机了。

## 5. JSHeL 速查

JSHeL = **JS HTML shell**。它不是一个语法，就是一个 REPL：**你敲的每一行都是 JavaScript**，
只不过一批常用操作被预置成了同名函数，所以看起来像 shell。

```js
1 + 1                       // 表达式：回显结果
const x = await ls('.home') // 声明：提升到全局，后续可用
help                        // 裸名字自动调用（白名单内）
hsl                         // 同上：进 HSL 交互 shell
```

> 这一层**不认 shell 语法**。`ls -la`、`cat a | grep b`、`mkdir x && cd x` 都是语法错误，
> 请用 `hsl()` 进去敲，或者 `hsl('ls -la')`。见 [5.1](#51-hslbuild25-compatjs)。

| 分类 | 命令 |
| --- | --- |
| 文件 | `ls(p)` `ll(p)` `cd(p)` `pwd()` `cat(p)` `write(p, data)` `mkdir(p)` `rm(p,{r})` `mv(a,b)` `cp(a,b)` `stat(p)` `tree(p)` `find(pat)` `grep(pat)` `head(p,n)` `tail(p,n)` `du(p)` `df()` `mount()` |
| 执行 | `exec(p, ...args)` `open(p)` `run(code)` `require('pkg')` `python()` `exit()` |
| 窗口 | `winOpen({type,title,url,code})` `spawn(code)` `winList()` `winClose(id)` `agentOpen()` |
| 系统 | `saveFile(name, body)` `askFile()` `fetchText(url)` `openUrl(url)` `notify(msg)` `perm(name)` `ps()` `kill(pid)` `clear()` `history()` `nuke()` |
| HSL | `hsl()` 进交互 shell、`hsl('ls -la')` 跑一行、`hsl.run(cmd)` 拿 `{code,out,err}` |

几个容易误解的点：

- **`write` 不返回值**（像 shell 的 `>`）。想要文件对象请用 `fs.write` 或 `stat`。
- **`pwd()` 只返回路径**，由 REPL 负责回显，不会打印两遍。
- **`exec` 执行的是「可执行文件」**：`.bin` 里的 content 被编译成 `AsyncFunction`，`args` 是实参数组。
  **写进 `.bin` 就是函数**（`write('.bin.hi','return 42')` 之后 `exec('.bin.hi')` 直接得 42），
  之后用 `vim` 改它也不会变成普通文本。这是**文件类型**（`kind: 'func'`），不是权限位——
  这个文件系统没有 rwx，也没有 `chmod`。
- **`rm` 默认不递归**，删目录要 `rm(p, {r:true})`。
- **多行**：行尾反斜杠续行；粘贴多行文本会被识别成一次提交（括号粘贴协议）。

### 5.1 HSL（`build/25-compat.js`）

**HSL = 一个 Linux 风格的交互 shell**，和 JSHeL 是**两套彻底分开的环境**：

| | JSHeL | HSL |
| --- | --- | --- |
| 提示符 | `.home> ` | `.home $ ` |
| 认什么 | 只认 JavaScript | 只认命令、管道、重定向、变量、通配符 |
| `ls -la` | **语法错误**（不会执行） | 正常列目录 |
| `1+1` | `2` | `1+1: 命令未找到` |
| `write(p,d)` | 真的写文件 | 命令未找到（shell 不认 JS） |

以前是靠「第一个词是不是命令」去猜一行是 JS 还是 shell。猜错的代价是行为不可预测：
同一行代码的结果取决于命令表里恰好有没有同名命令。现在按提示符就能确定自己在哪一层。

```js
hsl()                    // 进交互 shell（可嵌套），返回 undefined
hsl('ls -la | head')     // 跑一行，输出直接进终端；返回 Promise<void>，REPL 不回显
await hsl.run('false')   // { code: 1 }——跑一行但不打印
await hsl.run('echo hi') // { code: 0, out: "hi\n" }
```

`hsl('…')` 故意返回 `Promise<void>` 而不是退出码：直接回车时 REPL 会把返回值回显出来，
返回层数或 `{code}` 都会在屏幕上多出一行噪音；要退出码就用 `hsl.run()`。
`hsl.run()` 的返回是 `{ code, out?, err? }`——没有输出时 `out`/`err` 这两个键**不存在**，
不是空字符串，这样 `if (r.err)` 才写得对。

**cwd 只有一份**：在 `hsl('cd ..')` 里 `cd` 了，回到 JSHeL 提示符也跟着变（`.> `）。
这不是 bug——`hsl()` 只是「用 shell 语法跑一行」，不是开一个隔离的 subshell；
要隔离就真进去 `hsl()`，那一层有自己的栈帧。

在 JSHeL 里敲命令会得到一句指路提示，但**不会被偷偷执行**：

```text
.home> nano readme
ReferenceError: nano is not defined
提示：nano 是 HSL 命令。hsl() 进 shell，或 hsl("nano readme")。
```

#### 嵌套：用栈，不用开关

`hsl` 可以一层层套进去，`exit` 一层层退出来：

```text
.home> hsl            → hsl · 第 1 层 · help 看命令，exit 退出这一层
.home $ cd .bin       → 第 1 层进 .bin
.bin $ hsl            → hsl: 第 2 层（exit 退出这一层）
.bin $ cd ..          → 第 2 层退到根，第 1 层还在 .bin
. $ exit              → exit: 回到第 1 层 HSL
.bin $                → 目录回到 .bin（第 1 层自己的 cwd）
.bin $ exit           → exit: 回到 JSHeL
.home>                → 目录回到 .home（JSHeL 的 cwd）
```

**每一层记自己的 cwd 和环境变量**——退回来时你还在离开的那一层，不会被弹回 `~`。

老版本把模式存成一个布尔量（`mode = 'zsh'`），于是「第二次进入」只是把同一个标记又设了一遍：
提示符不变、`exit` 一次就退到底、进去之前改过的目录也回不来。
**布尔量表达不了「第几层」**，现在每一层是一个栈帧（`{cwd, env}`），
退栈时 cwd 和环境变量一起恢复——这就是真 shell 里 subshell 的语义。

#### 支持的东西（全部自研，不是搬 busybox）

| 能力 | 说明 |
| --- | --- |
| 引号 | `'…'` 原样、`"…"` 插值 `$VAR`、`\` 转义 |
| 变量 | `X=1`、`echo $X`、`${X}`、`$?`（上一条的退出码） |
| 管道 | `cat a \| grep x \| head -3`，逐级传字符串 |
| 重定向 | `> file`、`>> file`、`< file`、`2>` |
| 通配符 | `*`、`?`，按**当前目录**展开 |
| 分号 / `&&` / `\|\|` | 顺序执行与短路 |

命令表（`help` 随时可看）：

```text
cat cd clear cp curl cut date df diff dir dirname du echo env exit export false
fastfetch find grep head help history hostname hsl kill less ll ln ls man mkdir
more mv nano neofetch printf ps pwd rev rm rmdir sed seq sleep sort source stat
tail tee touch tr tree true type uname uniq unlink unset vi vim wc wget which
whoami xargs yes
```

**路径按当前目录解析**：`ls` 列的是 cwd，`cat notes` 读的是 cwd 下的 notes，
`cd ..` 是上一级。想用绝对点分路径就写 `.home.readme`（`.` 开头仍按根解析），
`/`、`~`、`@` 也都认识。

#### 全屏应用

`vim`（普通/插入/命令三种模式）和 `nano`（`^O` 保存、`^X` 退出，`^K`/`^U` 剪切粘贴）
都画在终端的备用屏上，退出时回到原来的滚动历史。

它们**支持鼠标**（应用开着的时候）：点正文哪里，光标就到哪里；滚轮上下滚三行。
实现上开了 DECSET 1000 + 1006（SGR 坐标），退出时先关鼠标报告再离开备用屏。

画面是按**绝对坐标逐行重画**的，不是拼一大段带换行符的字符串：
内容高度等于终端高度时，末尾那个换行会把整屏顶上去一行——nano 之前「显示不正常」
（标题栏消失、正文整体上移、光标偏移）就是这个原因。中文按显示宽度（双宽）排版，
所以中英混排的 readme 不会一行行错开。

#### `fastfetch` / `neofetch`

```text
██╗  ██╗████████╗    HTerMinaL 0.0.1.1
██║  ██║╚══██╔══╝    ──────────────────────────
███████║   ██║       OS         Linux
██╔══██║   ██║       Host       browser · Chrome 145.0.7632.6
██║  ██║   ██║       Kernel     JSHeL 0.0.1.1
╚═╝  ╚═╝   ╚═╝       Shell      JSHeL + HSL
```

信息全是现场问出来的（`sys.info` + `fs.usage` + `proc.list`），
拿不到的字段写 `n/a`，不编。`fastfetch --no-logo` 只要文字。

#### 没有 rwx

这个文件系统**没有** mode 位、没有属主、没有组，也不是 ext4。所以：

- `ls -l` 印的是 `kind  size  mtime  name`（`dir`/`file`/`func`/`app`/`dev`/`pkg`），
  不是 `-rw-r--r--`——画一排 rwx 只会让人以为 `chmod` 有用
- `chmod` 命令已删除；`.bin` 里的东西就是可执行文件（`kind: 'func'`），
  这是文件类型，不是权限位
- `su` / `sudo` 已删除：只有你一个用户，而且本来就是最高权限

#### 删掉的「没意义移植」

| 命令 | 为什么删 |
| --- | --- |
| `apt` | 这里不是 Debian，装包是 `await require('lodash-es@4')` |
| `ping` | 浏览器不发 ICMP，做不到就是做不到 |
| `bash` / `sh` / `zsh` | 学不像就别学。zsh 本体是 MIT-like，但这里从来没打包它，只是借了个名字——现在名字也还回去了，交互层叫 HSL |
| `su` / `sudo` | 单用户、最高权限，没有「切换」这回事 |
| `npm` / `pip` | 只打印一行错误提示的桩，留着只会让人以为能用 |
| `chmod` | 见上：没有权限位可改 |

> **许可证**：HSL 全部是本项目 MIT 代码，没有静态链接任何 GPL 二进制。
> GNU coreutils / busybox / bash 都是 GPL，把它们的 wasm 打进单文件会传染整个发布物，
> 所以宁可自己重写。第三方清单见 `licenses/`。

### 5.2 内建 TUI 智能体

除了窗口版智能体，还有一个跑在终端里的（同一个会话、同一套 harness，只是换个渲染面）。

它不是「打印个横幅」——**`open()` 是真的换一层**：提示符从 `.home> ` 变成 `agent> `，
之后每一行都发给智能体，直到你退出。这一点之前是坏的：`open()` 只打横幅、模式没变，
所以下一行立刻回到 `.home>`，看上去就是「进去一下就自己退出来」。

```text
.home> agentTui.open()
── agent ────────────────────────────────────────────────
  直接输入任务，Enter 发送。:q 退出 · :stop 中断 · :help 命令 · Ctrl+C 中断当前轮 · Ctrl+D 退出
────────────────────────────────────────────────────────
agent> .home 里有什么
  → ls .home
  ← ls: .home.readme  .home.welcome
  .home 下有两个文件：readme 和 welcome。
  ─ 1.4s · 1 次工具调用

agent> :q
已退出 agent（对话在 IndexedDB ht-agent，窗口版看到的是同一段）
.home>
```

| 输入 | 行为 |
| --- | --- |
| 任意文字 | 整行发给智能体（**不**当 JS 求值，也不当 shell 命令） |
| `:stop` / `Ctrl+C` | 中断当前轮（走 `AbortController`，不等模型超时） |
| `:new` | 清空上下文，开一段新会话（旧会话仍在 IndexedDB） |
| `:clear` | 清屏（不删历史） |
| `:q` / `exit` / `Ctrl+D` | 退出，回到进来之前那一层 |
| `:help` | 上面这张表 |

**三种模式并列**，看提示符就知道自己在哪一层，不存在「猜这一行是什么」：

| 提示符 | 模式 | 一行交给谁 |
| --- | --- | --- |
| `.home> ` | JSHeL | JS 求值（`ls -la` 是语法错误） |
| `.home $ ` | HSL | shell 命令行（`1+1` 是「命令未找到」） |
| `agent> ` | 智能体 | 整行发给模型 |

函数接口仍然可用，给脚本用、不切模式：

```js
await agentTui.send('看下 .home 里有什么')   // 发一条，等它跑完
await agentTui.queue('再统计行数')           // 排队：忙时自动串行
agentTui.stop()                              // 中断当前轮，并清空队列
agentTui.status()                            // { running, messages }
```

`agent('……')` 是 `send` 的短名；`agent()` 不带参数等于 `open()`。

没有 id、没有多实例：**一个终端一个 TUI 会话**，这是刻意的——多实例会让「当前会话」这个概念
打架（窗口版和 TUI 共用 `ht-agent` 里的 `sid = 'main'`，一个 `sid` 只能有一份消息流）。
要并行就用窗口版开第二个智能体窗口。

### 5.3 `document` / `window` / `page`

Worker 里没有 DOM。但要求是「**和 F12 控制台一致，哪怕把页面弄坏**」，
所以这一层不是「安全子集」，而是能做的全做，做不到的只剩一处物理限制。

**写是真的写**

```js
document.write('<h1>x</h1>')      // 真的 document.write，整页被清空也照做
document.body.innerHTML = '…'     // 真的写宿主 body
el.textContent = 'y'              // 真的赋值，不补发 input/change（原生也不发）
el.style.color = 'red'
el.classList.add('on')
document.body.appendChild(el)
document.querySelector('#x').remove()
```

`document.write` 在文档加载完后调用会隐式 `document.open()` 清空整页——终端也会没。
这是浏览器行为，不拦、不改道、不搬到窗口里。0.0.0.3 那版把它重定向到「文档窗口」，
是自作聪明，0.0.0.4 删掉了。

**读尽量同步**

执行一条命令前，Worker 会从代码文本里抠出写死的选择器
（`querySelector('#topbar')`、`page.q('.x')`、`getElementById('y')`、`page.el(…)`），
一次 `prefetch` 拉回这些元素的 `innerHTML` / `textContent` / `value` / `rect` / `computed`。
于是下面这些在 Worker 里是**同步**有值的：

```js
document.querySelector('#topbar').tagName          // "HEADER"
document.querySelector('#topbar').innerHTML        // 真的 HTML
document.querySelector('#topbar').getBoundingClientRect().height   // 54
getComputedStyle(document.querySelector('#topbar')).height         // "54px"
```

**元素是真的节点**

`document.createElement('div')` 让主线程真的建一个游离元素并返回句柄，
`textContent` / `style` / `dataset` 读写都落到它身上，`appendChild` 时才进 DOM。
`parentNode`、`children`、`outerHTML`、`cloneNode`、`insertAdjacentHTML` 都能用。

**事件真的会回放**

```js
document.querySelector('#btn').addEventListener('click', e => console.log(e.target.id));
```

主线程在 `document`/`window` 上注册真实捕获监听，事件发生时把描述发回 Worker，
Worker 侧按 listener id 调你的函数。回调是**异步**的。

**`page.eval(code)` 是 100% 原生的逃生口**

```js
await page.eval('document.querySelectorAll("button").length')   // 30
```

这段代码在主线程用间接 `eval` 跑，和 F12 里敲一行没有任何区别，
包括「返回最后一条表达式的值」这个语义。

**唯一的硬限制**

> 跨线程没有同步通道。读永远取「最后一次快照」，写永远立即生效但异步到达。
> 动态拼接的选择器（`querySelector('#' + id)`）第一次读是空，下一次就有。
> 事件的 `preventDefault()` 改不了已经发生的事。

`window` 挂的是同一套东西：`window === globalThis`、`document.location === location`、
`innerWidth/innerHeight/devicePixelRatio/scrollX/scrollY` 来自快照，
`requestAnimationFrame`（Worker 原生没有，用 16ms 定时器实现）、`matchMedia`、
`getComputedStyle`、`history`（既是 JSHeL 的命令历史函数，也带 `length/back/pushState`）。
`top/parent/frames` 等于 `window` 自己。
`navigator` **不覆盖**——WorkerNavigator 的 `userAgent`/`language` 本来就是真的。

**原生 API：只转发，不重造**

Worker 里没有 `alert` / `confirm` / `prompt` / `open` / `print` / `close` / `focus` / `blur` /
`stop` / `scrollTo` / `scrollBy`。这些**一律转回主线程调真的**，不换文案、不换按钮、
不换返回值类型：

```js
alert('hi')                 // 浏览器自己的弹窗（不是你画的那个 toast）
await confirm('真的要吗？')   // 浏览器自己的确认框，返回 true / false
await prompt('名字？', 'x')   // 浏览器自己的输入框，返回 string / null
window.open('https://…')    // 真的开新标签页，弹窗拦截也由浏览器决定
print()                     // 真的打开打印对话框
```

两条物理限制，写在这里免得日后当成 bug：

1. **同步返回做不到**。跨线程没有同步通道（要 `SharedArrayBuffer`，那需要 COOP/COEP，
   `file://` 打开时必然没有）。所以 `confirm` / `prompt` 的返回值是 **Promise**，必须 `await`。
   `alert` / `print` / `close` 这类没有返回值的，语义和原生完全一致。
2. **`window.open` 的返回值是 `WindowProxy`**，结构化克隆传不回来，只能拿到 `null`。

之前这几个被「设计」过：`alert` 变成一条 toast、`confirm` 变成自绘对话框、
`open` 变成内部浏览器窗口。那是产品行为，不是浏览器行为，全部删掉了。

## 6. 文件系统

一个点分隔的扁平目录树，**路径分隔符是 `.` 而不是 `/`**。

它**不是** ext4：没有 inode、没有权限位（rwx）、没有属主、没有硬链接、没有稀疏文件。
文件类型（`dir` / `file` / `func` / `app` / `device` / `package` / `proc`）是真实存在的元数据，
但那决定「怎么打开它」，不决定「谁能打开它」——这里只有一个最高权限用户。

```text
.                          根
├── .home                  家目录（默认 cwd）
├── .bin                   可执行文件（函数）
├── .app                   应用
├── .dev                   设备（tty / null / zero / random / time / console）
├── .proc                  进程（每个 Worker 一个条目）
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

**父目录必须存在**。因为 `.` 既是分隔符又常被当成扩展名，`write('.home.a.txt')` 会被解析成
「`.home.a` 目录下的 `txt`」；如果 `.home.a` 不存在，以前会默默造一个**谁都看不见的文件**
（`stat` 得到，`ls .home` 永远列不出来）。现在直接拒绝：

```text
父目录不存在: .home.a（点名就是路径分隔符，文件名不要带点）
```

想真的叫 `a.txt`，只能接受它被解析成目录——或者干脆别带点，`atxt` 更好用。

### 存储三层

| 层 | 位置 | 用途 |
| --- | --- | --- |
| 内存索引 | `FS.idx`（Map） | 每次操作的快速判定 |
| 索引快照 | `localStorage['ht.fs.index']` | 冷启动时先恢复索引，避免全表扫描 |
| 真身 | IndexedDB `hterm-fs` / store `files` | 文件正文、mtime、kind、meta |

`.temp` 是**例外**：它只活在内存里，页面刷新就没了，专门放临时变量和中间结果。

## 7. 一切皆文件

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
await write('.bin.add', 'return args[0] + args[1]', { kind: 'func' });
await exec('.bin.add', 2, 3);           // 5

await write('.home.conf', JSON.stringify({ theme: 'dark' }), { kind: 'object' });
await cat('.dev.time');                 // 1730000000000
await write('.dev.tty', 'hello\n');     // 屏幕上直接出现 hello
```

### spotfs：节点对象图，不是 ext4

这台机器上的文件系统叫 **spotfs**。它是一张「节点对象图」——每个节点有路径、种类、内容/元数据，
没有 inode、没有 rwx 权限位、没有属主。种类：`dir / file / func / app / device / grant / package / proc / link`。
「权限」不是文件属性；`.perm.*` 是**授权申请单**，点它才会去问浏览器（摄像头 / 通知 / 定位…）。
fext4（虚拟 ext4 镜像）才需要模仿 ext4 的权限，spotfs 和它**不直接兼容**，只能靠转换或勉强使用——这是设计使然。

只有**七个**原子操作，其余命令都是它们的组合：

| 动词 | syscall | 干什么 |
| --- | --- | --- |
| cover | `sptc(p, data, meta)` | 覆盖写入；只覆盖已有节点，不能新建，对目录不生效 |
| new | `sptn(p, opts)` | 新建；父目录下建节点。`.queryfile` 下 = 向用户要文件；`.savefile` 下 = 关闭时保存到本机 |
| append | `spta(p, data)` | 末尾追加 |
| execute | `sptx(p)` | 执行：JS 脚本 / HTML 页面 / 对象 / 目录 / 权限，自动判别 |
| read | `sptr(p)` | 读内容（文件）或索引（目录、对象） |
| delete | `sptd(p)` | 删除：文件删、目录递归删、进程结束、链接解除 |
| mount | `sptm(target, source)` | **占位，未实现**：调用会明确抛错，不会假装挂上 |

`sptm` 之所以先占坑：`sptx` 的判别表、`mount` 命令的展示、这套模型的语义都已经把它算进去了，
缺了它模型不完整；但真做起来要先想清楚「同一份节点归谁持有」「卸载时数据归谁」「路径怎么跨挂载点解析」，
这些问题没有答案之前，给一个**假能用**比给一个**明确的还没做**更糟。
`mount`（不带参数）能列出当前五个内建挂载点：`idb://hterm`、`ls://local`、`tmpfs`、`procfs`、`devfs`、`pkgfs`。

```js
await sptn('.home.notes', { data: 'hi' });   // 新建
await spta('.home.notes', ', there');        // 追加 → 'hi, there'
await sptc('.home.notes', 'over');           // 覆盖 → 'over'
await sptr('.home.notes');                   // { kind:'file', content:'over', ... }
await sptd('.home.notes');                   // 删除
```

`.savefile` 是个特殊目录：在这里 `sptn` 一个节点并写入，关闭（或 `sptd`）时就会**请求保存到本机**，然后节点消失。

### 名字转义：外部文件怎么进入 spotfs

spotfs 用 `.` 当分隔符，节点名里不能再有点、斜杠这些。外部文件（拖进来、导入的 ext4、上传）的名字一律转义：

- ASCII 字母/数字原样；其余（短横线、下划线、点、斜杠、空格、中文、控制符……）按 **UTF-8 字节** 写成 `-HH`；
- 名字首位是数字也算要转义（首位写成 `-HH`）；
- 只要发生过转义，整个名字前加哨兵 `-xx`（大小写不敏感；本文件系统内部一律小写，所以存成 `-xx`）。

```text
hello world.txt  →  -xxhello-20world-2etxt
a/b.txt          →  -xxa-2fb-2etxt     （导出时斜杠保留 -2f，因为 NTFS/ext4 不收）
readme           →  readme             （全字母数字、不以数字开头，原样）
123abc           →  -xx-3123abc
```

导出（拖出去 / 另存）时反向解析；目标文件系统不接受的字符保留 `-HH`。fext4 挂载同样走这套规则，`/` 换成 `.`。

### 拖拽：四种落点，两个方向，还能在窗口之间搬

**从外面拖进来**（OS 的文件）→ 全屏虚线遮罩（图标浮动）+「松手导入到 X」：

| 落在哪 | 去哪 |
| --- | --- |
| 智能体输入框 | `.queryfile` 并挂到对话 |
| 文件管理器 | 它当前目录 |
| 终端 | 它当前目录，并**把路径粘到命令行** |
| 其它地方 | `.home` |

**在窗口之间拖**（同文档内部，走 `DragBus` + `application/x-ht-spot`）：

| 从 → 到 | 结果 |
| --- | --- |
| 文件管理器 → 文件管理器 | 复制节点到对方目录（目录整棵复制）；**按住 Shift = 移动** |
| 文件管理器 → 智能体 | 读出来当附件（图片走 dataURL，文本内联，>256 KB 提示用 `read_file`） |
| 文件管理器 → 终端 | 把路径粘进命令行（不执行） |
| 文件管理器 → 浏览器 | 在浏览器里打开：html/text 直接渲染，图片按图片显示，其它交给编辑器 |
| 浏览器标签 → 文件管理器 | 把当前网页存成 `.html`（跨域只能存跳转页） |
| 浏览器标签 → 智能体 | 网页正文当附件 |
| 浏览器标签 → 终端 | 粘贴地址 |

落点自己会亮起来并写出「松手会发生什么」（`data-drop` → `::after` 小标签），不用靠猜。

> 两个实现细节：①`dragenter`/`dragover` 阶段 **dataTransfer 里的内容读不到**，只有 `drop` 能读。
> 所以「拖到哪个窗口先亮」靠一个同文档变量 `DragBus`，`dataTransfer` 只负责跨进程（外部应用）
> 和变量丢失时的兜底。②浏览器窗口的 iframe 会把 drag 事件吃进它自己的文档，父文档收不到——
> 拖拽期间给 `body` 挂 `drag-internal`，把 `.br-shield` 盖在 iframe 上，事件才回到父文档。
> `dragend` 之外还留了 `blur` / `visibilitychange` 兜底，避免遮板卡住把小浏览器挡死。

**拖出去**（交给系统）→ 文件管理器每行 `dragstart` 里同步 `setData('DownloadURL', mime:原名:blob-url)`，
拖到桌面/资源管理器即落盘，名字按转义规则还原；目录没有 `DownloadURL`，拖出去只带路径。

**小浏览器一键保存**（`br-bar` 上的「保存 / 下载」）：

- **保存** → 写进 spotfs 的 `.home`（`<标题>.html`，撞名自动 `-2`），文件管理器立刻能看到，
  之后可以拖出去或 `cat` 出来看；
- **下载** → 直接落本机磁盘；
- 跨域页面读不到 DOM（浏览器安全模型），这时保存的是**跳转页**（带原地址的链接），
  文案会写明，不假装保存成功。

`⧉` 按钮给文件管理器：**在同一个目录再开一个窗口**，两个窗口并排就能互相拖。

## 8. 窗口与线程

窗口类型：`shell`（终端）、`python`、`browser`（iframe）、`files`、`editor`、`agent`、`html`、`about`。

```js
winOpen({ type:'browser', url:'https://example.com' });
spawn('1 + 1');                    // = winOpen({type:'shell', code:'1 + 1'})
winList();
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

好处不只是「不卡界面」：Worker 崩了不会带走页面，主线程能捕获到并执行「退出→回退」逻辑；
`ps()` / `kill()` 也有了真实对象可管。

## 9. Python 环境

底层终端里敲 `python()`（或按 `Ctrl+Shift+P` 开独立窗口）进入 **Pyodide**（Python 3.12.1，WASM）。

```text
> python()
Python 3.12.1 (Pyodide) ...
>>> print('hello from python')
hello from python
>>> exit()            ← 回到 JS shell
```

- 首次进入要从 CDN 拉 Pyodide（约 10 MB，之后走浏览器缓存；冷缓存下 10–60 秒都正常）
- stdout / stderr 被重定向到终端，batched 输出会补上换行
- `exit()` / `Ctrl+D` 回到 shell 层，不会连带关掉浏览器页面
- **`Ctrl+C` 打断不了 Python 的同步执行**：Pyodide 和终端跑在同一个 Worker 里，
  中断要 `SharedArrayBuffer`（需要 COOP/COEP 跨域隔离，本项目没开），所以
  `while True: pass` 会把终端卡死，只能刷新页面。启动横幅里也写了这句。

## 10. 包管理器

```js
const _ = await require('lodash-es@4');   // 返回值就是模块命名空间
_.chunk([1,2,3,4], 2);                    // [ [1,2], [3,4] ]
```

> `require` **不会**偷偷往全局塞 `_`。想要短名字就自己 `const _ = …`——
> `hoist()` 会把顶层 `const` 提升成全局变量，后续命令行都能用。
> 回显时只显示 `Module(n exports) { … }`，不会把整包导出刷满终端。

- **智能 CDN 回退**：`esm.sh` → `jsdelivr` → `unpkg`，哪个通用哪个
- 索引写入 `localStorage['ht.packages']`（同时映到 `.pkg.<spec>`），**下次打开自动加载**
- `uninstall('lodash@4')` 移除索引；`.pkg` 目录里跟着消失
- 加载失败会带上三个 CDN 各自的错误，方便判断是网络问题还是包本身问题

> 只用 ESM 包。CJS-only 的包即使 esm.sh 能转，也不保证 `import()` 后行为正确。

## 11. 挂在 window 上的标准函数

一套又短又统一的入口，全部挂 `window`（既在 `hterm.*` 下，也直挂顶层常用别名）：

> 这些函数都是异步的（返回 Promise），REPL 里请写 `await`。
> 长名与短名等价，两套都能用：`remove`=`rm`、`move`=`mv`、`copy`=`cp`、
> `openWindow`=`winOpen`、`closeWindow`=`winClose`、`listWindows`=`winList`、`openURL`=`openUrl`。

```js
// —— 文件 ——
saveFile(name, body)        // 触发浏览器下载
askFile()                   // 弹出选择框，写进 .queryfile.<名>，返回路径
readFile(p) / writeFile(p, data, meta)
listDir(p) / stat(p) / remove(p, {r}) / mkdir(p) / move(a,b) / copy(a,b)
sptc(p,data) / sptn(p,opts) / spta(p,data) / sptr(p) / sptx(p) / sptd(p)   // spotfs 六个原子操作
sptm(target, source)                                  // 第七个：挂载。占位，调用会抛「还没做」
spotEscape(s) / spotUnescape(s) / spotExportName(s)   // 名字转义（-xx 哨兵 + -HH 字节）
importFiles(fileList, dir)                            // File 列表 → spotfs（拖拽/上传共用）
dropIntoDir(items, dir, {move})                        // 窗口间拖拽的落点：复制/移动一批项
DragBus.get() / DragBus.write(dt, items) / DragBus.clear()   // 拖拽信道（同文档变量 + dataTransfer）

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
agentTui.open() / agentTui.send(t) / agentTui.queue(t) / agentTui.stop() / agentTui.close()
                            // open() 会把 REPL 切进 agent 模式（提示符变 agent>），不是只打横幅

// —— HSL / 嵌套自己 ——
hsl()                       // 进交互式 Linux 风格 shell（可嵌套）
hsl('ls -la')               // 跑一行，输出直接进终端
hsl.run('cat x')            // 跑一行不打印，返回 { code, out, err }
shell.open(cwd) / shell.here() / shell.cd(p) / shell.exec(line)
jshel()                     // = shell.open()：在窗口里再开一个 JSHeL，可以无限套

// —— DOM（Worker 里也能摸到） ——
document.title / document.querySelector(sel) / document.all(sel)
page.q(sel) / page.all(sel) / page.toast(msg) / page.openWindow(opts)

// —— 其它 ——
toast(msg) / modal({...}) / confirm(text) / clipboard.write(t) / clipboard.read()
about() / sleep(ms) / uuid() / storage(IDB)
```

设计上只有一条规则：**所有需要「授权 / 外部副作用」的动作，都必须经过这里的某个函数**。

## 12. AI 智能体

轻量 harness，**不是**框架。它做三件事：拼 prompt、跑工具循环、把会话存下来。

- **对话存在 IndexedDB「ht-agent」**（库名独立于文件系统与依赖缓存）：
  `sessions` 一张表存列表，`messages` 一张表按 `sid + seq` 存正文，顺序不靠时钟
- **刷新不丢**：打开智能体时会打一行「已恢复 N 条消息（最后更新 …）」，
  不然用户会以为上次是自己幻觉
- 同时保留 `.agent.session` 这份 JSONL 镜像（导入导出、手工截断都方便）
- 图片附件超过 40 KB 存成 **Blob**（IDB 原生支持），不存 dataURL —— 一张截图几百 KB，
  几十轮就顶到配额
- 写盘有节流：流式输出期间 800ms 防抖，一轮结束、清空、导入、关窗时立即落盘
- 工具集：`js`（在当前沙箱里直接执行 JS）、`read_file`、`write_file`、`list_dir`、`delete_file`、
  `open_window`、`close_window`、`fetch_url`、`save_file`、**`screenshot`**、**`window_html`**、**`ui`**
- **不问许可**。`js` 工具直接在当前上下文执行，没有沙箱、没有审批弹窗。这是设计选择，不是遗漏
- 停止按钮 = `AbortController.abort()`，随时掐断
- **最大循环 120 步**（设置里可调，0–120）。到顶就停，不会无限烧 token
- **重复生成防护**：连续 3 次输出相同签名（工具调用或文本）→ 卡断本轮、自动以「用户」身份追问
  「是否卡住、请检查」，再带着追问继续跑，而不是硬停。阈值 `REPEAT_LIMIT = 3`

`js` 工具走控制台语义（先当表达式求值，`SyntaxError` 才当语句块），所以 `1+1` 返回 `2`。

### 三个「省 token 又不砸界面」的工具

| 工具 | 干什么 | 为什么需要 |
| --- | --- | --- |
| `screenshot` | 截 `#desk` / 某个窗口 / 整个视口，返回 dataURL，模型能直接看图 | 布局坏了、颜色不对，说一百句不如看一眼 |
| `window_html` | 把一段 HTML 直接渲染成窗口（`srcdoc`），不用先写文件再打开 | 让模型「画个窗口给我看」一句话就够 |
| `ui` | 窗口清单（`list`）/ 弹提示（`note`）/ 关窗口（`close`） | 比让模型 `document.querySelector` 猜选择器可靠得多 |

`screenshot` 用 `html2canvas`（CDN 按需拉一次，之后进 DepCache），所以能截「页面里的某个元素」
而不是整个屏幕；不需要用户授权录屏，也不受 `getDisplayMedia` 的气。截 `#desk` 约 300 KB
的 dataURL，直接当 `image_url` 喂给模型。

### 防重复与失败重试

模型有时会在同一轮里把同一个工具调两遍（harness 的经典坑）。处理办法是给每次调用算一个
`stableKey = name + JSON.stringify(args)`，**同一轮内**重复的直接返回上一次的结果，不再真执行。
不同轮不拦（重试是合理的）。

网络失败按三级降级：`直连/后端` → `r.jina.ai`（把网页转成纯文本）→ `allorigins`（CORS 代理）。
三级都挂才把错误抛给模型，让它自己决定换 `js` 还是放弃。

### 界面里的 Markdown

助手的回复用 `marked` + `DOMPurify` 渲染（都从 CDN 按需加载、缓存在 IndexedDB），
代码块、表格、列表、行内代码都能正常显示；`sanitizeHtml()` 之后才进 DOM，
模型输出的 `<script>` 不会执行。用户消息保持纯文本 `<pre>`，避免「我打的字被当成 Markdown」。

输入框支持**多模态**：粘贴/拖入图片会变成缩略图附件，随消息一起发（OpenAI 的 `image_url` 格式）。
附件在发送前以 base64 存在内存里，不落盘。

### 两种接入方式

| 方式 | 密钥在哪 | 适用 |
| --- | --- | --- |
| **后端**（默认） | 只在 modelserver 的环境变量里，前端永远拿不到 | 长期使用、共享设备 |
| **直连** | **只在内存里**（`VOLATILE` 列表，`_persisted()` 写盘前剥掉） | 临时测试，图省事 |

> 直连的 Key **不落盘**：不进 `localStorage`、不进 `.config.settings`、不进 IndexedDB，
> 刷新即消失。代价是每次刷新都要重填——用密码管理器粘一下就好，比留下一份明文强。

直连就是让浏览器直接 `POST https://api.deepseek.com/chat/completions`，跳过 modelserver。
默认预填 **`deepseek-flash`**（DeepSeek V4.1 Flash，OpenAI 兼容格式），地址 `https://api.deepseek.com`；
实测该端点对浏览器放行 CORS，填上密钥就能用。

> ⚠️ **直连的风险**：API Key 以明文存在浏览器里，任何能打开这个页面、或用过这台设备的人
> 都能读走；请求也直接从浏览器发出（会暴露你的 IP）。只建议用临时/低额度密钥。
> 在意安全就把「直连 API」开关关掉，改用后端模式。设置页在直连模式下会一直显示这段警告。

DeepSeek 的思考模式默认开启：直连时默认请求 `thinking.type = "disabled"`（快、省 token，
测试更顺手）；打开「深度思考」开关才会带 `enabled`，并把每轮的 `reasoning_content` 原样回传——
**带 `tools` 时不回传会 400**，这是 API 的硬要求，`apiMessages()` 里已处理。

JSONL 会话长这样（每行一条）：

```jsonl
{"role":"system","content":"你是 HTerMinaL 里的助手……"}
{"role":"user","content":"看看 .home 里有什么"}
{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\".home\"}"}}]}
{"role":"tool","tool_call_id":"c1","content":"[\"welcome\",\"notes.md\"]"}
{"role":"assistant","content":".home 里有两个文件：welcome 和 notes.md。"}
```

## 13. 后端 modelserver

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
| `GET` | `/` `/index.html` | **直接返回同目录下的 `index.html`**，于是 `python3 modelserver.py` 一条命令就能把这个终端跑在 `http://127.0.0.1:8787` |
| `GET` | `/health` | `{"ok":true,"version":"0.0.0.5",...}`，前端启动后自动探测 |
| `POST` | `/v1/chat/completions` | Chat Completions 标准格式，**前后端之间只用这一种** |
| `OPTIONS` | `*` | CORS 预检，返回 204；**必须带 `Origin` 且通过校验**，否则 403 |
| 其它 | 任意 | **一律 403**，不列目录、不代理静态文件、不返回错误页 HTML |

「只放行这四条」是刻意的：这个服务能读你的密钥，任何多余的静态文件路由都是攻击面。
`index.html` 用 `Cache-Control: no-store`，免得改了前端还得手动强刷；
文件路径按 `scriptDir()`（可执行文件/脚本所在目录）拼，不依赖 `cwd`——从别的目录启动也能找到。

请求头：`X-HTerm-Client: hterminal`（必带，否则 403）、`X-HTerm-Provider: openai|anthropic|responses`。
上游格式由它自己双向转换，包括 `tool_calls` ↔ Anthropic `tool_use` / Responses `function_call`。

### 安全模型

四条边界，全部在服务端判断，**不依赖前端自律**：

1. **socket 层**：`remoteAddress` 必须是 loopback（`127.0.0.1` / `::1`），`::ffff:` 前缀先剥掉。
2. **Host 白名单**：必须是 `127.0.0.1:PORT` / `localhost:PORT` / `[::1]:PORT`。
   挡 **DNS rebinding**——`evil.com` 解析到 `127.0.0.1` 时浏览器会把这个请求当同源，
   但 `Host` 头仍然是 `evil.com`，这一层直接拒。
3. **Origin 白名单**：必须是 `http(s)://127.0.0.1[:port]` / `localhost` / `[::1]`。
   **`Origin: null` 一律拒绝**——`file://` 页面、`data:` 页面、sandbox iframe 的 Origin 都是 `null`，
   放过它等于任何网站都能用 `<iframe sandbox srcdoc="fetch('http://127.0.0.1:8787')">`
   绕过同源策略打你的本地端口。
4. **`Sec-Fetch-Site: cross-site` 一律拒**。这是浏览器自己打的标，页面改不了，
   等于把「公网网页 → 本地端口」这条最现实的路彻底堵死。

CORS 头只在 Origin 通过校验后**回显该 Origin**，绝不回 `*`，也绝不发 `Allow-Credentials`；
`OPTIONS` 预检必须带 `Origin`，否则 403。

每个响应（页面、JSON、错误都算）都带：

| 头 | 值 | 作用 |
| --- | --- | --- |
| `X-Frame-Options` | `DENY` | 不许被 iframe 套（点击劫持 / 借道读响应） |
| `Content-Security-Policy` | `frame-ancestors 'none'` | 同上，CSP 版 |
| `X-Content-Type-Options` | `nosniff` | 禁止 MIME 嗅探 |
| `Referrer-Policy` | `no-referrer` | 不外泄地址 |
| `Cross-Origin-Resource-Policy` | `same-origin` | 别的源不能读响应体 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 隔离 window 引用 |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | 不给敏感设备 |

请求侧还有两条：

- **必须带 `X-HTerm-Client: hterminal`**——自定义头会触发预检，普通 `<form>` / 裸 `fetch` 打不过来
- **`Content-Type` 必须是 `application/json`**，其余 415——堵掉 `text/plain` / `form-urlencoded`
  这类「不预检就能发出去」的简单请求

> **`file://` 打开的前端连不上后端了**（Origin 是 `null`，被拒）。这是故意的：
> 用后端时请从 `http://127.0.0.1:8787/` 打开。纯前端模式（直连 + 自带密钥）不受影响。

另外：非流式（拒绝 `stream:true`）、body 上限 8 MB、上游超时 `HT_TIMEOUT`。
被拒的请求会在 stderr 打一行 `deny origin/host/fetch-site: …`，方便排查。

## 14. 常见问题

**Q：打开是一片白／一直卡在启动屏？**
A：多半是 CDN 拉不到 xterm.js。看启动屏最后一行日志与错误面板；离线环境请把 xterm 资源下到本地再改 `build/40-term.js` 的 `XTERM_CSS/XTERM_JS`。

**Q：`ls` 说「名称必须以字母或中文开头」？**
A：你输入的路径段不合规。`.` 是分隔符，所以 `2024report` 这种数字开头的名字不合法。

**Q：窗口拖到顶栏下面了？**
A：窗口只在 `#desk` 内定位，拖不出桌面区。拖到边缘会吸附。

**Q：手机上 `Ctrl+C` 怎么按？**
A：顶栏 `⌃` 短按锁定，再敲 `c`。

**Q：数据能带走吗？**
A：「更多 → 文件系统 → 导出为 JSON」，导入在同一个地方。

---

## 15. 沙箱里的工具

工具不是「演示用的小玩意」，是这个沙箱**日常真的会用**的那一面。
全部自研，只用浏览器自带 API；没有一个工具需要联网（Markdown 的 `marked` 除外，它走 CDN，
加载不到会自动退到内置的迷你渲染器）。

入口有三个，都是同一个东西：

```text
顶栏 ▦ 启动器 → 计算器 / 数据转换 / 调色盘 / Markdown / 截图 / 链接即状态
终端里        → tool calc        （不带参数敲 tools 看清单）
文件系统      → .app.calc 也能 open
```

| 工具 | 状态 | 能做什么 |
| --- | --- | --- |
| **计算器** `calc` | 完整 | 递归下降表达式解析（不是 `eval`）、`DEG/RAD`、记忆、历史、键盘直输、阶乘/幂/多参函数 |
| **数据转换** `data` | 完整 | 编码互转（文本/Base64/Base64URL/Base32/Hex/二进制/十进制大整数/URL/HTML 实体）、时间戳与时区、哈希（SHA-1/256/384/512 + MD5）、随机数 |
| **调色盘** `color` | 完整 | 色相环 + RGB/HSL/HSV/CMYK/YUV/Lab 六种表示联动、EyeDropper、从页面截图取色、WCAG 对比度、历史色 |
| **Markdown** `markdown` | 完整 | 分栏实时预览、白名单清洗（`<script>`/`on*`/`javascript:` 一律删）、导出 HTML、下载 `.md` |
| **截图** `shot` | 完整 | 桌面 / 指定窗口 / 整个文档，1–3× 缩放，PNG/JPEG/WebP，存进 `.home` 或直接下载 |
| **链接即状态** `urlhash` | 完整 | 把文本或 JS 压进 URL 的 `#` 片段，复制链接即可还原；带 `run=1` 时**先弹确认框**再执行 |
| **录音机** `recorder` | 壳 | 维护中，暂不可用 |
| **定位** `geo` | 壳 | 维护中，暂不可用 |
| **3D 视图** `view3d` | 壳 | 维护中，暂不可用 |
| **音频播放** `audio` | 壳 | 维护中，暂不可用 |

> 四个壳子不是「忘了做」，是**没想清楚就不假装能做**。每个壳子里都写了「计划怎么做」和
> 「为什么先不做」——录音要处理权限与关窗时的落盘，定位只在 HTTPS/localhost 给，
> 3D 要么引 three.js 要么自己写矩阵与着色器，音频的解码格式受浏览器限制。
> 与其给一个半残的按钮，不如把边界说清楚。

### 15.1 CLI：同一套算法的另一个入口

编码、哈希、随机这些**必须能在管道里用**，否则「数据套件」就只是个网页。

```text
b64 hello                  → aGVsbG8=
b64 -d aGVsbG8=            → hello
b64 -u 你好                → 5L2g5aW9        （URL 安全，去掉 = 和 +/）
b32 hello                  → NBSWY3DP
hex readme                 → 直接对文件取十六进制（-s 带空格）
hex -d 68656c6c6f          → hello
bin hello                  → 01101000 01100101 …
dec hello                  → 十进制大整数（整串字节当一个数）
url "a b"                  → a%20b
cat readme | hash          → 从管道算 SHA-256
hash -a md5 readme         → 文件哈希（多文件逐个输出）
hash abc                   → 不是文件就当文本，不报「没有那个文件」
rand -l 32 -s safe         → 去易混字符的随机串（CSPRNG，拒绝采样）
rand -s uuid               → UUID v4
ts 1700000000              → 秒/毫秒/ISO/本地/UTC 五行
mount                      → 列挂载点（挂载本身还没做，见 §7.1）
tools / tool color         → 工具清单 / 打开某个工具
```

`hash` 的 SHA 家族走 Web Crypto，MD5 是仓库里自己实现的（Web Crypto 不支持 MD5，
但校验老文件时上游常常只给 MD5，所以它必须在，并且界面上明确标了「只能校验完整性」）。

### 15.2 为什么这些工具值得存在

它们对应四种真实用法：

1. **写页面时**：调色盘给出六种表示，是因为设计稿可能来自 Figma（HEX）、印刷（CMYK）、
   视频（YUV）或论文（Lab），来回换算不该开五个网页。
2. **调试时**：编码与哈希是排查「这串东西到底是什么」的常用手段，放在终端里可以直接接管道。
3. **给别人看时**：链接即状态把一段代码压进 URL，发过去对方打开就能看到同样的东西，
   而且 `#` 后面的内容不会进服务器日志。
4. **留下证据时**：截图能把桌面或某个窗口拍下来存进 `.home`，之后可以拖出去。

---

## 16. 设计理念 · 给用户的话

### 16.1 我们想造什么

我们希望造一个真正有用的沙箱运行时环境，而不是一个只能演示的WebOS（是的，它们也很不错，比我做的好多了，但他们，我觉得更多是界面设计项目，而我是沙箱项目，我们道路不同罢了），希望大家一起探索，发挥它不同的价值；希望它能接入AI能力，帮助你探索HTML设计；我们利用浏览器自身的沙箱，来尽可能地确保你在使用时的数据安全（我们主要保护您的本地内容和浏览器沙箱之间的隔离，而不是沙箱和网络之间的隔离，这点需要注意），你可以随便游玩（不碰外面你自己电脑电脑内容的话），而不用过度担心未经授权的个人数据泄露；

### 16.2 我们认为沙箱至少有几个功能

- 设计HTML，运行基本JS操作页面
- 运行AI agent帮你处理一些问题
- 使用一些小工具（请避免涉及隐私或机密或未授权或违法违规等不适宜内容；一个粗略的判断标准：你敢把这个直接发给AI（比如豆包，deepseek，...），那么你就可以用，否则别用；比如密钥，个人信息，密码，身份证，未经授权的他人肖像，版权内容，违法内容，这些请勿涉及；我们无法审核您沙箱内的内容，如造成不良后果请自己负责）
- 自由探索，研究，游玩，探索更多内容

### 16.3 安全提醒

尽管我们利用了一些基础安全设施，我们也不是完全安全的；还请您注意保护自己，不要随意运行不明脚本，以防**浏览器沙箱逃逸**或者**社会工程学攻击**（比如欺骗输入账号密码，密钥，助记词，个人信息，你不希望上传的文件等），还或者是诱骗授权您的位置，录音等你不希望授予的权限；记住，文件进入了沙箱，你自己的AI，或者其他你运行的脚本，就可以获取，请做好泄露的准备；另外，如果你对AI智能体有顾虑，你也可以不接入，那么这就和AI无关了（AI本来就需要你主动接入提供密钥或后端运行的，而非自动配置好的）；我们无法提供所谓“本地模式”的安全方案，并明确不支持这类需求，因为方便和安全，很多时候是互相排斥的，如果您有顾虑，请勿使用本软件，并换成其他本地工具，而且我们从技术上就不支持离线使用，因为依赖本身就需要联网下载；

### 16.4 关于破坏性更新

代码会持续进行破坏性更新，所以请勿（是不建议，不是强制禁止）依赖它写插件，开发你自己的项目等，要写也请只写通用的HTML/JS内容 我们有办法处理

---

# 第二部分 · 维护指南

## 1. 交接速览

- **产物只有一个文件**：`index.html`。它由 `build.sh` 从 `build/` 分片拼装，**不要手改**。
- **改代码 → 改分片 → 跑 `./build.sh` → 无头浏览器验证 → 提交**。
- **版本号在 `build/30-core.js` 的 `HT_VERSION`**（前端唯一来源，Worker 通过 `init` 消息拿）；
  三份后端各自有 `VERSION` / `version`，必须同步。
- **任何改动都要在[开发日志](#9-开发日志)置顶加一行，并在[智能体操作记录](#10-智能体操作记录)加一条。**
- 许可证红线见[许可证](#11-许可证)：不兼容的内容**一票否决**。

## 2. 版本号与提交规则

- 格式四段式 **X.Y.Z.W**，初始 `0.0.0.0`。
- 若用户未指定，**默认第四位加一**（如 `0.0.0.7 → 0.0.0.8`）。
- **第三位加一表示「上了一个台阶」**：功能面基本成型、可以拿给人用，而不是又修了几个 bug。
  `0.0.1.0` 就是这样一次——初步制作阶段结束（见开发日志）。
- 每次版本变更**必须**在第 9 节「开发日志」置顶追加一行，并在第 10 节「智能体操作记录」追加一条。
- 版本号常量：
  - 前端 `build/30-core.js` → `const HT_VERSION = '0.0.1.0';`
  - 后端 `modelserver.py` → `VERSION`、`modelserver.js` → `VERSION`、`modelserver.go` → `version`
  - 两者必须一致；前端会把 `HT_VERSION` 注进顶栏、抽屉、启动屏、`.sys.version`、`uname`

**提交信息**用中文，首行一句话说清「改了什么」，正文列要点与验证方式。分支固定 `main`。

## 3. 目录与文件地图

```text
index.html                 ← 产物：自包含单文件（由 build.sh 拼装，不要手改）
build.sh                   ← 拼装 + 两份 node --check 语法校验
IDEAS.md                   ← 想法池：还没开工的点子（HSL 在这里）
build/
  00-head.html             ← doctype / 许可注释 / meta / 全部 CSS（暗亮双主题 token、
                             光标层、窗口动效 keyframes）
  10-body.html             ← DOM 骨架：顶栏、桌面、启动屏、启动器、抽屉、模态
  20-worker.js             ← Worker 内核：ANSI、行编辑器、execute()、DOM 代理、agentTui
  25-compat.js             ← HSL：MiniShell（管道/重定向/变量）+ coreutils + vim/nano + fastfetch
  30-core.js               ← 主线程底座：HT_VERSION / Settings / 路径规则 / FS / IDB / Pkg
  40-term.js               ← xterm 装载、Keys（顶栏控制键）、自定义光标、TerminalSession、
                             WindowManager（拖拽/缩放/窗动效）
  50-apps.js               ← BrowserApp / FilesApp / EditorApp（srcdoc、协议拦截、内部新标签）
  55-tools.js              ← 工具底座：ToolKit / CalcParser / CalcApp / ShotApp / MdApp / MaintApp
                             + modalPrompt / pickFileInFs（通用对话框）
  56-data.js               ← 编解码原语（Base64/Base32/Hex/二进制/大整数）、MD5、DataApp
                             （编码/时间戳/哈希/随机）、UrlHash + UrlHashApp
  57-color.js              ← ColorMath（RGB/HSL/HSV/CMYK/YUV/Lab 互转）、ColorApp
                             （色相环 canvas、六表示联动、取色、对比度）
  60-agent.js              ← 智能体：prompt、工具定义、循环、JSONL 会话、Markdown 渲染
  65-tui.js                ← 终端内智能体宿主（AgentTuiHost）+ DOM RPC + 截图
  70-boot.js               ← RPC 分发、AppMenu、Drawer、window API、快捷键、启动流程、DepCache
modelserver.py             ← 后端（Python）
modelserver.js             ← 后端（Node）
modelserver.go             ← 后端（Go）
LICENSE / LICENSE-APACHE / LICENSE-MIT
licenses/                  ← 第三方许可见 licenses/README.md
```

> 拼接顺序有依赖：`25-compat.js` 必须在 `20-worker.js` 之后（同一个 Worker 作用域，要用前者的
> `ANSI`/`out`）；`65-tui.js` 必须在 `60-agent.js` 之后、`70-boot.js` 之前（RPC 分发要调它的方法）。
> `build.sh` 只做字符串拼接与 `node --check`，没有打包器、没有 sourcemap——所以调试时
> 直接改 `build/` 里的文件，改完再 `./build.sh`。

## 4. 架构

```text
  ┌──────────────────────────────────────────┐
  │  UI 层   xterm / 顶栏 / 窗口 / 抽屉        │  只管画，不做业务
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

Worker 里有**两个执行引擎**，按输入分流：

```text
                    ┌─ isShellLine() 首词是命令 ─→ MiniShell（compat）
输入一行 ─→ 解析 ──┤                                 │ 管道 / 重定向 / 变量 / 通配符
                    └─ 否则 ───────────────────→ JSHeL execute()（AsyncFunction）
                                                      │ 一切皆文件 / Worker RPC
```

`isShellLine()` 的规则很短：取第一个词，看它是不是命令表里的成员。**不**看括号，所以
`mkdir("a"); write("b")` 仍然是 JS；`ls .home` 是 shell。成员访问（`ls.xxx`、`page.q`）必须紧贴点号，
不会被误判成「命令 + 参数」——这条规则被 `ls .home` 与 `ls.home` 的区别逼出来的。

两个引擎共享同一个 `cwd`、同一套 `FS`、同一个 `out`，所以 `ls`（shell）和 `ls('.home')`（JS）
看到的必须是同一批文件。这也是为什么兼容层的 `fs.*` 全部走 `IO.call` 回主线程，
而不是在 Worker 里另建一套内存文件系统。

## 5. 前端布局规范

> 这一节是「改 UI 之前必须看」。结构照搬参考项目 `draw-http-terminal`，
> 在其基础上适配了「桌面 + 浮动窗口」这一层。

### 5.1 三段式骨架

```html
<body class="term-body">
  <div class="app">                 <!-- fixed inset:0, flex column, 吃安全区 -->
    <header class="topbar">…</header>   <!-- flex:0 0 auto, 高度 var(--top) -->
    <main class="desk">                 <!-- flex:1 1 auto, min-height:0 -->
      <div id="term-view">…</div>
      <div id="window-layer">…</div>
      <div id="dock">…</div>
    </main>
  </div>
  <aside class="drawer">…</aside>       <!-- fixed, translateX(100%) 滑入 -->
</body>
```

三条硬规则，破了就会出各种怪现象：

1. **`body` 必须 `position:fixed; inset:0; overflow:hidden`**，否则 iOS 上整页会被手势拖出橡皮筋。
2. **`.desk` 必须 `min-height:0`**，否则 flex 子项不肯收缩，终端会撑破页面高度。
3. **窗口的 `style.left/top` 是相对 `#desk` 的**，而 `getBoundingClientRect()` 是相对视口的。
   两者混用会把顶栏高度重复计进位移——0.0.0.0 之前就踩过，表现为「每次拖动都往下多跳一段」。

### 5.2 顶栏

- 高度 `--top: clamp(44px, 7.4vw, 54px)`，跟着屏幕宽度走，窄屏不占太多。
- 分两段：`.tb-mid`（修饰键 + 摇杆 + Esc/Tab）· `.tb-right`（窗口按钮）。
  **没有 `.tb-left`**——品牌、版本、当前目录都删了，`⌃` 就是第一个像素。
  中间**不留 `.tb-gap`**，否则宽屏会在按键与右按钮之间空出一大片。
- `.tb-mid` 宽屏 `justify-content:space-evenly` + 按键 `min-width:52px / max-width:88px`，
  均匀分布且不会被拉成 170px 一个；手机（≤560px）改成 `flex:1` 均分，`⌃` 依旧从最左边开始。
- 摇杆 `.joystick` 的容器比圆盘宽 32px，给四角外溢的 `▲▼≪≫` 留地盘；
  容器绝不能进滚动区（`overflow:auto` 会裁掉外溢符号），所以 `.tb-mid` 用 `overflow:visible` + flex 收缩。
- 按钮统一用 `.k`，视觉状态只有两个：`.k--active`（锁定，实心强调色）与 `.k--pressing`（正被按住，浅强调色）。

### 5.3 符号与字体

顶栏用的是**控制字符与修饰键符号**：`⌃`(U+2303) `⌥`(U+2325) `⇧`(U+21E7) `␛`(U+241B) `⇥`(U+21E5)
`≥`(U+2265) `⛶`(U+26F6) `▦`(U+25A6) `◉` `✕`。这些字符在很多设备上会被：

- 渲染成**彩色 emoji**（大小不受控、颜色不受控）→ 用 `font-variant-emoji: text` 强制按文本呈现；
- 或者**缺字形**变成豆腐块 → 单独给一条符号字体栈：

```css
--mono-sym: "JetBrains Mono","Noto Sans Symbols2","Segoe UI Symbol",
            "Apple Symbols","Noto Sans Symbols","DejaVu Sans",sans-serif;
```

凡是「纯装饰」的图标（品牌、按钮里的图形）一律用**内联 SVG**，不用符号字符——
字符只用在「它本身就是那个键」的地方（`⌃` 就是 Ctrl 键）。0.0.0.0 里品牌标记
`▚` 曾退化成一条竖线，改成了 SVG；抽屉头像 `▚` 改成了 `>_`。

### 5.4 更多抽屉

```html
<aside class="drawer">
  <div class="drawer__user">   <!-- 头像 + 名称/版本 + 副标题 + 关闭 -->
  <div class="drawer__body">   <!-- 唯一可滚动区，页脚也在这里 -->
    <section class="drawer__section">
      <div class="drawer__title">外观</div>
      <div class="drawer__row"><span>主题</span><b>深色</b></div>
    </section>
    …
    <footer class="drawer__foot">…</footer>
  </div>
</aside>
```

- `.drawer__row > span` 固定 72px，保证所有标签左对齐、控件在同一列。
- **页脚在 `drawer__body` 里面**，不是 `aside` 的直接子元素：这样它跟着内容一起滚到底，
  短内容时不会浮在半空、长内容时不会压住最后一行。
- 抽屉整体 `touch-action:pan-y`、`overscroll-behavior:contain`——纵向滚交给浏览器，
  不让手势穿透到下面的终端；滑块单独 `touch-action:none`，否则拖字号会把抽屉拽走。
- 开关状态用 `.drawer.on` + `aria-hidden`，遮罩 `.drawer-overlay.on`。

### 5.5 常见 HTML 页面要求

`index.html` 的 `<head>` 里这些一个都不能少（都不影响功能，但少了就是不合格的页面）：

```html
<!DOCTYPE html>                       <!-- 必须是文件第一行 -->
<html lang="zh-CN">                   <!-- 声明语言，影响断行与读屏 -->
<meta charset="utf-8">                <!-- 越靠前越好 -->
<meta name="viewport" content="width=device-width, initial-scale=1,
      maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" …>            <!-- 移动端地址栏配色，明暗各一条 -->
<meta name="format-detection" content="telephone=no,email=no,address=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>…</title>
<meta name="description" content="…">
<link rel="icon" href="data:image/svg+xml,…">   <!-- 内联，不额外发请求 -->
```

再加三条：

- `<noscript>` 兜底：没有 JS 时给一句人话，而不是一片空白。
- **语义标签**：`<header>` / `<main>` / `<aside>` / `<footer>`，不要满屏 `<div>`。
- **安全区**：`.app` 用 `padding: env(safe-area-inset-*)` 避让刘海与圆角。

### 5.6 主题

颜色全部走 CSS 变量，明暗两套只在 `body.light` 里覆盖值。**xterm 的主题也读同一套变量**
（`termTheme()` 里 `cssVar('--accent')`），所以改配色只改一处。

**主题跟随系统，不提供手动开关。** `applyTheme()` 读 `matchMedia('(prefers-color-scheme: light)')`，
`watchSystemTheme()` 监听 `change`，系统切深浅时整页（含 xterm）一起换。
设置页「外观 → 主题」只是一行只读文案，显示当前跟随到的是哪个。

> 为什么不给选项：多一个可选项就多一个「用户停在旧主题上」的状态。
> 系统已经有明确的明暗偏好，跟它走最省心；真要强制，改系统设置即可。

一个坑：xterm 默认 `drawBoldTextInBrightColors = true`，ANSI 的「粗体+颜色」实际取的是
`bright*` 系列。浅色主题下如果沿用深色那套淡彩色（`#99f6e4` 之类），粗体标题会糊在白底上。
所以 `termTheme()` 里 `bright*` 必须按主题分别给值。

### 5.7 光标

xterm 自己的光标设成 **`rgba(0,0,0,0)`**（不可见），另起一个 `.ht-cursor` div 叠在 `.xterm-screen` 上，
`position:absolute` + `will-change:left,top`（位置不用 CSS transition，交给 rAF）。四个状态：

| 状态 | 样子 | 触发 |
| --- | --- | --- |
| 聚焦 | 2px 竖线 | textarea 获得焦点 |
| 失焦 | 7px 宽、2px 描边的椭圆（`--hollow`） | 点别处 / 切窗口 |
| 备用屏 | 虚线（`--dashed`），失焦时变点线 | 进 vim / nano / alternate buffer |
| 空闲 | 呼吸（`--breathing`，1.8s `cubic-bezier(.45,0,.55,1)`） | 1 秒没有输入、没有选区 |

移动是**阻尼缓动**：每帧 `x += (tx - x) * 0.22`，差小于 0.35px 时吸附到位并停掉 rAF。
所以连按方向键时光标会「追不上」，停手后平滑收敛——这就是想要的手感。
选中文本时暂停呼吸（`--paused`），否则拖选时一明一暗很烦。

**没有设置项**：样式、闪烁、颜色都不给改。上一版给过 `bar/block/underline` 与闪烁开关，
结果是四种组合里三种难看，直接删掉。

## 6. 构建与验证

```bash
./build.sh
# index.html: 441616 bytes
```

脚本做的事：拼接分片 → 内联 Worker 源码（`20` + `25`）→ 写出 `index.html` → `node --check` 校验主线程与 Worker 两份 JS。

**不要直接编辑 `index.html`**，下次构建会被覆盖。

无头回归（`playwright-core` + 系统 chromium，`/tmp/pw/s1..s13.js`）覆盖了这些，每次改动至少跑一遍相关项：

| 用例 | 期望 |
| --- | --- |
| 启动 | `#boot.gone` 出现，无 `pageerror`；顶栏首键是 `⌃`、右端是 `≥` |
| REPL | `1+1` → `2`；`ls('.home')` 列出文件；`page.q('#topbar')` 返回 `header/1280` |
| 多行输出对齐 | L1/L2/L3 都从第 0 列起（`convertEol`） |
| 历史 | 连按 ↑ 逐条回溯，不是直接跳到上上条 |
| JSHeL 只认 JS | `1+1` → `2`；`ls -la` → `ReferenceError`，且带一句「ls 是 HSL 命令」；`hsl`/`nano readme` 同理 |
| HSL | `hsl('ls')` 列 cwd；`hsl('cat a \| wc -l')` 管道通；`hsl('cd @ && pwd')` 目录跟着走 |
| 原生 API | `alert` / `confirm` / `prompt` 被 Playwright 的 `dialog` 事件抓到——说明是浏览器自己的框，不是自绘的 |
| 全屏应用 | `hsl('nano readme')` 顶栏可见、状态栏在最底行、鼠标点第 5 行第 8 列落点正确、`^X` 干净退出回滚历史 |
| 对话持久化 | 刷新后智能体显示「已恢复 N 条消息」，`indexedDB.databases()` 里含 `ht-agent` |
| 顶栏 `⌃` 锁定 + `c` | 捕获到 `\u0003`；再点一次解锁后 `x` 原样送出 |
| `F5` / `F11` / `F12` | `defaultPrevented` 分别为 `false` / `true` / `false`；F11 后 `body.fs` 切换 |
| 窗口动效 | 开窗有 `htWinIn`、关窗 `htWinOut`、最小化 `htWinMin`、最大化带 `.tween`，动画类会被清掉 |
| 窗口几何 | 最大化后尺寸 = `#desk`；还原回原尺寸；拖动位移 = 鼠标位移（含穿越 iframe） |
| 浏览器 | 传 HTML 走 `srcdoc` 能渲染；`mailto:` 出面板块；`target=_blank` 变内部标签 |
| 截图 | `shot('#desk')` 返回 `data:image/png;base64,` 开头的字符串（约 300 KB） |
| 主题 | `prefers-color-scheme` 切换即时跟随 |
| 文件系统 | 写/读/复制/移动/删除闭环；`.home.a.txt` 报「父目录不存在」而不是造幽灵文件 |
| Python | `python()` → `>>>` → `print` → `exit()` → `1+1` |
| 退出 | `Ctrl+D` / `exit()` → 整页重载（`window.__mark` 消失） |
| 清数据 | `nuke()` 确认后 localStorage / IndexedDB / caches / SW 全清，只剩种子文件 |

## 7. 设计取舍与踩坑记录

按时间顺序，记下真正卡住过的问题，给后来者省点时间。

**1. `self = globalThis` 让 Worker 直接死掉**
Worker 里 `self` 是只读的，赋值抛 `TypeError` → Worker 启动失败 → 发 `exit` → 主线程
`exitDesktop()` → `location.reload()` → 白屏死循环。**教训**：启动路径上任何一处未捕获异常，
如果它的兜底是 reload，就会变成无限重启。

**2. 输出函数被用户 API 覆盖**
`Object.assign(globalThis, api)` 把 shell 的 `write(p, data)` 挂上去之后，
Worker 内部的 `write()`（往终端打印）被顶掉，导致每敲一行都报「名称必须以字母或中文开头」。
**修法**：内部输出统一改名 `out()`。

**3. 严格模式 + 剩余参数**
`AsyncFunction('...args', '"use strict"; ...')` 抛
`Illegal 'use strict' directive in function with non-simple parameter list`。
**修法**：包一层 `return (async()=>{ "use strict"; ... })()`。

**4. `pwd()` 打印两遍**
命令既 `out()` 又 `return`，REPL 又回显一次。**修法**：命令只返回值，回显交给 REPL。

**5. `.localstorage` 里冒出 `map` 伪条目**
映射表存成 `ht.ls.map`，被 `lsKeys()` 当成普通键。**修法**：搬到 `ht.lsmap` 并过滤旧键。

**6. Python 输出粘在提示符上**
Pyodide 的 batched stdout 不带尾换行 → 先补 `\n` 再统一转 `\r\n`（xterm 要 CRLF）。

**7. `exit()` / `Ctrl+D` 退不出去，反而层叠**
行编辑器认出 `EXIT` 后没调 `onEOF`。**修法**：在 `submit` / `submitText` 的 EXIT 分支显式调。

**8. 后端全 403 "缺少 X-HTerm-Client"**
Node 版把请求头写成 `x-htem-client`（少个 `r`），且 Node 的 headers 是小写键。

**9. 浅色主题切完不重绘**
只改 `term.options.theme` 不生效，xterm 缓存了旧的渲染结果。**修法**：`term.refresh(0, rows-1)`。

**10. Playwright 等不到 `#boot.gone`**
元素 `display:none` 后 Playwright 判定为「不可见」。**修法**：`{ state:'attached' }`。

**11. 字体栈里的 `ui-monospace` 在 Windows Chrome 上让行高抖动**
参考项目实测该字体下 `M=8.892px`、`☞=9.0px` 非等宽，会导致整行错位。本项目 `--mono` 栈里不放它。

**12. `exit()` 落到 `about:blank`**
原实现只要 `history.length > 1` 就 `history.back()`；直接打开页面时 history 里那条是空白页。
**修法**：只有存在**真实 http(s) referrer** 时才回退，否则刷新自毁重来。

**13. 顶栏出现后窗口「一拖就往下跳」**
`style.left/top` 相对 `#desk`，`getBoundingClientRect()` 相对视口。混用后顶栏高度（54px）
被重复计进位移，每次拖动都多跳一段、每次最大化还原都往下移一格。
**修法**：所有跨这两套坐标的地方都先减去 `#desk` 的 `rect.left/top`。

**14. 浅色主题下粗体标题看不见**
见 [5.6](#56-主题)：`bright*` 系列没跟主题走。

**15. 输出整段错位：每行开头逐行向右缩进（截图里编号跑到右边）**
根因不是字体，是 **`convertEol: false` + 只发 `\n`**。xterm 里 LF 只下移一行、列位置不变，
所以第二行从第一行结尾的列继续写，行首标号被顶到右侧，越往后越靠右。
**修法**：`convertEol: true`（把 LF 当 CRLF）。同时补上 `@xterm/addon-unicode11`
并设 `unicode.activeVersion = '11'`——CJK/emoji 的 1/2 格宽度算错也会造成同样的漂移；
`allowProposedApi: true` 是改这个字段的前提。

**16. 窗口「拖不动 / 跑偏」**
两个独立原因叠在一起：①拖动只监听 `document` 的 `pointermove`，指针一进 iframe 就断流，
窗口卡住不动；②`_startResize` 把视口坐标 `r.left/top` 直接写进相对的 `style.left/top`，
一动手就往下跳一个顶栏高度（54px）。
**修法**：标题栏/手柄上 `setPointerCapture`（指针跑到哪事件都回来）+ `touch-action:none` +
拖动期 `body.win-drag iframe{pointer-events:none}` 双保险；坐标一律从 `style.left/top` 读，
读不到才用 `rect - deskRect` 换算；`requestAnimationFrame` 合并高频 move。

**17. 内嵌浏览器刷 `ERR_UNKNOWN_URL_SCHEME`**
把 `mailto:` / `tel:` / `intent://` 直接赋给 `iframe.src`，内核不会在 iframe 里处理这些协议，
只会报错 + 白屏。跨域 iframe 的 DOM 读不到，**没法事后捕获**，只能在导航前分类。
**修法**：`classifyUrl()` 白名单——`http(s)/data/blob` 进 iframe；其余协议走「需要外部应用」面板
（复制 / 用系统应用打开），`javascript:`/`about:`（非 blank）直接拒绝；iframe 加 `sandbox`
让内核提前拦掉越权导航；同源页面注入 `click`/`window.open` 拦截，点击阶段就转成面板。

**18. `postMessage` 用了 `location.origin`，消息凭空消失**
`srcdoc` + `sandbox` 的 iframe 是 **opaque origin**，`origin` 字符串是 `"null"`；
用父页面的 `location.origin` 当 `targetOrigin` 会被浏览器**静默丢弃**，
表现就是「点了 mailto 什么都不发生」，控制台连报错都没有。
**修法**：`targetOrigin` 用 `'*'`，安全靠下面的 token 校验。这是个「不报错但就是不工作」的坑，
只能靠 `window.addEventListener('message')` 里打日志才发现。

**19. `e.source === iframe.contentWindow` 恒为 `false`**
iframe 一旦导航（`srcdoc` 也算），`contentWindow` 会换成新的 WindowProxy；
拿旧引用做严格相等，永远不成立，于是消息收到了却不处理。
**修法**：每个 BrowserApp 生成一个 8 位随机 `htTok`，注入脚本发消息时带上，
父窗口比对 token。顺带把「同源可控」的路径改成**直接调方法**（闭包就在父窗口 realm 里，
根本不用过 postMessage），跨源那条才走消息。

**20. `Object.assign(globalThis, windowShim)` 把整个 Worker 打挂**
Worker 的 `location` 是只读访问器，`Object.assign` 赋值直接抛 `TypeError`，
后面的初始化全没执行，`page` 停在 `null`，用户看到的就是「document 找不到」。
**修法**：逐个 `Object.defineProperty(globalThis, key, { get, configurable:true })`，
`location` 单独做成只读代理（写入静默忽略，不抛）。

**21. `agentTui.open()` 返回 `this`，REPL 刷一屏 `[object Object]`**
为了让链式调用 `agentTui.open().send(...)` 能写，`open()` 返回了实例；
但终端会把返回值回显出来。**修法**：返回短 id 字符串，所有方法改成 `agentTui.send(id, ...)`。
链式好看，但在 REPL 里好看不值钱。

**22. `isShellLine` 把 JS 当成 shell**
`mkdir("a"); write("b")` 被当成 shell 命令（因为含 `;`？不，因为首词 `mkdir` 在命令表里），
于是 `write("b")` 被 MiniShell 原样拼进参数，什么也没发生。
反过来 `ls .home` 又被当成「`ls` 对象的 `.home` 属性」。
**修法**：只看**第一个词**是不是命令；成员访问必须**紧贴点号**（`/^\./` 且前面没有空格），
所以 `ls.home` 是属性、`ls .home` 是参数。用空格和点号的相对位置消歧义，
比维护一份「哪些命令后面能跟参数」的白名单稳。

**23. 直连默认还是 GPT**
`DEFAULTS.agentModel` 早就改成 `deepseek-flash`，但老用户 `.config.settings` 里存着
`gpt-4o-mini`，合并时旧值优先。**修法**：启动时做一次**定向迁移**——
只在「值等于旧默认」时才覆盖，用户自己填的模型名不动。

**24. 中断后再提问，API 直接 400**
`tool_calls` 的 assistant 消息后面必须有**每一条**对应的 `tool` 消息；
点了停止，`tool_calls` 已经写进历史，结果却永远不会回来，下一轮请求就是 400。
**修法**：`apiMessages()` 在发请求前统一配平——缺结果的补一条「已取消」的 tool 消息，
孤立的 tool 消息直接丢掉。这个函数是唯一出口，所有请求都经过它。

**25. `write('.home.a.txt')` 造出一个谁都看不见的文件**
点号既是分隔符又被当成扩展名，`parentPath('.home.a.txt')` 得到 `.home.a`，
文件就挂在了一个不存在的目录下：`stat` 得到、`read` 得到、`ls .home` 永远列不出来。
**修法**：`write` 校验父目录存在（`DIRS` 也算存在），不存在就报
「父目录不存在: …（点名就是路径分隔符，文件名不要带点）」。宁可当场失败，也不要留幽灵。

**26. 最大化过渡期间读几何，拿到的是中间值**
最大化给窗口挂 `.tween`，让 `left/top/width/height` 用 CSS transition 插值（外扩 / 内缩）。
过渡没走完时 `getBoundingClientRect()` 读到的是半路尺寸，这期间如果发生拖拽或还原，
`restore` 存下来的「原尺寸」就是错的，窗口会越还原越小。
**修法**：`.tween` 只挂 300 ms（`_tweenT` 定时清掉），动画期间不读几何、不允许拖拽；
逐帧只碰 `transform`/`opacity` 的开窗动画则完全不碰 `left/top`，两套动效互不干扰；
`prefers-reduced-motion` 下整段跳过。

**27. `Object.assign(globalThis, api)` 在 Worker 里必炸**
Worker 的 `location`/`open` 是只读访问器，`Object.assign` 遇到第一个只读属性就抛
`TypeError`，后面的键一个都没写进去——表现是「shell 起不来，只吐一行启动失败」。
**修法**：逐个 `globalThis[k] = api[k]`，失败再 `defineProperty` 兜一次；
`open` 本身也改成一个函数：URL 开浏览器窗口，其余当文件路径（以前 `open('https://…')`
会去文件系统里找一个叫 `https:` 的目录）。

**28. 同步读 DOM：`new Function` 包一层会丢掉返回值**
想在主线程跑用户代码，`new Function('return (async () => {' + code + '})()')` 看着对，
但 `code` 是 `1+1` 时箭头函数体里没有 `return`，结果永远是 `undefined`。
**修法**：用间接 `eval`（`(0, eval)(code)`），在全局作用域执行，天然带「最后一条表达式的值」
这个控制台语义；返回 Promise 再 await 一次。

**29. 整页 `innerHTML` 当快照传，会把 REPL 卡住**
为了让 `document.body.innerHTML` 同步可读，最初每条命令都拉一次 `body/head/html` 的
deep 快照——整页 `innerHTML` 好几 MB，跨线程结构化克隆一次几百毫秒，表现为「敲了命令没反应」。
**修法**：①默认只拉 `title/readyState/尺寸` 这种轻量字段；②从代码文本里正则抠出**写死的**
选择器，只对这些元素做 deep 预取（`#topbar` 这种几十个节点，微秒级）；
③`innerHTML`/`outerHTML` 截断到 20 万字符，超出部分带 `htmlTruncated` 标记。

**30. `hsl` 定义在 `makeShell` 里，返回对象引用它就炸**
`hsl()` 要调 `COMPAT.execLine`，而 `COMPAT` 是在 `bootShell()` 里 attach 的，所以函数写在了
`bootShell()` 内部；可 `makeShell()` 返回的对象里又写了 `hsl,` 这个键——那个作用域里根本没有
`hsl` 变量，整个 Worker 启动即 `ReferenceError: hsl is not defined`，表现是「终端一片空白」。
**修法**：把 `hsl` 的定义移到 `globalThis.jshel = …` 之后、`COMPAT.attach()` 之前（此时
`COMPAT` 已在作用域内），并从 `makeShell()` 的返回对象里删掉这个键。
**教训**：跨闭包传函数，先确认它真的在那个闭包里定义过——`{ hsl, }` 这种简写不会报「未定义」
而是直接炸掉整个模块。

**31. 原生调用走错了 RPC 通道**
`installDomProxy()` 里封装 `nat` 时误用了 `c`（即 `call_('dom.op', …)`），于是 `alert('x')`
报 `dom.op 不支持：native`——主线程拿到的 op 名是 `native`，但走的是 DOM 通道。
**修法**：单独一条 `const nat = (name, args) => call_('native', name, args);`。
两个通道长得像（都是 `call_('<op>', …)`），形参一多就容易抓错变量，起名要能一眼区分。

**32. IndexedDB 事务里 `await`，事务自己先提交了**
`AgentStore.save()` 在事务回调里 `await packMsg()`（把大 dataURL 转 Blob），`await` 一让出
微任务，浏览器发现事务上再没有挂起的请求，就把事务提交了；后续 `put` 立刻抛
`TransactionInactiveError`，消息一条没写进去。
**修法**：**先把要写的数据全部 prepare 好**（在内存里算完 Blob），再开事务；事务回调里只做
同步的 `put` / `delete`。`remove()` 同理：先查 `oldKeys`，再开读写事务同步删。
**结论**：IDB 事务的生命周期绑在「有没有挂起请求」上，不是绑在 JS 栈上。

**33. SGR 7「反显」换的是默认前景/背景，不是颜色本身**
全屏应用的顶栏想画一条反白条，用了 `\x1b[7m`。浅色主题下默认前景是纯黑、默认背景是纯白，
反显之后就是「黑字压深底」——看上去和没画一样。
**修法**：不依赖主题，用显式配色 `\x1b[100;97m`（亮灰底 + 亮白字）。凡是「必须能看清」的
装饰条，都不要交给 `7` 号属性。

**34. 全屏应用的第一行被提示符盖掉**
`LineEditor.submitText` 的 `finally` 无条件补一个提示符，而全屏应用一开就是「定位到 1;1 重画」，
提示符正好压在标题栏上，看起来像「nano 没有标题栏」。
**修法**：`finally` 里加 `&& !this.raw`——进入 raw 模式（全屏应用）期间不补提示符，退出时
`raw = false` 再由正常路径补。

**35. 拼一整段带 `\r\n` 的字符串刷全屏，末尾换行会把屏幕顶上去**
把整屏内容拼成一个字符串、每行以 `\r\n` 结尾，从 `\x1b[H` 一次性写出去：当内容高度**等于**
终端高度时，最后那个换行符会触发一次滚动，整屏上移一行——nano 的标题栏消失、正文整体偏移，
都是这一行换行造成的。
**修法**：`render()` 改成逐行绝对定位——`\x1b[{row};1H\x1b[2K` + 内容，**一个换行符都不发**；
状态栏、快捷键行分别用 `\x1b[{rows-1};1H` / `\x1b[{rows};1H` 定位。
**结论**：全屏 TUI 里，换行符是副作用，不是排版手段。

**36. 中文按 `length` 排版必然错行**
`'中文'.length === 2`，但它在等宽字体里占 4 列；`padEnd(20)` 补出来的空格数也是错的，
于是带中文的行一律往左缩，光标位置和鼠标点选位置全部对不上。
**修法**：一套按显示宽度算的工具——`CW(cp)`（East Asian Width：全角/宽/半角标记记 2）、
`dw(s)`、`sliceW(s, max)`、`padW(s, max)`、`skipW(s, cols)`、`xToCol(line, x)`；渲染、截断、
鼠标点选反算列全部走显示宽度，`String.length` 只在纯 ASCII 分支里出现。

**37. 智能体「原地打转」要卡断，而不是只拦一次**
单轮内同工具同参数 `seen>=2` 拦一下（不重执行、把「已经做过」回给模型）能挡住大部分浪费，
但**挡不住模型接着发第 3、第 4 次同样的调用**——它拿到「已做过」的提示后仍然原地循环。
**修法**：在 `run()` 循环里再算一层「输出签名」（`_turnSig`：工具调用压成「名(参数指纹)」链，
文本取正文前缀），`REPEAT_LIMIT=3`：连续三次签名相同就**直接 `continue` 跳过这一轮的动作**（卡断），
并以 `user` 身份自动追问「【自动检查】…疑似陷入重复循环，请换思路」再让它继续。
`reset` 后从 0 重数，避免每轮都追问。自动追问是 `user` 角色（真发），旁边那条「⚠ 已连续 3 次」是
`system` 角色、只给用户看、`apiMessages()` 里 `continue` 跳过，**不进发给模型的请求**。

**38. 转义名进不了文件系统：`checkName` 不认 `-` 开头，`normPath` 还会把 `-XX` 小写化**
拖进来的文件按规则转义成 `-XXhello-20world-2Etxt`，`FS.write` 第一关 `checkName`（要求字母/中文开头）
直接拒绝；第二关 `normPath` 末尾 `toLowerCase()` 把哨兵和十六进制全变小写，`spotUnescape` 拿 `-XX` 去比
永远不中。**修法**：①新增 `SPOT_NAME_RE` 放行 `-xx` 开头的转义名（长度上限放宽到 240）；
②哨兵与十六进制统一用小写 `-xx` / `-2e`——spotfs 本来就「大小写不敏感、内部一律小写」，
写大写只会被规范化掉，不如一开始就用小写，解析时两种大小写都接受。

**39. `DownloadURL` 必须在 `dragstart` 里同步 `setData`，但文件内容是异步读的**
Chrome 只认 `dragstart` 事件同步阶段塞进去的 `DownloadURL`；`FS.read()` 是 Promise，
等它回来事件早结束了，拖出去要么没数据、要么浏览器不认。**修法**：在 `pointerdown`
（拖拽开始前唯一能安全预读的时机）就把节点读成 Blob 并 `createObjectURL` 缓存；
`dragstart` 里同步 `setData('DownloadURL', mime:原名:url)`，缓存没命中就只带 `text/plain`（不阻塞、不报错）。
`dispose()` 时统一 `revokeObjectURL`，不然每拖一次泄一个。

**40. 「进入模式」不是打印一句话——状态没变，用户看到的就是闪退**
`agentTui.open()` 原来只 `out()` 了一个横幅就 `return`，`state.mode` 仍是 `jshel`、
提示符仍是 `.home> `。于是第一次回车就回到 JS 求值，用户的理解只能是「进去了又自己退出来」。
**根因不是渲染，是状态**：凡是叫 `open()` 的东西，必须真的改变某个被下游读取的状态。
**修法**：`mode` 从二值扩成三值（`jshel`/`hsl`/`agent`），`open()` 改 `mode` + 重画提示符，
`onSubmit` 按 `mode` 三路分派；退出时靠 `_back` 回到进来之前那一层，而不是硬编码回 JSHeL。
顺带两条：`Ctrl+C` / `Ctrl+D` 在内建模式里必须有语义（中断 / 退出），
所以给 `LineEditor` 加了 `onInterrupt` / `onCtrlD` 两个钩子——否则「忙」的时候
`Ctrl+C` 只会打一句「同步执行无法中断」，而那时正是最需要中断的时候。

**41. 拖拽的两个死角：`dragover` 读不到内容，iframe 会把 drag 事件吞掉**
第一条：`dataTransfer.getData()` 在 `dragenter` / `dragover` 阶段**一律返回空串**（规范如此，
只有 `drop` 才给读），`types` 却是可读的。所以「拖到哪个窗口上，哪个窗口先高亮」不能用
dataTransfer 判断内容，只能：①用 `types.includes('application/x-ht-spot')` 判断「是不是我自己的拖拽」；
②真正的载荷放在同文档变量 `DragBus` 里，`drop` 时再以 `dataTransfer` 兜底。
第二条：`<iframe>` 覆盖的区域上，drag 事件会派发到 **iframe 自己的文档**，父文档既收不到
`dragover`（于是不 `preventDefault`）、也收不到 `drop`（于是永远放不下）。窗口拖动能用
`setPointerCapture` 解决，拖拽没有对应 API。**修法**：拖拽期间给 `body` 挂 `drag-internal`，
把一个 `.br-shield` 盖在 iframe 上（`display:block`），事件就回到父文档了。
**收尾比开头更重要**：`dragend` 不一定来（切窗口、系统打断），所以 `blur` 与
`visibilitychange` 各补一次 `DragBus.clear()`——否则遮板会一直盖着，小浏览器从此点不动。

**42. CSS Grid 不给 `grid-template-columns`，它不会报错，只会把顺序排乱**
计算器是 35 个按钮按 5 列写死的，但 `.calc-pad` 只写了 `display:grid;gap:5px`。
浏览器于是按「自动放置」排成 4 列，第 5 个按钮掉到下一行，`=` 的 `grid-row:span 2`
把整块往下推——**看起来像按钮少了、顺序错了，实际上是列数没定义**。
这个坑没有报错、没有警告，只有截图能看出来（`element.screenshot()` 救了我）。
教训：Grid 容器和它的列数是**两件事**，写了 `display:grid` 不等于写好了布局。

**43. 懒加载的库要把「正在加载」缓存下来，不然每敲一个字就发一次请求**
Markdown 预览的 `ensureMarked()` 一开始是「没加载就去拉 CDN」。输入框每 180ms 触发一次渲染，
于是每 180ms 就发一次 `loadScriptCached` —— 首次加载慢的时候，预览会长时间停在旧内容上，
网络面板在刷请求。**修法**：把 Promise 本身存起来（`_markedP`），失败的记一个时间戳，
一分钟内不再重试。顺带把渲染加上序号（`_seq`），只让最后一次落地，
否则「先发起的慢渲染」会盖掉「后发起的新内容」——这类竞态在异步预览里几乎必然出现。

## 8. 借鉴声明

本项目的**大量设计决策与实现片段，主动借鉴了同作者的前作**
[draw-http-terminal-20261025](https://gitee.com/zuozhixingzhe-digger/draw-http-terminal-20261025)。

两个项目都出自本仓库作者之手，代码可任意互相引用（包括直接拷贝），不构成第三方版权问题。
参照前作 README 的「维护指南」要求，**能抄就抄、抄好的**——重复发明别人已经调好的轮子没有意义。

| 方面 | 借鉴内容 |
| --- | --- |
| 页面骨架 | **顶部控制栏 + 占满画布的终端**（而非悬浮按钮）；`body{position:fixed}` 防橡皮筋；`.app` 吃安全区 |
| 顶栏 | 符号控制键（`⌃⌥⇧ ␛ ⇥`）分组 + 分隔线 + 右侧固定按钮组；`height:clamp(42px,8.5vw,52px)` 的自适应思路 |
| 修饰键 | **短按锁定 / 长按组合 / 期间有输入则不锁定**这套完整规则，以及 `k--active` / `k--pressing` 两级视觉 |
| 更多抽屉 | 右侧滑出 + 遮罩；`drawer__user` / `drawer__section` / `drawer__row` 的信息架构；`touch-action:pan-y` + 滑块 `none` 的手势隔离 |
| 特殊字符 | 符号字体栈 `--mono-sym`、`font-variant-emoji:text`、用 `␛`/`⇥` 表示 Esc/Tab 的约定 |
| 设计 token | `--bg-0/1/2`、`--fg/-muted/-faint`、`--border/-strong`、`--radius-*` 的命名层次 |
| 主题细节 | xterm `bright*` 必须跟主题走（粗体取的是 bright 系列） |
| 字体栈 | 避开 `ui-monospace` 的踩坑结论 |
| 文档结构 | README 分「使用文档 / 维护指南」两部分；开发日志与操作记录倒序、禁止删改历史条目 |

没有借鉴的部分：点分隔路径的文件系统、Worker 多线程模型、窗口管理器、智能体 harness、三份后端——
这些是本项目新写的。

### 8.1 致谢：帮我们做过实测的开源项目

0.0.1.6 这一轮做「真实页面实测」时，我们把几个**真实的开源项目**下载到仓库**之外**的临时目录，
用一个静态服务器跑起来，再塞进 HTerMinaL 的小浏览器（iframe）里看能不能活。
**一行代码都没有合并进本仓库**，也没有把它们打进 `index.html`——它们只是测试素材。
但没有它们，这一轮就只能靠「我觉得应该能跑」。

感谢这些作者把东西做得这么好，也感谢他们选了宽松的许可证：

| 项目 | 作者 | 许可证 | 我们拿它测什么 |
| --- | --- | --- | --- |
| [2048](https://github.com/gabrielecirulli/2048) | Gabriele Cirulli | MIT | 一个完整的前端小游戏：DOM、事件、`localStorage`、动画在沙箱里是否正常 |
| [WinBox.js](https://github.com/nextapps-de/winbox) | Nextapps | Apache-2.0 | 一个**窗口管理器**跑在另一个窗口管理器里：定位、拖拽、层叠、iframe 内事件 |
| [98.css](https://github.com/jdan/98.css) | Jordan Scales | MIT | 纯设计系统（CSS）：老式控件、字体、图像边框在 iframe 里的还原度 |
| [three.js](https://github.com/mrdoob/three.js) | three.js authors | MIT | 3D 运行时：ESM 模块加载、WebGL 上下文（无头环境拿不到 GPU，见下） |
| [Chart.js](https://github.com/chartjs/Chart.js) | Chart.js contributors | MIT | canvas 2D 绘图与定时器：`requestAnimationFrame` + `setInterval` 的持续动画 |
| [p5.js](https://github.com/processing/p5.js) | Processing Foundation | LGPL-2.1 | 创意编程：`noise()` 流场、逐帧重绘、窗口尺寸变化 |
| [lodash](https://github.com/lodash/lodash) | John-David Dalton 及贡献者 | MIT | 一个真实的 UMD 脚本：`fetch` 下来后 `eval` 进 Worker，验证「沙箱里能跑第三方 JS」 |

两点如实说明：

- **p5.js 是 LGPL-2.1**，不在本项目的「可引入清单」里。我们**没有**把它打包或链接进产物，
  只是把它当成「用户从外面拖进来的第三方脚本」在运行时加载——这正是沙箱该做的事，
  也是本项目对 GPL 系代码的一贯口径（见 §11 兼容性红线）。
- **three.js 在无头测试环境里拿不到 WebGL 上下文**（`--use-angle=swiftshader` 也不行），
  所以那一张截图是空白的。能确认的是：ESM 模块加载成功、脚本跑到底、HUD 渲染出来了；
  WebGL 本身要真机验证，我们不在文档里假装它通过了。

## 9. 开发日志

> 倒序：最新在最上方。禁止删除历史条目。

| 版本 | 日期 | 变更条目 |
| --- | --- | --- |
| 0.0.1.6 | 2026-11-03 | **沙箱工具集 + 真实页面实测 + 理念章节**：①**十个工具**（`build/55-tools.js`、`56-data.js`、`57-color.js`，共约 1900 行，全部自研）——**计算器**（递归下降解析 `expr/term/unary/power/postfix/primary`，不用 `eval`；`2^3^2` 右结合、`5!`、`log(2,8)`、`sin(30)` 走 DEG/RAD、记忆 M+/M−、40 条历史、键盘直输）；**数据**（编码互转：文本/UTF-16/Base64/Base64URL/Base32/Hex/二进制/十进制大整数/URL/HTML 实体；时间戳 + `Intl` 多时区 + 相对时间；哈希 SHA-1/256/384/512 + 自写 MD5 + 期望值比对 + 文件哈希；随机：字符串/hex/bytes/int/uuid/分组密码，`crypto.getRandomValues` + 拒绝采样 + 熵估算）；**调色盘**（色相环 canvas 逐像素按当前亮度重绘、六种表示双向联动 HEX/RGB/HSL/HSV/CMYK/YUV/Lab、`EyeDropper`、从整页截图逐像素取色、WCAG 对比度、历史色存 localStorage）；**Markdown**（`marked` 懒加载 + 失败退内置迷你渲染器、`sanitizeHtml` 白名单清洗 `<script>`/`on*`/`javascript:`、渲染序号防旧盖新、导出 HTML/下载 .md）；**截图**（桌面/指定窗口/整文档、1–3×、PNG/JPEG/WebP、存 `.home` 或下载、复制图片）；**链接即状态**（文本/JS → `deflate-raw` + base64url 压进 `#`，`run=1` 打开时先弹确认框展示代码再执行）；**四个壳子**（录音机/定位/3D/音频：写明「计划怎么做」与「为什么先不做」）。②**CLI**（`25-compat.js`）——`b64/b32/hex/bin/dec/url/hash/rand/uuid/ts/mount/tools/tool`，与窗口共用主线程 `util.codec` / `util.hash`（Base32、MD5 只写一份）；`hash` 对不存在的文件回退成「把参数当文本」，不报「没有那个文件」。③**`sptm`（mount）占位**——第七个 syscall，注册进 FS/RPC/worker API，调用明确抛「还没做」，`mount` 命令可列五个内建挂载点；不假装成功的原因写在 §7。④**窗口/启动器**——`APP_DEFS` 加 10 项、`WindowManager._render` 加分支、`TYPE_TITLES/TYPE_SIZE` 补齐、启动器加「工具」分组（维护中的置灰带标签）并支持滚动。⑤**真实页面实测**——把 2048、WinBox、98.css、three.js、Chart.js、p5.js、lodash 下到**仓库之外**的临时目录跑起来（见 §8.1 致谢），2048 能玩、WinBox 能在窗口里再开窗口、Chart.js 曲线在动、p5.js 流场在跑、lodash 在 Worker 里 `eval` 后 `_.camelCase` 正常。⑥**自举**——把 `index.html` 用静态服务跑起来、塞进自己的小浏览器，内层 `2+3` → 5、`hsl('uname -a')` → `HTerMinaL 0.0.1.6`、`hsl('ls')` → `readme welcome`。⑦**README**——新增 §15 工具、§16 设计理念（原文照录）、§8.1 致谢开源、§7 `sptm` 说明、§11 API、开发日志/操作记录/踩坑。⑧**修**——计算器 `.calc-pad` 忘了 `grid-template-columns`（按钮排成 4 列、顺序全乱）；`ensureMarked()` 没缓存 Promise，输入时每个字都重新拉一次 CDN；`MdApp.render()` 无序号，慢的旧渲染会盖掉新内容。 |
| 0.0.1.5 | 2026-11-03 | **窗口间拖拽 + 小浏览器一键存网页**：①**`DragBus` 拖拽信道**——同一文档里所有窗口共用一份 `{items}`，`dragenter/dragover` 阶段就能读（`dataTransfer` 的内容要等 `drop` 才允许读），所以「拖到哪个窗口先亮」才做得到；`dataTransfer` 里同时写 `application/x-ht-spot`（JSON）与 `text/plain`，管跨进程与变量丢失时的兜底。②**文件管理器 ↔ 文件管理器**——每行 `dragstart` 发布 `{kind:'spot', path, name}`，落点调 `dropIntoDir()` 复制（目录整棵递归）；**按住 Shift = 移动**；同目录拖出 `name-2`；拖进自己内部直接跳过。③**多窗口**——文件管理器工具栏加 `⧉`：同目录再开一个窗口，两个窗口并排互相拖；窗口本来就是一个 `FilesApp` 实例一个 `path`，互不共享状态。④**文件 → 智能体**——`addItems()` 从 spotfs 读内容：图片转 dataURL、文本内联（≤256 KB）、二进制提示用 `read_file`，仍受「一次最多 6 个附件」约束。⑤**文件 → 终端**——`TerminalSession.insert()` 用括号粘贴（`\x1b[200~…\x1b[201~`）把路径插进命令行**不执行**；从系统拖文件到终端则先导入它当前 `cwd` 再粘路径。⑥**文件 → 浏览器**——`BrowserApp.openPath()`：html/text 直接渲染、图片按图片显示、其它交给编辑器窗口。⑦**浏览器标签 → 文件管理器 / 智能体 / 终端**——标签 `draggable`，携带 `{kind:'page', name, url, html}`（跨域时 `html:null`）：落到文件管理器存 `<标题>.html`（跨域存跳转页），落到智能体当附件，落到终端粘地址。⑧**小浏览器一键保存**——`br-bar` 新增「保存」（写进 spotfs 的 `.home`，撞名自动 `-2`）与「下载」（落本机磁盘），`pageHtml()` 用 `contentDocument.documentElement.outerHTML`，跨域读不到时存跳转页并如实提示；标题已带 `.html` 不会变成 `.html.html`。⑨**iframe 吃事件的解法**——拖拽期间给 `body` 挂 `drag-internal`，`.br-shield` 盖住 iframe，`drop` 才能回到父文档；`dragend` 之外补 `blur` / `visibilitychange` 清场，避免遮板卡住把小浏览器挡死。⑩**落点提示**——所有落点统一 `data-drop` + `::after` 小标签（「复制到 .bin」「粘贴路径」「在浏览器里打开」「附加到对话」），不用靠猜。⑪**实测**——两个 FM 窗口各 3/4 行、A→B 复制后两边都在、Shift 后源消失、目录 `.home.sub` 整棵复制到 `.bin`、同目录得到 `.home.one-2`；拖到桌面终端与终端窗口都出现 `.home> .home.alpha`（未执行）；拖到浏览器 `srcdoc` 含文件内容；标签→FM 生成 `.bin.-xxpage-2dhtml-2ehtml`、标签→智能体附件 `测试页.html` 且正文含 `HELLO`；保存生成 `.home.-xxpage-2dhtml-2ehtml`；遮板 `display:block` 且 drop 后 `body.drag-internal` 归位；无 pageerror。 |
| 0.0.1.4 | 2026-11-02 | **修「TUI 智能体进去就自己退出来」**：①**根因**——`agentTui.open()` 只 `out()` 了一个横幅，`state.mode` 还是 `jshel`、提示符还是 `.home> `，所以下一行立刻回到 JS 求值；用户看到的就是「进去一下就闪退，进不了交互环境」。它从来就不是一个模式，只是打印了一句话。②**改成真正的第三种模式**——`mode` 取值 `jshel` / `hsl` / `agent` 三选一，提示符分别 `.home> ` / `.home $ ` / `agent> `；`open()` 把 mode 置 `agent`、记住进来之前那一层（`_back`，HSL 进来就回 HSL）、重画提示符。③**一行的分派**——`onSubmit` 先看 mode：`agent` 整行交给 `agentTui.line()`，`hsl` 交给 COMPAT，其余走 `api.run()`；三路互不猜。④**agent 内建命令**（`:q`/`exit`/`:quit`、`:stop`、`:new`、`:clear`、`:help`），`:help` 打印快捷键表；非 `:` 开头一律当消息发给模型。⑤**退出与中断**——`:q`/`exit`/`Ctrl+D` 回原来那一层（Ctrl+D 走新加的 `onCtrlD` 钩子，不再关掉终端）；`Ctrl+C` 走新加的 `onInterrupt` 钩子 → `agent.stop()` → 主线程 `AbortController.abort()`，实测 0.7 秒停下并回到提示符，而不是等 240 秒超时。⑥**渲染重写**——`⠋⠙⠹…` 帧动画 + 已用秒数的「思考中」；回答按显示宽度折行（中日韩算 2 列）；工具调用画 `→ 名字 参数` / `← 名字 结果`；`system` 备注（重复防护的警告）单独用黄色 `⚠` 显示，`error` 用红色 `!`；每轮末尾一行 `─ 1.4s · 2 次工具调用`；没有输出时才写「（没有输出）」。⑦**不再回显返回值**——`open()` 返回 `undefined`（以前返回 `'agent'`，REPL 会在横幅下面多打一个孤零零的 `agent`，看着像报错）。⑧**实测**——`agentTui.open()` 后提示符变 `agent> ` 并停住；`:help`/`:q` 正确；未配置后端时错误显示在 TUI 里且**不退出**；`Ctrl+D` 回 `.home>` 后 `2+3` → `5`；`Ctrl+C` 0.7s 中断；`agentTui.open()` 重复进入走「已经在 agent 里」；窗口版 `agentOpen()` 仍正常存活。 |
| 0.0.1.3 | 2026-11-02 | **拖拽导入/导出 + spotfs 节点文件系统**：①**拖进来 = 导入**——外部文件拖到窗口出现全屏虚线遮罩（图标浮动动画 + 「松手导入到 X」），松手即进 spotfs：智能体输入框 → `.queryfile` 并挂到对话，文件管理器 → 当前目录，其它地方 → `.home`；`dragenter/leave` 用计数避免闪。②**拖出去 = 下载**——文件管理器每行 `draggable`，`pointerdown` 预读成 Blob URL，`dragstart` 同步 `setData('DownloadURL', 'mime:原名:url')`，拖到桌面/资源管理器即落盘。③**spotfs 六个 syscall**——`sptc`(cover，只覆盖不新建) / `sptn`(new，`.queryfile` 下=向用户要文件、`.savefile` 下=关闭时保存) / `spta`(append) / `sptx`(execute:JS/HTML/对象/目录/权限/包/设备，自动判别) / `sptr`(read:内容或索引) / `sptd`(delete:文件/目录递归/进程结束)；worker 侧 `sptx` 把「动作描述」落地（编译执行 JS、开浏览器、`cd`、请求权限、`kill`）。④**名字转义**——UTF-8 字节级：字母数字原样，其余（`-` `_` `.` `/` 空格 中文 控制符）写 `-HH`，首位数字也转义，整体加 `-xx` 哨兵；导出反向解析，目标系统不接受的字符保留 `-HH`；`checkName` 放行 `-xx…` 转义名；`normPath` 一律小写，所以哨兵/十六进制在存储层是小写（解析时大小写都认）。⑤**`.savefile`**——新建并写入，关闭/删除时 `saveFileRaw(原名)` 导出后节点消失。⑥**统一入口**——`importFiles()` 被拖拽、上传、`askFile` 复用；`saveFileRaw` 专用于导出（不走 `sanitizeName`，否则会把 `-xx` 前的短横线剥掉）。⑦**文档/种子**——`.home.readme` 改写为 spotfs 世界观（六操作、转义、`.savefile`）；README 第 7 章新增 spotfs / 转义 / 拖拽三节，第 11 章补 `spt*`。⑧**实测**——转义往返 `hello world.txt ↔ -xxhello-20world-2etxt`、`a/b.txt → a-2Fb.txt`（导出）、`readme` 原样、`123abc ↔ -xx-3123abc`；六 syscall 覆盖/新建/追加/读/删/目录索引全对，`sptc` 对不存在、`sptn` 对已存在都正确报错；`.savefile` 存在→`saveOnClose`→导出删除；文件管理器 drop 生成 `-xxhello-20world-2etxt`、`#desk` drop 生成 `-xxg-20note-2emd`、智能体 drop 进 `.queryfile` 且附件 +1；遮罩显隐、`DownloadURL=text/plain:export me.txt:blob:…` 均正确。 |
| 0.0.1.2 | 2026-11-02 | **智能体「重复生成防护」**：①在 harness 循环里新增**输出签名**（`_turnSig`）——带工具调用时压成「工具名(参数指纹)」链，纯文本取正文前缀；连续三次签名相同判定陷入重复循环。②第 3 次重复时**卡断本轮**（不再执行这一轮的工具调用/文本），并**自动以 user 身份向模型追问一句「【自动检查】你已连续 3 次输出基本相同的内容，疑似陷入重复循环……请改用不同参数或换工具，不要重复刚才完全相同的动作」**，然后让它带着追问继续跑（reset 后从 0 重数，不每轮都追问）。③`AGENT_SYSTEM` 补一句：收到「连续 3 次重复输出」提示时立刻换思路而非继续重复。④`messages` 里插入的「⚠ 已连续 3 次输出相同内容」是 `system` 角色、只渲染给用户看（`render()` 走 `msg sys` 样式），**不进发给模型的请求**（`apiMessages()` 跳过 `system`）；追问句是 `user` 角色，正常发。⑤把过去散落的「去重」收口——单轮内同工具同参数 `seen>=2` 不重执行、连续相同正文 `_pushAssistant` 折叠、跨轮相同签名 `REPEAT_LIMIT=3` 卡断追问，三层各管一段。 |
| 0.0.1.1 | 2026-11-02 | **把「自作聪明」的地方全部退回浏览器，把「学不像」的地方全部删掉**：①**原生 API 一律转发，不重造**——`alert`/`confirm`/`prompt`/`open`/`print`/`close`/`focus`/`blur`/`stop`/`scrollTo`/`scrollBy` 在 Worker 里都没有，现在统一走 `native` RPC 转回主线程调 `window[name]` 本人：`alert` 是浏览器弹窗（不是 toast）、`confirm` 是浏览器确认框（返回真的 `true/false`）、`prompt` 是浏览器输入框、`print()` 真的开打印对话框、`window.open` 真的开新标签。`NATIVE_ALLOWED` 白名单之外的转发直接抛错；顺手删掉 `globalThis.print = (...a) => out(...)`——那条一直在抢注打印对话框。两条物理限制写进文档：跨线程没有同步通道（要 SAB + COOP/COEP，`file://` 必然没有），所以 `confirm`/`prompt` 返回 Promise；`window.open` 返回 `WindowProxy`，克隆不回来只能给 `null`。②**JSHeL 与 HSL 彻底分家**——删掉 `isShellLine()` 那套「首词猜」：它让同一行代码的行为取决于命令表里恰好有没有同名命令。现在 `state.mode === 'hsl'` 整行交 COMPAT，否则只走 `api.run()`（纯 JS）。JSHeL 里敲 `ls -la` / `nano readme` 是 `SyntaxError` / `ReferenceError`，外加一句「X 是 HSL 命令，`hsl()` 进 shell」。③**HSL 嵌套改用栈**——`HSL: [{cwd, env}]`，`hslPush()` 压栈、`hslPop()` 弹栈并恢复 cwd + `ENV`；`exit` 弹一层，退到空才回 JSHeL。老版把模式存成布尔量，第二次进入只是把同一个标记又设一遍（提示符不变、`exit` 一次退到底、进去前改过的目录回不来）——**布尔量表达不了「第几层」**。④**删掉没有意义的移植**——`apt`（这里不是 Debian）、`ping`（浏览器不发 ICMP）、`bash`/`sh`（GPL 且学不像）、`su`/`sudo`（单用户最高权限）、`npm`/`pip`（只会打印一行的桩）、`chmod`（没有权限位）；**`zsh` 彻底删除**（含许可证段落）——「学的不像那么干脆彻底不学了」，交互层改名 **HSL** 并由 `def('hsl')` 提供。⑤**文件系统删掉 rwx**——`ls -l` 改成 `kind  size  mtime  name`（`dir`/`file`/`func`/`app`/`dev`/`pkg`），画一排 `-rw-r--r--` 只会让人以为 `chmod` 有用；`.perm` 的语义从「权限位」正名为「授权申请单」（摄像头/通知）。⑥**新增 `fastfetch` / `neofetch`**——`sysFacts()` 现场汇总 `sys.info` + `fs.usage` + `proc.list` + `.pkg`，六行 ASCII logo，拿不到的字段写 `n/a` 不编；`--no-logo` 只要文字。⑦**`vim` / `nano` 重写**——DECSET 1049 备用屏 + **按绝对坐标逐行重画**（`\x1b[{n};1H\x1b[2K`，一个换行符都不发）：内容高度等于终端高度时，末尾那个 `\r\n` 会触发滚动把整屏顶上去一行，nano「显示不正常」就是这个；顶栏/状态栏改用显式配色 `\x1b[100;97m`（SGR 7 反显换的是默认前景/背景，浅色主题下就是黑字压深底）；中文按显示宽度排版（`CW`/`dw`/`sliceW`/`padW`/`skipW`/`xToCol`），中英混排不再错行；`LineEditor` 两处 `finally` 加 `&& !this.raw`，全屏期间不再补提示符（否则 `.home $ ` 正好盖在标题栏上）；`resize` 时重画全屏应用。⑧**支持鼠标**——DECSET 1000 + 1006（SGR 坐标），正则认 `\x1b[<b;x;yM/m`：点正文哪一行哪一列光标就到哪（按显示宽度反算列），滚轮上下滚三行；退出顺序不能反：`[?1000l[?1006l[?25h[?1049l`（先关鼠标报告再离开备用屏）。⑨**对话持久化**——新增 `AgentStore`（独立库 **`ht-agent`**：`sessions` keyPath `id`、`messages` keyPath `['sid','seq']` + `sid` 索引）；> 40 KB 的 dataURL 自动转 Blob 存，读回再转回；**先 prepare 再开事务**（事务里 `await` 会让事务提前提交，抛 `TransactionInactiveError`），事务回调只做同步 `put/delete`；800 ms 防抖 + 轮末/清空/导入/关窗 `flushSession()`；首次启动从 `.agent.session` JSONL 迁移一次，之后那份只作可导出镜像；`AgentTuiHost.status()` 改走 `HeadlessAgent.ensure()`，没开过 TUI 也能看到历史条数。⑩**产品名统一为 `HTerMinaL`**——按 `\bhterminal\b(?!\s*[./])` 全仓替换，避开路径与文件名（`X-HTerm-Client` 这类 HTTP 头值不算展示文案，保留）。⑪**文档**——5.1 整节改写为 HSL（JSHeL vs HSL 对照、嵌套栈、支持能力、命令表、路径按 cwd、全屏应用、fastfetch、「没有 rwx」、「删掉的没意义移植」表）；新增 5.3「原生 API：只转发，不重造」；第 6 章开头写明「不是 ext4：没有 inode、没有 rwx、没有属主」；踩坑 `29 → 36`。⑫**实测**——`alert`/`confirm`/`prompt` 被 Playwright 的 `dialog` 事件捕获为 `alert:hello native` / `confirm:really?` / `prompt:name?`（证明是浏览器自己的框）、`1+1`→`2`、`ls -la`→`SyntaxError`+指路、`hsl('ls -la')` 正常、`hsl('uname')`→`HTerMinaL`、`hsl`→`cd /`→`hsl`→`exit` 回到第 1 层且目录回 `.home`→`exit` 回 JSHeL、10 条删掉的命令在 `help` 里全部消失、`fastfetch` 九项信息全真值、nano 点第 5 行第 8 列后输入落点正确、vim `:wq` 后 `cat` 内容正确、刷新后智能体显示「已恢复 4 条消息（最后更新 …）」。 |
| 0.0.1.0 | 2026-11-02 | **里程碑：初步制作阶段收尾——把「说得到但做不到」的地方全补上**：①**`.bin` 里写代码就是函数**——`FS.write` 以前无条件把 kind 设成 `file`，于是 `write('.bin.hi','return 42')` 之后 `exec('.bin.hi')` 必然报「不是可执行对象」；现在新建 `.bin.*` 默认 `kind:'func'`，改写已有文件保留原 kind（用 vim 改函数不会把可执行位弄丢）。②**补 `chmod +x / -x`**——README 的兼容层命令表里一直有它，实现里没有。③**`sudo <cmd>` 输出打两遍**——内层已经把 stdout 打到终端，外层又按 `res.out` 打一次；现在只带退出码。④**终端里敲 `nuke()` 是 `nuke is not defined`**——README 让用户这么干，但 Worker 里根本没这个函数；新增 `nuke.run` RPC，确认框、清库、重载全走主线程。⑤**README 第 11 节那张「挂在 window 上的标准函数」表大面积对不上**——`remove`/`move`/`copy`/`openWindow`/`closeWindow`/`listWindows`/`openURL`/`threads`/`settings` 全是 undefined；补齐长名别名与 `settings.set/all`、`threads.list/kill` 的 RPC。⑥**兼容层补 5 条只写在文档里、没实现的命令**——`sleep`（此前落到 JS 的 `sleep(ms)`，`sleep 2` 只等 2 毫秒）、`rev`、`tee`、`stat`、`xargs`；`diff` 遇到不存在的文件不再「无差异 exit 0」。⑦**页面被 `document.write` 拆掉后的两个崩溃点**——`Drawer.refresh` 在 `await` 回来后 `$('#stUsage')` 已是 null（实测一条 `Cannot set properties of null`），`checkBackend` 同理；统一走 null 安全的 setter。⑧**`file://` 与后端的关系写清楚**——`null` Origin 和恶意 sandbox iframe 无法区分，0.0.0.5 的拒绝是对的，但前端不该再盲发请求；`checkBackend` 直接显示「file:// 下不可用」，智能体报错文案给出两条出路。⑨**版本号残留**——`build/10-body.html` 与 `build/20-worker.js` 里硬编码的 `0.0.0.2` 改成占位符 `—`，`boot()` 第一件事注入 `HT_VERSION`，启动屏第一帧就是对的号。⑩**`askFile` 保留扩展名**——`hello.txt` 以前被剁成 `hello`，`a.txt` 与 `a.md` 会撞；现在 `hello-txt`。⑪**`require` 回显不再刷屏**——ESM 命名空间对象只显示 `Module(322 exports) { … }`；README 示例改成 `const _ = await require('lodash-es@4')`（`require` 从来不会偷偷塞全局 `_`）。⑫**Python 的 `Ctrl+C` 说明改成实话**——Pyodide 与终端同 Worker、没有 SAB 就没有中断通道，`while True` 只能刷新页面，启动横幅与 README 都写明。⑬**文档对齐**——踩坑条数 `17 → 29`、页脚版本 `0.0.0.2 → 0.0.1.0`、`00-head` 与 `.sys.license` 的第三方清单补全到 6 项。⑭实测：`.bin` 写入即执行（42）、`chmod +x/-x` 可逆、`sudo echo` 只打一次、`nuke()` 确认后 `.home` 只剩种子文件、9 个长名 API 全部 exists、5 条新命令与管道组合正确、`askFile` 产出 `.queryfile.hello-txt`、`require` 回显一行、`0.0.1.0` 在启动屏与抽屉里都对、s1–s14 关键项回归无 pageerror。 |
| —（文档/许可证） | 2026-11-02 | **第三方许可证补齐，加机器校验**：①审计出三个**一直在用却没登记**的依赖——`@xterm/addon-unicode11@0.8.0`（MIT，同 xterm 仓库）、`marked@12.0.2`（MIT）、`html2canvas@1.4.1`（MIT），补 `licenses/LICENSE.marked.txt`、`licenses/LICENSE.html2canvas.txt`，`LICENSE.xterm.js.txt` 覆盖两个 addon；`licenses/README.md` 与本文第 11 章的表同步补齐。②新增 **`check-licenses.sh`**：扫 `build/*.js` 与 `index.html` 里所有 `npm/`、`unpkg.com/` 形式的 CDN 地址（含版本号是变量的写法），比对登记表，缺一行 exit 1；同时校验表里引用的 `LICENSE.*.txt` 文件真的存在。③修 `licenses/README.md` 里过期的「Markdown 渲染：不渲染」——现在用 `marked` 渲染 + 自研 `sanitizeHtml()` 白名单消毒，两件事分工写在表里。④页脚版本号从 `0.0.0.2` 修到 `0.0.0.5`（此前漏改）。⑤实测：真依赖 6 项全「已登记」exit 0；临时塞一个 `left-pad@1.3.0` 进去，脚本报「缺失 ✗」exit 1。 |
| 0.0.0.5 | 2026-11-02 | **后端安全加固（三份实现同步）**：①**`Origin: null` 从「放行」改成「拒绝」**——`file://`、`data:`、sandbox iframe 的 Origin 都是 `null`，以前放行等于任何网站都能用 `<iframe sandbox srcdoc="fetch('http://127.0.0.1:8787')">` 打本地端口。②**新增 `Sec-Fetch-Site: cross-site` 拒绝**——浏览器自己打的标，页面改不了，直接堵死「公网网页 → 本地端口」。③**CORS 头只在 Origin 通过校验后回显**，不再对任意 Origin 回 `Access-Control-Allow-Origin`，也不发 `Allow-Credentials`；`OPTIONS` 必须带 Origin。④**每个响应都带安全头**：`X-Frame-Options: DENY`、`Content-Security-Policy: frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Cross-Origin-Resource-Policy: same-origin`、`Cross-Origin-Opener-Policy: same-origin`、`Permissions-Policy`。⑤**`POST` 要求 `Content-Type: application/json`**（否则 415），堵掉 `text/plain`/`form-urlencoded` 这类不预检的简单请求。⑥**被拒请求在 stderr 留一行 `deny origin/host/fetch-site`**。⑦实测（curl，三份后端一致）：正常 200、`Origin: https://evil.com` 403、`Origin: null` 403、本机 Origin 200 且 ACAO 回显、`Sec-Fetch-Site: cross-site` 403、`Host: evil.com` 403、`text/plain` POST 415、`/etc/passwd` 403；页面响应含全部安全头。 |
| 0.0.0.4 | 2026-11-02 | **JS 执行环境对齐 F12**：①**删除「文档窗口」这个自作聪明的改道**——`document.write` 现在就是 `document.write`，文档加载完后调用会隐式 `open()` 清空整页，终端一起没，这是浏览器行为，不拦。②**`document.body.innerHTML` 直写宿主**，不再重定向；`el.textContent`/`style`/`classList`/`appendChild`/`insertAdjacentHTML`/`remove()` 全部直达。③**元素句柄换成 Proxy**：`tagName`/`id`/`className`/`children`/`parentNode`/`outerHTML`/`getBoundingClientRect()`/`getComputedStyle(el).color` 都是真属性；`createElement` 在主线程建真游离节点，`appendChild` 才入 DOM。④**同步读靠预取**：执行前从代码里抠出 `querySelector('…')`/`page.q('…')`/`getElementById('…')` 的字面量，一次 `prefetch` 拉回 innerHTML/rect/computed；动态拼接的选择器第一次为空。⑤**事件回放**：`addEventListener` 在主线程注册真实捕获监听，事件描述异步发回 Worker 再调回调（`preventDefault` 无效，跨线程的代价）。⑥**`page.eval(code)`**：主线程间接 `eval`，100% 原生，含「返回最后一条表达式」语义。⑦**window 补齐**：`innerWidth/innerHeight/devicePixelRatio/scrollX/scrollY` 走快照、`requestAnimationFrame`（16ms 定时器）、`matchMedia`、`history`（既列命令历史又带 `length/back/pushState`）、`top/parent/frames === window`、`document.location === location`；`navigator` 不再覆盖成假对象。⑧**`Object.assign(globalThis, api)` 改逐个赋值**，修 Worker 只读访问器导致 shell 起不来的问题；`open()` 支持 URL。⑨实测——`document.write` 后 `#desk` 消失、`<h1 id=hi>` 出现；`body.innerHTML` 后只剩新内容；`createElement`+`appendChild` 真进 `#topbar`；`el.style.color` 真改；`el.addEventListener('click')` 回放后 `document.title` 变 `CLICKED`；`page.eval('1+1')` → 2；`getBoundingClientRect().height` → 54；s1–s14 回归全绿。 |
| 0.0.0.3 | 2026-11-02 | **修回 JSHeL 的 JS 环境、help 合并、删按键振动**：①**`document.write` 不能执行**——0.0.0.2 的 document 代理只做了读（`title`/`querySelector`），补上 `write` / `writeln` / `open` / `close`：内容累积进一个「文档窗口」，第一次调用开窗、之后更新同一个 `srcdoc`；不写宿主页面（会冲掉终端）。顺便把 `innerHTML` / `textContent` / `value` 做成真属性（get 走 RPC、set 直接下发），`document.body.innerHTML = '…'` 被重定向到文档窗口而不是炸掉主界面。②**`help` 只剩兼容层**——`25-compat.js` 里 `def('help')` 把内置的 `help()` 顶掉了，于是敲 help 只看到 40 个命令名。删掉那一条，改由 JSHeL 的 `help()` 同时输出两段：JSHeL 函数（文件/执行/窗口/系统/DOM/智能体）+ Linux 兼容层命令表。③**删按键振动**——`term.onData` 里那句 `haptic(5)` 去掉，抽屉里的「按键振动」开关与 `Settings.haptic` 一并删除；打字不震。④**摇杆加振动**——`sendDir()` 每次发方向键 `haptic(7)`，节流 60ms（小于 180ms 连发间隔），支持振动的设备上手感对齐参考项目。⑤实测——`help` 同时含「JSHeL 快速参考」与「Linux 兼容层」；`document.write('<h1>DOC-WRITE-OK</h1>')` 开窗并渲染出文本，第二次 write 复用同一窗口；按键 3 次 `vibrate` 计数 0，摇杆拖动计数 4；`document.body.innerHTML` 后主界面 `#desk`/`#topbar` 仍在。 |
| 0.0.0.2 | 2026-11-01 | **顶栏减负、兼容层、TUI 智能体、窗口动效**：①**顶栏**——左侧品牌/版本/当前目录**全部删掉**，不再是「左中右」而是「从 `⌃` 开始」；版本号移入「更多 → 状态」，当前目录移入提示符。②**提示符**——固定「路径 + `> ` + 空格」，不给设置；`@` 表示当前目录（`cd @`、`cat @.notes`），`~` = `.home`，`..` 上一级，`/` 与 `.` 等价；zsh 模式换成 `%`。③**光标**——照参考项目重做：xterm 光标设全透明，上面叠 `.ht-cursor`，`rAF` 每帧向目标逼近 22%（平滑移动）、聚焦 2px 竖线、失焦 7px 椭圆、备用屏虚线、空闲 1s 呼吸；`cursorBlink:false`，闪烁完全由这一层控制，**不提供设置**。④**外观段**——「字号」改名**终端字号**；新增**显示行数**滑块（`fixedRows`，0 = 自动铺满，对齐参考项目）；新增**按键振动**开关（`navigator.vibrate`，**0.0.0.3 已删**）；背景网格固定一套，光标样式/网格/提示符格式**故意不可配**。⑤**直连**——默认模型从 `gpt-4o-mini` 迁到 **`deepseek-flash`**（只覆盖等于旧默认的值）；API Key 进 `VOLATILE` 列表，`_persisted()` 写盘前剥掉，**只存内存、刷新即失**。⑥**F 键**——`F5`/`F12` 的 `attachCustomKeyEventHandler` 直接 `return false` 交还浏览器；`F11` `preventDefault()` 后调 `toggleFullscreen()`，与顶栏 `⛶` **同一条路径**（软件全屏 `body.fs` + 可用时请求 Fullscreen API），不存在两种全屏。⑦**内嵌浏览器**——智能体传 HTML 时走 `srcdoc`（此前只认 url，于是「打开 HTML」变空白页）；`target=_blank` 与 `window.open` 转**内部新标签**，实在拦不住才外部；`mailto:`/`tel:` 出面板块；修 `postMessage` 用 `location.origin` 被 opaque origin 丢弃的问题（改 `'*'` + `htTok` 校验，同源路径直接调方法）。⑧**Linux 兼容层**（新 `25-compat.js`，约 45 KB）——MiniShell（引号/变量/管道/重定向/通配符/`&&`/`||`）+ 40 余条 coreutils + 全屏 `vim`/`nano` + `zsh` 模式；`isShellLine()` 只看首词是否命令、成员访问必须紧贴点号，因此 `mkdir("a"); write("b")` 仍是 JS、`ls .home` 是 shell；全部自研 MIT，**不打包任何 GPL 二进制**（coreutils/busybox 都是 GPL）。⑨**TUI 智能体**（新 `65-tui.js`）——`agentTui.open/send/queue/stop/status/close`，`open()` 返回短 id（返回 `this` 会把 REPL 刷满 `[object Object]`）；`send` 异步入队立刻返回，`queue` 排队，`stop` 掐断当前轮；与窗口版共用同一套 harness。⑩**DOM 代理**——`document`/`window`/`page` 挂进 Worker：同步读快照（title/location/尺寸），异步 RPC（`page.q`/`el.text()`/`el.rect()`/`el.click()`/`page.openWindow`）；`location` 只读代理，写入静默忽略。⑪**智能体**——最大步数 120（设置可调 0–120）；同轮调用指纹 `stableKey` 去重；`apiMessages()` 强制 `tool_calls` ↔ `tool` 配对（缺的填「已取消」），修「中断后再提问 400」；`agentFetch()` 三级降级（直连 → `r.jina.ai` → `allorigins`），修「取新闻卡在工具调用」；回复用 `marked` + `DOMPurify` 渲染；新增 `screenshot`（html2canvas）/`window_html`/`ui` 三个工具；输入框支持图片附件（多模态 `image_url`）。⑫**依赖缓存**——xterm/addon/字体/html2canvas/marked 首次加载后统一进 IndexedDB（`DepCache`），新终端不再重复下载；抽屉里显示占用并可单独清理。⑬**清除**——`nuke()` 与「清除本页全部数据」改为**彻底清空**：`indexedDB.databases()` 逐个 delete + localStorage/sessionStorage/caches/ServiceWorker，最后 `location.replace`。⑭**窗口动效**——开窗从触发点扩散、关窗溶解收点、最大化外扩/内缩（`.tween` 300ms）、最小化沉入 dock、恢复从 dock 长出；`prefers-reduced-motion` 全部降级。⑮**后端**——三份 `modelserver` 的 `GET /` 与 `/index.html` 直接返回同目录 `index.html`（`no-store`），`/health` 与 `POST /v1/chat/completions` 之外**一律 403**；Go 版加 `scriptDir()`，从任意 cwd 启动都能找到文件。⑯**文件系统**——`write` 校验父目录存在，修掉 `write('.home.a.txt')` 造出 `ls` 永远看不见的幽灵文件（点号既是分隔符又被当扩展名）。⑰**实测**——s1–s13 全绿：顶栏首键 `⌃`、`page.q('#topbar')` 返回 `header/1280`、历史逐条回溯、`ls` 与 `ls('.home')` 一致、F5/F11/F12 的 `defaultPrevented` 为 `false/true/false`、四种窗动效类正确增删、拖拽穿越 iframe 不丢事件、`mailto:` 出面板块且 `target=_blank` 变内部标签、`shot('#desk')` 返回 307 KB dataURL、主题随系统、`write('.home.a.txt')` 报「父目录不存在」而 `.home.atxt` 立即可见。 |
| 0.0.0.1 | 2026-11-01 | **修错位、换顶栏、直连可用**：①**输出错位（截图里编号跑到右边）**——根因是 `convertEol:false` 且只发 `\n`，LF 只下移不回列，下一行从上一行末尾继续写；改 `convertEol:true`。同时补 `@xterm/addon-unicode11`（`activeVersion='11'`、`allowProposedApi:true`）修 CJK/emoji 宽度漂移，字体栈改严格等宽（去掉 `ui-monospace`/`SF Mono`，启动时 canvas 实测 M/i/W/0）。②**顶栏**——删掉左上角纯装饰的 `>_` 图标；「更多」从 `☰` 换成 `≥` 并留在右侧；中部新增**圆盘摇杆**（拖动发方向键、保持 180ms 连发、`setPointerCapture`），移除原来那四个 `←↑↓→` 按钮；宽屏改 `space-evenly` 均匀分布、窄屏均分铺满且隐藏 `.tb-left`。③**光标**——对齐参考项目：`bar` + 不闪烁 + 失焦描边 + 宽度 2；设置里可选 `bar/block/underline` 与闪烁开关。④**窗口拖拽**——标题栏/缩放手柄改 `setPointerCapture`（指针进 iframe 不再断流）+ `touch-action:none` + 拖动期 `iframe{pointer-events:none}`；`_startResize` 改用 `#desk` 相对坐标，修掉「一改大小就往下跳 54px」。⑤**ERR_UNKNOWN_URL_SCHEME**——新增 `classifyUrl()` 白名单，`mailto:/tel:/intent://` 等不再进 `iframe.src`，改为「需要外部应用」面板；iframe 加 `sandbox`；同源页面注入 `click`/`window.open` 拦截。⑥**主题**——删除手动选择，`matchMedia` 自动跟随系统并监听变化；「光标闪烁」「背景网格」「直连 API」「深度思考」全部改成开关。⑦**智能体直连**——可跳过 modelserver 由浏览器直接请求 OpenAI 兼容端点，密钥存本机并常驻风险警告；默认 `deepseek-flash`（`https://api.deepseek.com`），默认关闭思考模式（需要时可开，且正确回传 `reasoning_content`，否则带 tools 会 400）。⑧**实测**——多行输出 L1/L2/L3 均从第 0 列起；摇杆发送 3×`\x1b[B`；拖动 +120/+60 精确、穿越 iframe 时 +220 不丢事件；东侧改宽 +120 且 left 不变；`mailto:`/`tel:` 只出面板块、`src` 不含协议；390×844 顶栏 46px 零溢出；系统切深浅即时跟随；DeepSeek 直连纯对话 760ms、工具调用 1256ms、思考模式 5 轮工具 5606ms，均无 400。 |
| 0.0.0.0 | 2026-11-01 | **首版：确立版本号规则并把界面重做成参考项目的三段式**：①**版本号**——改为四段式 `X.Y.Z.W`，起始 `0.0.0.0`，以后每次默认末位加一；前端唯一来源是 `build/30-core.js` 的 `HT_VERSION`，Worker 通过 `init` 消息取（不再各自硬编码），顶栏/抽屉/启动屏/`.sys.version`/`uname` 全部读同一处；三份后端 `VERSION` 同步。②**顶栏**——原先是右上角一撮悬浮按钮，终端没有「顶」，不像一个终端应用；现改为整条 `header.topbar`：左品牌+版本+当前目录，中 `⌃⌥⇧ │ ␛ ⇥ │ ←↑↓→` 符号控制键，右 `▦` 应用启动器 / `⛶` 全屏 / `☰` 更多。③**修饰键**——完整实现参考项目的规则：短按切换锁定、按住临时生效、按住期间有输入则松手解锁；锁定 `⌃` 后敲 `c` 就是 `Ctrl+C`，手机终于能中断长任务。④**应用启动器**——新增 `▦` 弹出菜单（终端/浏览器/文件/编辑器/Python/智能体/更多），带快捷键提示。⑤**抽屉**——重排为 `drawer__user`（`>_` 头像 + 名称 + 版本 + 副标题）+ 八段 `drawer__section` + `drawer__foot`，标签列固定 72px 对齐。⑥**特殊字符**——新增 `--mono-sym` 符号字体栈与 `font-variant-emoji:text`，防止 `⌃⌥⛶` 被渲染成彩色 emoji 或缺字形；纯装饰图标（品牌）改内联 SVG。⑦**HTML 规范**——viewport 加 `maximum-scale=1,minimum-scale=1,user-scalable=no,viewport-fit=cover`；补 `theme-color`（明暗两条）、`format-detection`、`apple-mobile-web-app-*`；加 `<noscript>`；骨架改语义标签 `header/main/aside/footer`。⑧**修复**——顶栏出现后窗口 `style.top`（相对 `#desk`）与 `getBoundingClientRect()`（相对视口）混用，导致拖动多跳一截、最大化还原下移一格；浅色主题下 `bright*` 未跟主题走导致粗体标题看不清。⑨**实测**——顶栏锁定 `⌃`+`c` 捕获 `\u0003`、`⇥`/`␛` 分别 `\t`/`\u001b`；最大化尺寸 = `#desk`（1280×766）、还原 820×540、拖动位移与鼠标位移一致（+120/+60）；手机 390×844 顶栏 46px 且 `#ctrlRow` 零溢出；导入导出回环、Python 进出、`Ctrl+D` 重载、三份后端 `/health` 全部通过。 |
| — | — | （更早的历史见 git log；本表自 0.0.0.0 起建立） |

## 10. 智能体操作记录

> 倒序：最新在最上方。一条一个任务，写清动了哪些文件、怎么验证、推送了什么。

| 时间 | 任务 | 改动 | 验证 | 推送 |
| --- | --- | --- | --- | --- |
| 2026-11-03 14:20 | 0.0.1.6：十个工具（六个完整 + 四个壳）+ CLI + `sptm` 占位 + 真实页面实测 + 自举 + 理念章节 | `build/55-tools.js`（ToolKit/CalcParser/CalcApp/ShotApp/MdApp/MaintApp + `modalPrompt`/`pickFileInFs`）、`build/56-data.js`（编解码原语/Base32/MD5/DataApp/UrlHash/UrlHashApp）、`build/57-color.js`（ColorMath 六种互转/ColorApp/色相环/取色）、`build/00-head.html`（`.tl*`/`.calc*`/`.col*`/`.shot*`/`.uh*` 样式 + 启动器滚动与 `soon` 态）、`build/10-body.html`（启动器加 10 项）、`build/30-core.js`（`APP_DEFS` + `sptm`）、`build/40-term.js`（`_render` 分支 + 标题尺寸表）、`25-compat.js`（13 条命令 + `inputBytes`/`codec` 辅助）、`70-boot.js`（`util.hash`/`util.codec`/`fs.sptm` RPC）、`20-worker.js`（`sptm` 转发）、`build.sh`（拼三个新文件）、版本号 4 处 | Playwright：计算器 `2^3^2=512`/`sin30=0.5`/`5!=120`/`1/0` 报「除数是 0」；Base64/Base32/往返/SHA-256/MD5 全对；颜色 `#F00 → HSL(0,100,50)`、Lab 与 YUV 往返回 `[255,0,0]`、CMYK 100/0/0/0 → `#00FFFF`；Markdown 渲染标题/粗体且 `<script>` 与 `javascript:` 被清掉；UrlHash 400 字符压缩往返一致；截图 1100px 并写入 `.home.-xxshot-…png`；CLI `b64/hash/ts/mount/tools` 全通；2048/WinBox/98.css/Chart.js/p5.js 在小浏览器里跑起来；自举内层执行三条命令正常；无 pageerror | 本轮 |
| 2026-11-03 10:20 | 0.0.1.5：窗口间拖拽（文件↔文件/智能体/终端/浏览器）+ 小浏览器一键存网页 + 文件管理器多开 | `build/30-core.js`（`DRAG_MIME`/`DragBus`/`hasInternalDrag`/`uniquePathIn`/`isSameOrInside`/`dropIntoDir`/`htmlFileName`/`contentToDataUrl`）、`build/50-apps.js`（FilesApp `⧉` + `_bindDrop` 双通道 + dragstart 发布 item；BrowserApp 保存/下载按钮、`pageHtml`/`_pageName`/`saveToFs`/`downloadPage`/`openPath`/`_bindDrop`、标签 `draggable`、`.br-shield`）、`build/60-agent.js`（`addItems` + drop 分支）、`build/40-term.js`（`container.__term` + `insert()` 括号粘贴）、`build/70-boot.js`（`initDropImport` 双通道、`_termAt`、落点高亮、拖到终端先导入再粘路径、`dragend`/`blur`/`visibilitychange` 清场）、`build/00-head.html`（`.drop::after` 标签、`#term`/`.fm` 定位、`.br-shield`、`.txt` 按钮、`[draggable]` 光标）、`build/30-core.js`+`modelserver.{py,js,go}`（版本 0.0.1.5）、`README.md`（第 7 章拖拽整节重写、第 11 章补 `dropIntoDir`/`DragBus`、日志、踩坑第 41 条） | 无头 Chromium：两个 FM 窗口 A→B 复制 / Shift 移动 / 目录整棵复制 / 同目录 `-2`；FM→桌面终端与终端窗口均显示 `.home> .home.alpha` 且未执行；FM→浏览器 `srcdoc` 含文件内容；标签→FM 存 html、标签→智能体附件含正文；保存生成 `.home.*-2ehtml`、标题带 `.html` 不重复；遮板拖拽中 `display:block`、结束后 `body.drag-internal` 归位；无 pageerror | `main` |
| 2026-11-02 20:55 | 0.0.1.4：修「TUI 智能体进去就自己退出来」——`open()` 只打横幅不切模式 | `build/20-worker.js`（`AGENT_PROMPT`；`prompt()` 三路；`onSubmit` 新增 `mode==='agent'` 分支；`LineEditor` 新增 `onInterrupt` / `onCtrlD` 钩子并接进 `feed()`；`agentTui` 重写：`open/_run/line/send/queue/_drain/stop/close/helpOut` + `agentWidth/agentWrap` 折行 + `_startSpin/_stopSpin` 帧动画 + `_back` 记忆来路）、`build/30-core.js`（版本 0.0.1.4）、`modelserver.{py,js,go}`（版本）、`README.md`（§5.2 重写、§11 注明、开发日志、操作记录、踩坑第 40 条） | 无头 Chromium：`agentTui.open()` 后提示符变 `agent> ` 且停住；`:help` / `:q` 正常；未配置后端时错误留在 TUI 内不退出；`Ctrl+D` 回 `.home>` 后 `2+3` → `5`；mock 慢模型下 `Ctrl+C` 0.7s 中断并回提示符（`■ 已请求停止当前轮`）；窗口版 `agentOpen()` 仍存活；无 pageerror | `main` |
| 2026-11-02 17:45 | 0.0.1.3：拖拽导入/导出 + spotfs（六 syscall + 名字转义 + `.savefile`） | `build/30-core.js`（`spotEscape/spotUnescape/spotExportName`、`SPOT_NAME_RE`、`checkName` 放行转义名、`DIRS` 加 `.savefile`、`FS.sptc/sptn/spta/sptr/sptx/sptd`、`flushSavefile`、`saveFileRaw`、`importFiles`、种子 readme 改 spotfs）、`build/70-boot.js`（`initDropImport` + 遮罩 + `_hasFiles/_dropTarget`、RPC `fs.spt*`/`fs.escape|unescape|exportName`、boot 调用）、`build/20-worker.js`（`sptc/sptn/spta/sptr/sptx/sptd` + `spotEsc/spotUnesc/spotExport`，`api`/`api.fs` 暴露）、`build/50-apps.js`（FilesApp `_bindDrop`/`_prefetchBlob`/draggable 行/`DownloadURL`、`upload`/`download` 走 `importFiles`/`saveFileRaw`）、`build/60-agent.js`（drop → `.queryfile` + 附件）、`build/00-head.html`（`#dropVeil` 与动画）、`build/10-body.html`（遮罩 DOM）、`build/30-core.js`+`modelserver.{py,js,go}`（版本）、`README.md`（第 7 章三节、第 11 章、日志、踩坑 38-39） | playwright：转义往返 5 例、六 syscall 全通过、`.savefile` 导出删除、FilesApp/#desk/智能体三种 drop 落点正确、遮罩显隐、`DownloadURL` 格式正确、无 pageerror | `main` |
| 2026-11-02 15:30 | 0.0.1.2：智能体重复生成防护（连续 3 次相同输出 → 卡断 + 自动追问） | `build/60-agent.js`（`_turnSig` 输出签名、`_injectRepeatNudge` 自动追问、`run()` 循环内 `REPEAT_LIMIT=3` 计数与卡断、`render()` 处理 `system` 备注、`apiMessages()` 跳过 `system`、`AGENT_SYSTEM` 补一句）、`build/30-core.js`（`HT_VERSION`）、`modelserver.{py,js,go}`（版本）、`README.md`（9 章日志、10 章记录、12 章说明、踩坑 37） | 待 playwright 回归：构造一个会连续 3 次调同一工具的会话，确认第 3 次被卡断、日志出现「⚠ 已连续 3 次输出相同内容」、会话里多出一条 user 角色「【自动检查】…」、模型带着追问再跑一轮 | `main` |
| 2026-11-02 13:50 | 0.0.1.1：原生 API 全部转发、JSHeL/HSL 彻底分家、HSL 栈嵌套、删无意义移植、fastfetch、nano/vim 重写 + 鼠标、对话持久化、产品名统一 | `build/20-worker.js`（`nativeCall` 转发 + `NATIVE_ALLOWED`、删 `globalThis.print`、`KEYS` 增删、`onSubmit` 按 mode 分流、删 `isShellLine` 与语法指路提示、`hsl()`/`hsl.run`、`setMode`/`onEditorResize`、`LineEditor` 两处 `finally` 判 `raw`、resize 重画全屏、`help()` 重写）、`build/25-compat.js`（HSL 栈 `hslPush/pop/depth`、`def('hsl')`/`exit`、删 9 条命令、`longFmt` 去 rwx、`fastfetch`/`neofetch`、`makeEditor` 重写：双宽排版 + 绝对定位 + 显式配色 + 鼠标、`realPath` 按 cwd、`tryExternal` 只认 `.bin`）、`build/70-boot.js`（`nativeCall` + `sysInfo` + `native`/`sys.info` RPC、`Drawer.refresh` 填 `#stAgent`）、`build/60-agent.js`（新增 `AgentStore`：`ht-agent` 库、Blob 打包、先 prepare 后开事务、800ms 防抖 `flushSession`、从 JSONL 迁移）、`build/65-tui.js`（`status()` 走 `HeadlessAgent.ensure()`）、`build/30-core.js`（`HT_VERSION`、种子 readme/welcome、`.perm` 措辞）、`build/10-body.html`（抽屉「对话」行）、`build/{00-head,40-term,50-apps}.js`（产品名）、`modelserver.{py,js,go}`（版本）、`README.md`（5.1 重写、5.3 新增、6 章开头、踩坑 36 条、日志）、`IDEAS.md`、`licenses/README.md` | playwright：`dialog` 事件抓到 `alert/confirm/prompt` 三条真原生框；`1+1`→`2`；`ls -la`/`nano readme` → 语法/引用错误 + 「是 HSL 命令」提示；`hsl('uname')`→`HTerMinaL`；`hsl`→`cd /`→`hsl`→`exit`（回第 1 层、目录回 `.home`）→`exit`（回 JSHeL）→`1+1`→`2`；`help` 里 10 条删掉的命令全无、`fastfetch`/`neofetch` 在；`fastfetch` 九项全真值；nano 顶栏可见、状态栏 `4/28 行 · 8 列`、鼠标点第 5 行第 8 列输入落点正确、`^X` 干净退出；vim `:wq` 后 `cat newfile` 为 `hello\nworld`；`ll` 表头无 rwx；`AgentStore.save('main',4条)`→`{sessions:1,messages:4}`、`indexedDB.databases()` 含 `ht-agent`、`reload()` 后显示「已恢复 4 条消息」 | `main` |
| 2026-11-02 13:05 | 0.0.1.0 里程碑：一致性梳理（补 `.bin` 可执行、`chmod`、`sudo`、`nuke`、长名 API、5 条 shell 命令、file:// 说明、版本号残留） | `build/30-core.js`（`FS.write` 保留/推断 kind、`askFile` 保留扩展名、`.sys.license` 清单）、`build/25-compat.js`（`chmod`/`sleep`/`rev`/`tee`/`stat`/`xargs`、`sudo`、`diff` 报错）、`build/20-worker.js`（`nuke()`、长名别名、`settings`/`threads`、`inspect` 的 Module 分支、Python 横幅、`HT_VERSION`）、`build/70-boot.js`（`nuke.run`/`settings.set`/`settings.all` RPC、`refresh`/`checkBackend` 判空、`file://` 提示、启动即注入版本）、`build/60-agent.js`（`file://` 下的报错文案）、`build/10-body.html`（版本占位符）、`build/00-head.html`（许可注释）、`build/65-tui.js`（注释更正）、`README.md`（11 章说明、9 章 Python 说明、踩坑 29 条、日志）、`IDEAS.md`（对话持久化待办） | playwright：`.bin.hi`→42、`chmod +x/-x` 可逆、`sudo echo B` 一次、`nuke()` 确认后 `.home` 只剩 readme/welcome、`remove/move/copy/openWindow/closeWindow/listWindows/openURL/threads/settings` 全部 define、`sleep 1` 真等 1 秒、`tee/rev/xargs/stat` 正确、`askFile`→`.queryfile.hello-txt`、`require('lodash-es@4')` 回显 `Module(322 exports)` 且 `_.chunk` 可用、启动屏与抽屉显示 `0.0.1.0`、`page.q`/`page.eval`/`document.title`/`1+1` 无回归 | `main` |
| 2026-11-02 12:35 | 第三方许可证补齐 + `check-licenses.sh` + 对话持久化立项 | `licenses/LICENSE.marked.txt`、`licenses/LICENSE.html2canvas.txt`（新增，上游原文）、`licenses/README.md`（6 项清单、xterm 三个包共用 MIT、Markdown 渲染说明更正）、`check-licenses.sh`（新增）、`README.md`（11 章表、页脚版本、日志）、`IDEAS.md`（新增：对话持久化待办） | `./check-licenses.sh` → 6 项全「已登记」exit 0、4 个 `LICENSE.*.txt` 全存在；反向测试塞 `left-pad@1.3.0` → 「缺失 ✗」exit 1；playwright 起后端加载 `127.0.0.1:8787` 无 pageerror、`1+1`→`2`（确认 0.0.0.5 的安全头没把前端打挂） | `main` |
| 2026-11-02 12:40 | 后端安全加固：拒绝跨域与 null Origin（0.0.0.5） | `modelserver.py`（`origin_allowed` 拒 null、`security_headers`、`_deny` 日志、`local_only` 四重校验、`Content-Type` 415、`serve_index` 带头）、`modelserver.js`（同上，`LOCAL_NAMES`/`securityHeaders`/`deny`）、`modelserver.go`（同上，`securityHeaders`/`deny`）、`build/30-core.js`（版本）、`IDEAS.md`（许可证待办）、`README.md`（13 章安全模型重写、日志） | curl 三份后端：正常 200、evil Origin 403、null Origin 403、本机 Origin 200+ACAO、cross-site 403、坏 Host 403、text/plain POST 415、任意路径 403；`X-Frame-Options`/`frame-ancestors`/`CORP`/`COOP`/`Referrer-Policy`/`Permissions-Policy` 均在。Go `go build` 通过、JS `node --check` 通过 | `main` |
| 2026-11-02 12:10 | DOM 与 F12 对齐：真写、真节点、同步预取、事件回放（0.0.0.4） | `build/20-worker.js`（重写 DOM 代理：`DOMC` 镜像 + `nodeProxy` Proxy 句柄 + `prefetchDom` + `document` 重写 + `windowShim`、`Object.assign` 改逐个赋值、`open()` 认 URL、`self.onmessage` 加 `dom-event`）、`build/65-tui.js`（`DomRpc` 重写：`docWrite` 真调、`_tagAs` 预分配 ref、`snap`/`prefetch`/`queryAs`/`allIn`/`createAs`/`cloneAs`/`evalPage`/`listen` 事件转发、`_desc` 截断）、`build/40-term.js`（`_domSink` 注册与注销）、`build/70-boot.js`（`refresh` 加 null 守卫）、`build/30-core.js`（版本号）、`modelserver.{py,js,go}`（版本）、`IDEAS.md`（许可证待办）、`README.md`（5.3 重写、踩坑 27–29、日志） | 无头 Chromium：`document.write` 清空整页（`#desk` 消失、`#hi` 出现）、`body.innerHTML` 直写、`createElement`+`appendChild` 真入 `#topbar`、`style.color`/`classList`/`insertAdjacentHTML`/`remove` 生效、`el.addEventListener('click')` 回放后 `document.title=CLICKED`、`page.eval('1+1')=2`、`getBoundingClientRect().height=54`、`getComputedStyle().height=54px`、`matchMedia` 正确；s1–s14 回归全绿 | `main` |
| 2026-11-02 08:30 | 修回 JS 环境 / help 合并 / 振动归位（0.0.0.3） | `build/20-worker.js`（`document.write/writeln/open/close`、`innerHTML`/`textContent`/`value` 属性、`help()` 输出两段命令）、`build/25-compat.js`（删 `def('help')`）、`build/65-tui.js`（`haptic` 去掉 Settings 判断、新增 `docWrite`/`setHtml` RPC）、`build/40-term.js`（删 `onData` 里的振动、`sendDir` 加 `haptic(7)`）、`build/10-body.html`（删按键振动开关）、`build/70-boot.js`（删 setHaptic 绑定）、`build/30-core.js`（删 `haptic` 默认值、版本号）、`modelserver.{py,js,go}`（版本）、`README.md` | 无头 Chromium：`document.write` 开窗渲染 `DOC-WRITE-OK`、二次 write 复用同一窗口、`document.body.innerHTML` 后主界面仍在；`help` 同时含「JSHeL 快速参考」与「Linux 兼容层」；键入 3 字符 `vibrate` 计数 0、摇杆拖动计数 4；`1+1`/`const`/`await ls()`/`page.q`/`document.title` 均正常 | `main` |
| 2026-11-01 23:55 | 顶栏减负 / 兼容层 / TUI 智能体 / 窗动效 / HSL 记录（0.0.0.2） | `build/00-head.html`（删 `.tb-left` 系列、`.ht-cursor`、`body.fs`、`htWinIn/Out/Min/Restore` keyframes、`.ag-att`/markdown 样式、抽屉页脚随内容滚）、`build/10-body.html`（顶栏从 `⌃` 起、终端字号/显示行数/按键振动、步数 120、F 键说明）、`build/20-worker.js`（`convertEol` 后的历史游标修正、`prompt()` 固定格式、compat 挂载、`agentTui`、`shell`、`jshel`、DOM 代理）、`build/25-compat.js`（新增：MiniShell + coreutils + vim/nano + zsh）、`build/30-core.js`（`DEFAULTS`/`VOLATILE`/`_persisted`、`normPath` 重写、`rows`、`agentModel` 迁移、`write` 父目录校验）、`build/40-term.js`（自定义光标层、F5/F11/F12、`fixedRows`、`#desk` 相对拖拽、`loadScriptCached`、窗动效）、`build/50-apps.js`（sandbox、`srcdoc`、`htTok`、内部新标签、`window.open` patch）、`build/60-agent.js`（工具 `screenshot/window_html/ui`、`apiMessages` 配对、120 步、`stableKey`、三级降级、Markdown、多模态）、`build/65-tui.js`（新增：`AgentTuiHost` + DomRpc + `shot`）、`build/70-boot.js`（抽屉绑定、`wipeAllStorage`、`DepCache`、RPC 新增 `agent.*`/`dom.op`/`shot.*`、`toggleFullscreen` 统一）、`build.sh`、`modelserver.{py,js,go}`（根路径 + 403 + `scriptDir`）、`IDEAS.md`（新增：HSL 想法）、`README.md` | 无头 Chromium（s1–s13）：顶栏首键 `⌃`、`page.q('#topbar')` → `header/1280`、历史逐条回溯、`ls`/`ls('.home')` 一致、F 键 `defaultPrevented` `false/true/false`、窗动效类正确增删、拖拽穿 iframe、`mailto:` 面板块、`target=_blank` 内部标签、`shot` 307 KB、主题跟随、`write('.home.a.txt')` 报父目录不存在 | `main` |
| 2026-11-01 22:05 | 错位/顶栏/光标/拖拽/协议/主题/直连（0.0.0.1） | `build/00-head.html`（摇杆与开关/分段样式、无 logo、顶栏三段重排、`win-drag`、`.br-notice`）、`build/10-body.html`（顶栏结构、外观与智能体设置）、`build/30-core.js`（`Settings` 新增 `cursorStyle/agentMode/agentDirectUrl/agentKey/agentThinking`、`systemTheme`/`watchSystemTheme`）、`build/40-term.js`（`convertEol`、`unicode11`、`isStrictMono`/`xtermFont`、`_startDrag`/`_startResize` 重写、摇杆逻辑）、`build/50-apps.js`（`classifyUrl`/`schemeOf`、协议面板、iframe `sandbox`、同源注入）、`build/60-agent.js`（直连分支、`reasoning_content` 回传）、`build/70-boot.js`（开关/分段绑定、`syncAgentMode`、主题启动）、`modelserver.{py,js,go}`（版本）、`README.md`（顶栏图、直连说明、5.6/5.7、踩坑 15-17、日志） | 无头 Chromium：L1/L2/L3 均从第 0 列起；摇杆向下发 3×`\x1b[B` 且箭头高亮；拖动 +120/+60 精确、穿越 iframe +220 不丢事件；东侧改宽 +120 且 `left` 不变；`mailto:`/`tel:` 只出面板块且 `iframe.src` 不含协议；390×844 顶栏 46px、`docW=390`；`prefers-color-scheme` 切换即时跟；DeepSeek 直连 760/1256/5606 ms，工具与思考模式均无 400 | `main` |
| 2026-11-01 20:20 | 版本号规则 + 前端布局重做（0.0.0.0） | `build/00-head.html`（整份重写）、`build/10-body.html`（整份重写）、`build/40-term.js`（新增 `Keys`/`initTopbarKeys`/`deskBox`，窗口坐标改桌面相对）、`build/70-boot.js`（`AppMenu`/`toggleFullscreen`/抽屉类名/版本注入）、`build/30-core.js`（`HT_VERSION`、`applyGrid`）、`build/20-worker.js`（`state.version`）、`modelserver.{py,js,go}`（版本）、`README.md`（重写为两部分 + 开发日志 + 本表） | 无头 Chromium：启动无 pageerror；`⌃` 锁定+`c`→`\u0003`；`⇥`/`␛`→`\t`/`\u001b`；启动器开文件窗口；最大化＝桌面尺寸、拖动位移精确；390×844 顶栏 46px 零溢出；浅色主题粗体可读；导入导出回环、Python 进出、`Ctrl+D` 重载、三份后端 `/health` 均返回 `0.0.0.0` | `main` |

## 11. 许可证

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

- 前端依赖只用 CDN 上的 MIT / Apache-2.0 / MPL-2.0 项目（Pyodide 是 MPL-2.0，文件级 copyleft，与双许可无冲突）
- 不引入 GPL / AGPL / SSPL / Commons Clause / 非商业许可的任何东西
- 图标全部手写 SVG（见 `30-core.js` 的 `SVG_ICONS` 与 `10-body.html` 的内联图标），不用图标字体
- 示例文本、prompt、README 全部自己写，不抄有版权的内容
- 三份后端只用语言标准库，零第三方依赖

| 第三方 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [xterm.js](https://github.com/xtermjs/xterm.js) | 5.5.0 | MIT | 终端渲染 |
| [@xterm/addon-fit](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) | 0.10.0 | MIT | 终端自适应尺寸 |
| [@xterm/addon-unicode11](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11) | 0.8.0 | MIT | 东亚宽字符列宽 |
| [marked](https://github.com/markedjs/marked) | 12.0.2 | MIT | 智能体回复的 Markdown 渲染 |
| [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 | MIT | 智能体 `screenshot` 工具 |
| [Pyodide](https://pyodide.org/) | 0.26.4 | MPL-2.0 | Python 3.12 (WASM) |

改依赖后跑一次 `./check-licenses.sh`：它扫 `build/*.js` 与 `index.html` 里所有 CDN 地址，
比对 [`licenses/README.md`](licenses/README.md) 的登记表，缺一行就 exit 1。
`./build.sh` 已经把它放在第一步——**漏登记的依赖构建不出产物**。

## 12. AI 生成内容声明

**本项目的绝大部分源代码、文档与测试由 AI 智能体（WorkBuddy）生成，经人类作者审阅、调试与定稿。**

- `index.html` 及其全部 `build/` 分片、`build.sh`、三份 `modelserver`、本 README —— AI 生成
- `LICENSE-APACHE`、`LICENSE-MIT`、`licenses/LICENSE.*.txt` —— 从各自上游复制原文（非 AI 创作）
- 调试过程（[踩坑记录](#7-设计取舍与踩坑记录) 里的 43 条）由 AI 与人类共同排查完成

这意味着：

- 代码风格可能有人味不足的地方，注释密度偏高
- 边界情况的处理可能不如人类老手周全，**不建议直接用于生产环境**
- 但每一处逻辑都经过真实浏览器验证，不是「看起来能跑」

采用 Apache-2.0 OR MIT 而非更严格的许可，部分原因就是让 AI 生成内容的使用权尽可能清晰：
你可以任意使用、修改、商用、闭源分发，只需保留版权与许可声明。

---

<p align="center">
  <sub>HTerMinaL 0.0.1.1 · 桌面就是终端 · 一切皆文件</sub>
</p>
