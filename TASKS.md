# 待办 · 2026-11-08 第三批次（v0.0.1.29）

> 用户要求：用记事本记下任务、一条一条做、不要擅自停、有问题最后集中问。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成并实测
>
> 第二批次（v0.0.1.28：手势锁 / 抽屉滑关 / Dock 折叠 / 汉字码双向 / 调色盘）已全部完成并推送（83dcb11、df8a428）。

## A. 共享求值器（REPL / 智能体 js 工具）

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

## B. DOM 同步语义（Worker 侧代理）

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

## C. `.bin` 挑战脚本

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

## D. `.bin` 挑战 HTML

- [x] `html-particles` Canvas 粒子星云（鼠标斥力 + 连线 + FPS）
- [x] `html-snake` 贪吃蛇（方向键 / WASD / 触屏滑动 / 最高分）
- [x] `html-mandelbrot` 分形（滚轮缩放 / 拖动平移 / 平滑着色）
- [x] `html-lisp` 页面内迷你 Lisp（tokenizer / reader / 闭包 / 递归）
- [x] `html-webgl` 手写顶点片元着色器 + 旋转立方体
- [x] `html-audio` Web Audio 合成器 + 频谱可视化
- [x] `open()` 识别 HTML 直接进浏览器窗口

## E. 顺手修掉的旧 bug

- [x] `.bin` 脚本里的 `print` 在 JSHeL 里从未定义（种子示例一跑就 ReferenceError）
- [x] `sptx` 的 html 分支引用主线程 `baseName`，Worker 里没有 → 打开任何 HTML 都崩
- [x] `api.console` 覆盖掉 bootShell 新建的 console（time/table 全失效）
- [x] 事件同时绑 document 与 window，一次点击回放两次
- [x] `deskBox()` 缺 left/top（上一批已修，本批回归确认）

## F. 收尾

- [x] 全部脚本实测（audit 25/25、nqueens 18092、maze、raytrace、expr、crypto、async、reactive、gen、life）
- [x] 6 个 HTML 实测截图（WebGL 在无 GPU 的 headless 里降级提示）
- [x] 版本 0.0.1.29 + README 开发日志
- [ ] 提交推送
