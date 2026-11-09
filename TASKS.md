# 待办 · 2026-11-09 第六批次（v0.0.1.32）

> 用户要求：①新增 HTML 编辑与渲染器（老实渲染、明确不做安全过滤、代码区用 canvas）；②新增 Tab 补全，把 JSHeL 支持的所有用法列成表；③吸附判定只认提手位置、必须几乎紧贴才触发；④桌面越来越卡（消息风暴 / 该进 Worker 的没进）；⑤Tab 补全「补了个寂寞」——补成了当前目录文件；⑥手机粘贴多行文本跑不起来。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成并实测
>
> 第五批次（v0.0.1.31：窗口交互大修 + 渲染守护 + 计时器）已完成，见文末附录。

## A. HTML 编辑与实时渲染器（`htmlapp`）

- [x] 新应用 `build/61-html.js`，`APP_DEFS` / `TYPE_TITLES` / `TYPE_SIZE` / `_render` 全部接上
- [x] **代码区 canvas 2D 自绘**：行号栏、关键字/标签/属性/字符串/注释/数字着色、逐字符宽度表（中文两格）
- [x] 光标与选区自己画：点击定位、拖选、Shift+方向 / Home / End 扩选，闪烁只在聚焦时
- [x] 1px 透明 textarea 只当 **IME 代理**（`opacity:.01`、`caret-color:transparent`、绝对定位跟随光标）
- [x] 编辑语义：Enter 延续缩进（`<tag>` 结尾再加两格）、Tab / Shift+Tab 整块缩进、Ctrl+Z 撤销 / Ctrl+Shift+Z 重做、Ctrl+S 存盘、Ctrl+Enter 立即运行
- [x] 语法高亮在 **Worker** 里做词法（`HxWorker`，token `{s,e,k}` 回传），3 秒无响应降级成单色
- [x] 右侧 iframe **老实渲染**：`<script>` / `on*` / `javascript:` 一律不过滤；默认 `sandbox`，「隔离」按钮可摘
- [x] 边打边渲染：180ms 防抖、保留 iframe 滚动位置、状态栏显示耗时与体积；可切「自动 / 手动运行」
- [x] 布局：宽 ≥620px 左右分栏，窄了自动改上下（`clientWidth` 判定，不受开场 `transform:scale()` 影响）
- [x] 深 / 浅两套调色板整套切换（字色、标签、属性、字符串、注释、行号、选区、光标）
- [x] 存进 `.home`（文件名走 `spotEscape`）、读本地文件；`onResize` / `dispose` 清理 Worker 与定时器
- [x] 与小浏览器**并存**，互不替代

## B. Tab 补全（重写）

- [x] **修「补成当前目录文件」**：先判类型再决定去哪找——路径（`./` `../` `~/`）才问文件系统
- [x] 成员链 `obj.a.b.`：主线程 `htSurface()` 沿原型链爬 3 层（跳过 `_` 开头），随 `init` 送进 Worker（~39 KB，`window` 1366 项）
- [x] 纯标识符：`globalThis` + `surface.extra` + 已声明变量
- [x] 候选**排成表**：类型上色（函数青/类紫/目录蓝/字符串绿/数字黄）、名字列按显示宽度对齐、每项一句话说明、超宽折行
- [x] **按一次补公共前缀，同位置再按一次才列表**（`_tabAt`）
- [x] 新增全局 `api()` / `apiList()` / `api('过滤')`：9 组手写名单 + 说明，打印成表格
- [x] `help()` 补「补全」「全表」两行
- [x] 补全永不打断输入：求值失败 / 路径不存在一律返回空候选，候选上限 200

## C. 吸附只认提手

- [x] 阈值 `EDGE=46` 收回 `SNAP=10`
- [x] 判定矩形 = `.win-handle` 自己的 `getBoundingClientRect`，与窗口其它部分、其它参数无关
- [x] 左/右/顶用提手边距，底部 40px 判「最小化」，中间带用提手中心 25%–75%
- [x] 实测：离边 30px 不吸；贴 2px 才吸（left 后 `x:0, w:700`）

## D. 性能

