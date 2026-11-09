# 待办 · 2026-11-09 第四批次（v0.0.1.30）

> 用户要求：①应用内弹窗按手绘统一；②拖拽遮罩加关闭、松手必须收；③页面内拖动不能触发外部导入提示；④文件管理器修双击、加「打开 / 执行」。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成并实测
>
> 第三批次（v0.0.1.29：执行器补全 + `.bin` 挑战集）已完成并推送（ee2740c、be85cb7、125a257）。

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

---

# 附：第三批次（v0.0.1.29，已完成）

> 用户要求：用记事本记下任务、一条一条做、不要擅自停、有问题最后集中问。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成并实测
>
> 第二批次（v0.0.1.28：手势锁 / 抽屉滑关 / Dock 折叠 / 汉字码双向 / 调色盘）已全部完成并推送（83dcb11、df8a428）。

### A. 共享求值器（REPL / 智能体 js 工具）

- [x] 顶层语句扫描：按括号深度 0 的 `;` / 换行切，跳过字符串、模板串、行注释、块注释、正则
- [x] 跨行声明不再被拆成残句（`const a = {` / `  b: 1` / `}`）
- [x] `class` 声明持久化（`globalThis.X = class X …`）
- [x] 解构声明持久化（`const {a, b: c} = o` / `const [x, y] = arr`）
- [x] 多声明持久化（`const a = 1, b = 2`，按顶层逗号切）
- [x] 整段都是声明时不回显值（与浏览器控制台一致）
- [x] `_` = 上一次结果（undefined 不覆盖）
- [x] `$` / `$$` = querySelector / querySelectorAll 简写
- [x] `//# sourceURL=HTRepl.js`，报错堆栈可读
- [x] `console.time / timeEnd / timeLog / count / countReset / group / groupEnd / assert`
- [x] `console.table` 输出对齐表格

### B. DOM 同步语义（Worker 侧代理）

- [x] 本地影子节点：createElement / createTextNode / createFragment 立刻可读写
- [x] 属性写入立刻可读：setAttribute / dataset / textContent / innerHTML / value / className / id
- [x] appendChild / append / prepend / insertBefore / removeChild / replaceChild 维护本地父子树
- [x] 挂载进文档才登记 id（未挂载的节点不污染 getElementById，与原生一致）
- [x] `document.getElementById` / `querySelector('#id')` 同步命中本地索引
- [x] `innerHTML` 里的 id 异步换回真 ref 登记（`await sleep(0)` 后可查）
- [x] `canvas.getContext('2d'/'webgl')` 走本地 OffscreenCanvas，`getImageData` 真像素
- [x] `canvas.toDataURL` / `toBlob`（异步）
- [x] `document.forms / images / links / scripts / embeds / styleSheets / fonts / timeline`
- [x] `window.getSelection` / `document.getSelection` / `createRange` / `execCommand`
- [x] `document.appendChild / insertBefore / removeChild / replaceChild / contains`
- [x] 事件只绑一次 document（修一次点击回放两次）

### C. `.bin` 挑战脚本

- [x] `audit` 能力自检 25 项（语言核心 / 浏览器 API / DOM / Canvas / 事件 / 加密）
- [x] `bench` 9 项基准 + 混合算力
- [x] `nqueens` 位运算回溯，1–12 皇后（合计 18092 解）
- [x] `maze` DFS 生成 + A* 最短路
- [x] `raytrace` 逐像素光线追踪，ASCII 出图
- [x] `expr` 手写词法 + 递归下降解释器（变量 / 函数 / 右结合幂）
- [x] `crypto` SHA-256/512、HMAC、PBKDF2 10 万次、AES-GCM、UUID
- [x] `async` 并发池 / allSettled / AbortController 超时 / 异步生成器流水线
- [x] `reactive` Proxy 依赖收集 + 真 DOM 更新（mini Vue）
- [x] `gen` 无限流 / 惰性管道 / zip / 自定义迭代器
- [x] `life` 生命游戏 ANSI 动画 60 代

### D. `.bin` 挑战 HTML

- [x] `html-particles` Canvas 粒子星云（鼠标斥力 + 连线 + FPS）
- [x] `html-snake` 贪吃蛇（方向键 / WASD / 触屏滑动 / 最高分）
- [x] `html-mandelbrot` 分形（滚轮缩放 / 拖动平移 / 平滑着色）
- [x] `html-lisp` 页面内迷你 Lisp（tokenizer / reader / 闭包 / 递归）
- [x] `html-webgl` 手写顶点片元着色器 + 旋转立方体
- [x] `html-audio` Web Audio 合成器 + 频谱可视化
- [x] `open()` 识别 HTML 直接进浏览器窗口

### E. 顺手修掉的旧 bug

- [x] `.bin` 脚本里的 `print` 在 JSHeL 里从未定义（种子示例一跑就 ReferenceError）
- [x] `sptx` 的 html 分支引用主线程 `baseName`，Worker 里没有 → 打开任何 HTML 都崩
- [x] `api.console` 覆盖掉 bootShell 新建的 console（time/table 全失效）
- [x] 事件同时绑 document 与 window，一次点击回放两次
- [x] `deskBox()` 缺 left/top（上一批已修，本批回归确认）

### F. 收尾

- [x] 全部脚本实测（audit 25/25、nqueens 18092、maze、raytrace、expr、crypto、async、reactive、gen、life）
- [x] 6 个 HTML 实测截图（WebGL 在无 GPU 的 headless 里降级提示）
- [x] 版本 0.0.1.29 + README 开发日志
- [x] 提交推送（ee2740c）