- [x] `TimerApp` 去掉无条件 `setInterval(50)`：秒表跑 50ms、倒计时 200ms、全停 `clearInterval`
- [x] `_cacheEls()` 缓存 9 个元素引用；`_txt()` 值没变不写 DOM；计次列表只在条数变化时重建
- [x] `HtmlApp` 的高亮计算放 Worker，主线程只画
- [x] 实测：7 窗空闲 6s DOM 变更 **0**（修前 1280+）；帧间隔 p50 16.7 / p95 16.8 / 长任务 0

## E. 手机粘贴多行

- [x] 根因：手机 IME 粘贴不带 xterm 括号粘贴标记（`\x1b[200~`），整段被当一串回车逐行执行
- [x] `feed()` 里识别「一次性到达的多字符且含 `\n`」→ 整段 `insert()` 进缓冲
- [x] 由 `scanJs()` 判断括号闭合后一次执行；实测 14 行 IIFE `[粘贴 14 行]` → `done 49`

## F. 文档与实测

- [x] `tests/test_htmlapp.py`：canvas 行数/行号、点击定位、键入、Tab 缩进、Ctrl+Z、渲染、`<script>` 执行、保存、分栏、窄窗、浅色
- [x] `tests/test_complete.py`：`doc` / `document.quer` / `Math.` / `./` / `api()`
- [x] `tests/test_snap_paste.py`：吸附两档 + 14 行粘贴
- [x] `README.md`：新增 §5.5 Tab 补全、§15 工具表加 htmlapp/timer、文件地图补 4 个文件、开发日志与操作记录
- [x] 版本 0.0.1.32（`HT_VERSION` + 三份后端）

---

# 附：第五批次（v0.0.1.31，已完成）

> 用户要求：18 条，涵盖窗口交互（双击最大化 / 隐藏式胶囊 / 红点强制关闭 / 底部黄框最小化 / 左边缘吸附 / 四色值 / Dock 下限 / 全屏联动 / Dock 长按）、智能体（纯图片发送 / 收敛护栏 / 清空确认）、应用（HSV 镜像 / `.bin`→`.app` / 所有应用分组与双视图 / 数据转换联动 / 汉字码联动 / 截图隐藏窗口 / 计时器）、性能（渲染守护 / 卡顿）。

> 用户要求：18 条，涵盖窗口交互（双击最大化 / 隐藏式胶囊 / 红点强制关闭 / 底部黄框最小化 / 左边缘吸附 / 四色值 / Dock 下限 / 全屏联动 / Dock 长按）、智能体（纯图片发送 / 收敛护栏 / 清空确认）、应用（HSV 镜像 / `.bin`→`.app` / 所有应用分组与双视图 / 数据转换联动 / 汉字码联动 / 截图隐藏窗口 / 计时器）、性能（渲染守护 / 卡顿）。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成并实测
>

## A. 窗口标题与色点

- [x] 标题栏双击 = 常规最大化（`mode:'max'`，宽度 100%），再双击回 `normal`
- [x] **隐藏式最大化只留一个 26px 圆形图标**：删掉 `<b>窗口</b>` 文字、删掉 `title`，改 `aria-label`
- [x] **独占**：新的窗口进隐藏模式时，已占据的旧窗口退回 `max`
- [x] **长按色点（550ms）不再弹文字浮框**，改为「红黄绿蓝」四圆钮横排、框内零文字
- [x] **长按 Dock 图标**弹同一套四钮框（`_bindDockMenu`）
- [x] **长按胶囊**同样弹四钮框；窗口形态切换 / 关闭 / 聚焦时 `DotMenu.close()` 防锚点漂移
- [x] 四色值：红 `#e01715`、黄 `#f5b900`、绿 `#8de312`、蓝 `#19e6f0`（抽成 CSS 变量）

## B. 四种窗口形态

- [x] **红点 = 强制关闭**：`close()` 立即 `dispose()`——智能体 abort 在跑的一轮并落盘，hsb2 停 v86；没有「后台」概念
- [x] **绿点彻底全屏**：真发 `requestFullscreen({navigationUI:'hide'})`，并同步点亮顶栏「全屏」按钮
- [x] Esc / F11 退出浏览器全屏时，`fullscreenchange` 监听同步退出 `immersive`
- [x] 全屏态下点顶栏「全屏」→ 走 `WindowManager.exitImmersive()`，不再出现「按钮亮着但没反应」
- [x] **Dock 是窗口下底的默认下限**：`open()` 按 dock 显隐算 `dockReserve`（20 / 82），`maxH = vh - dockReserve`；只有用户拖动后才可越过

## C. 拖拽吸附

- [x] **靠左贴放失效修复**：`EDGE` 从 10px 放宽到 46px，判定同时看指针坐标与窗口自身边缘（`wl <= 6`）
- [x] **拖到画布底部中间**：`py >= box.h - 140 && midX` → `snapPos = 'min'`，画**黄色**预览框（`[data-pos="min"]`）
- [x] 黄框尺寸 `_snapRect.min = {x:29% w, y:h-150, w:42% w, h:88}`，不压住 Dock
- [x] 松手后先归位再 `minimize(win.id)`

## D. 性能与渲染守护

- [x] 新增 `build/68-guard.js`：`Guard` 用 **Worker 心跳每 10 秒**巡检（避免后台标签页 `setInterval` 被节流）
- [x] `resize` 事件立即巡检一次；`Guard.every(name, fn, ms)` 作为后续所有守护任务的统一注册口
- [x] 修正项：NaN / 过小（<280×188）/ 过大（>画布）/ 完全出界 / 提手高过窗口 55% / 文档横向溢出
- [x] 每次修正后 `w._guardUntil = now + 15000`「睡死时间」，期间不再动它，防闪烁
- [x] 卡顿：`htWinIn/Out/Min/Restore` 关键帧**删掉 `filter:blur`**；`.win` 去掉常驻 `will-change`；拖动期间关闭 `backdrop-filter`

## E. 智能体

- [x] **只贴图片、一个字不写也能发**：`act('send')` 判 `!text && !attachments.length` 才 return
- [x] **收敛护栏**（借鉴 seekHarness 的三条机制，非代码复用）：单轮 `TIME_BUDGET = 8min`、观察结果连续两次相同 → `stalled`、连续 4 次 JS 失败 → `jsfail`、重复输出追问上限 2 → `repeat`
- [x] 每种停止都 push 一条 `role:'error'` 说明，用户知道为什么停
- [x] 「更多」抽屉里的**会话清空加确认框**（`agentClear()` 走 `confirmDlg`）

## F. 应用

- [x] 调色盘 HSV 选区**上下镜像**：先 `hsvToRgb` 再 `rgbToHsl` 存 `s/l`，标记点改用 `rgbToHsv` 的 `s/v`
- [x] `.bin` → `.app`：`DIRS`、种子、`write()` 只读保护、`remove()`、正则、`tryExternal` 全部改；新增 `migrateBinDir()` 旧数据搬迁
- [x] 「所有应用」：按**系统预装**（含维护中）/ **已安装**（读 `.app` 目录）分组，新增**列表 / 方块**双视图（存 `Settings('applistView')`）
- [x] 数据转换：删「转换」按钮改**四格实时联动**（秒 / 毫秒 / 日期 / 时区都能填），删「现在时间」栏目改**标题栏按钮**，卡片加标题栏与左侧色条、顶部改**真选项卡**
- [x] 汉字码：输入汉字识别出方案后**顶部选项卡自动跟随**；删掉「自检通过」「已按 4096 字编码」
- [x] 截图：「截图时隐藏本窗口」复选框，`visibility:hidden` + `finally` 恢复
- [x] 新增**计时器 / 秒表**（`TimerApp`：秒表厘秒 + 计次 + 复位；倒计时时分秒 + 快捷 1/3/5/10 分 + WebAudio 三声；`dispose()` 清 interval）

## G. 文档与实测

- [x] `README.md`：版本 0.0.1.31、全部 `.bin`→`.app`、新增「`.app` 里装了什么」目录索引、新增 §8.2 致谢 seekHarness（wingchi-leung，MIT）、新增 §5.9 四色点与四钮框规范
- [x] 双击最大化 `{mode:'max', width:'100%'}`
- [x] 长按红点 `{n:4, txt:''}`；Dock 长按 `n:4`；胶囊 `{txt:'', w:26, title:null, svg:true}`
- [x] 彻底全屏 `{body:true, fsBtn:true, ball:'grid'}`
- [x] 左吸附 `{'pos':'left'}`、底部黄框松手 `minimize` 生效
- [x] 守护：人为设 40×30 / left 5000 / top −200 → 修正为 280×188, l:1110, t:0
- [x] 时间戳四格：`1700000000` → `ms 1700000000000`、`dt 2023-11-15 06:13:20`
- [x] 汉字码：2048 方案编码后粘回 → 顶部切到 `['B']`，解码回 `48656c6c6f`
- [x] HSV：top 5.1%/v95、bottom 94.9%/v5、mid 49.8%/v50 —— 镜像消除
- [x] 计时器：秒表 `00:01.29`、计次 `#1 00:01.34`；倒计时 `01:00`→`00:59 倒计时中`
- [x] 截图隐藏：`2200×1532 · 1.31 MB`，事后 `visibility: visible`
- [x] 智能体纯图片 `{called:1, atts:1}`；停滞停止 `⏹ 连续多次输出相同内容…已停止本轮。`
- [x] 所有应用：系统预装 20 + 已安装 20（14 func + 6 html）
- [x] 回归 `tests/test_dialog.py` 全绿、`tests/test_fm.py` 全绿、0 pageerror
- [x] `build.sh` 拼入 `68-guard.js`；三份后端版本号同步

---

# 附：第四批次（v0.0.1.30，已完成）

> 用户要求：①应用内弹窗按手绘统一；②拖拽遮罩加关闭、松手必须收；③页面内拖动不能触发外部导入提示；④文件管理器修双击、加「打开 / 执行」。

## A. 统一对话框（`modal()` 换皮不换接口）

- [x] 卡片：标题居中，危险操作整条标红；正文可滚动；底部左「取消」右「确认」
- [x] 把手：卡片底边垂下的梯形 + 「?」，两端圆形按钮（灰禁止符 / 红垃圾桶 / 绿右箭头 / 绿对勾）
- [x] 类型自动判别：`danger`（有 danger 按钮）· `ask`（body 里有 input/textarea/select）· `ok` · `info`（单按钮，不画把手）
- [x] 热区：底部两段整条可点，圆钮可点，文字与图标同一动作（圆钮点的是文字按钮，校验逻辑只有一份）
- [x] 蒙层 = 取消；Esc = 取消；背景模糊保留（7px + saturate）
- [x] 11 处调用点零改动（清空数据 / 重命名 / 选文件 / 加文字 / 链接运行脚本 / 关于 / 计算器说明…）
- [x] 浏览器原生 alert / confirm / prompt 不动（全仓无覆盖）

## B. 拖拽遮罩

- [x] 页面内拖动不再弹导入遮罩：先判 `DRAG_MIME` / `DragBus`，再判 `Files`（DownloadURL 会让 Chrome 塞进 Files）
- [x] 松手必收：capture 阶段收 drop；dragend / pointerup / blur 兜底；1.5s 无 dragover 看门狗
- [x] 右上角 ✕ 明确关闭（pointer-events:auto，其余区域仍不挡 drop）
- [x] 拖出窗口（relatedTarget=null）即收，不再靠 dragenter/dragleave 计数

## C. 文件管理器

- [x] 双击：事件委托 + 420ms 时间窗（列表重建不影响），`open()` 500ms 去重
- [x] 工具栏「打开」：文本→编辑器、图片→看图、目录→进入、app/func→各自入口
- [x] 工具栏「执行」：HTML→浏览器窗口、JS→shell 窗口真跑（输出在终端）、app/func 各自入口、其余明确拒绝
- [x] Enter 打开 / Ctrl+Enter 执行；工具栏按钮加边框与 hover
- [x] 选中高亮在列表重建后保持；换目录自动清空选中

## D. 实测与收尾

- [x] `tests/test_dialog.py`：危险框截图、圆钮取消/确认、info 无把手、蒙层关闭、Esc 关闭、内部拖拽不弹、外部拖拽弹、drop/✕/看门狗三种收法
- [x] `tests/test_fm.py`：执行 JS（打印 run-ok 42 / sum 55）、执行 HTML（srcdoc 75）、打开进编辑器、鼠标双击只开一个窗口
- [x] 浅色 / 手机宽度截图检查；无 pageerror
- [x] 版本 0.0.1.30 + README 开发日志
