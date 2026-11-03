# 第三方许可清单

本目录存放 **hterminal 通过 CDN 引用的第三方组件**的许可证原文。

hterminal 本体采用 `Apache-2.0 OR MIT` 双许可（见上级目录的 `LICENSE-APACHE` 与 `LICENSE-MIT`）。
下列组件均与其兼容，不会对双许可构成冲突。

## 清单

| 组件 | 版本 | 许可证 | 许可证文件 | 引入方式 | 用途 |
| --- | --- | --- | --- | --- | --- |
| [xterm.js](https://github.com/xtermjs/xterm.js) | 5.5.0 | MIT | `LICENSE.xterm.js.txt` | CDN（jsdelivr / unpkg） | 终端渲染引擎 |
| [@xterm/addon-fit](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) | 0.10.0 | MIT | `LICENSE.xterm.js.txt` | CDN（jsdelivr / unpkg） | 让终端自适应容器尺寸 |
| [@xterm/addon-unicode11](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11) | 0.8.0 | MIT | `LICENSE.xterm.js.txt` | CDN（jsdelivr / unpkg） | 东亚宽字符/emoji 的列宽计算 |
| [@xterm/addon-canvas](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-canvas) | 0.7.0 | MIT | `LICENSE.xterm.js.txt` | CDN（jsdelivr / unpkg） | 逐格绘制，避免 DOM 渲染器把 ZWJ emoji 连字后与单元格错位 |
| [marked](https://github.com/markedjs/marked) | 12.0.2 | MIT | `LICENSE.marked.txt` | CDN（jsdelivr / unpkg） | 把智能体回复的 Markdown 转成 HTML |
| [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 | MIT | `LICENSE.html2canvas.txt` | CDN（jsdelivr / unpkg） | 智能体 `screenshot` 工具 |
| [Pyodide](https://pyodide.org/) | 0.26.4 | MPL-2.0 | `LICENSE.pyodide.txt` | CDN（jsdelivr / unpkg） | 在浏览器里跑 CPython 3.12 (WASM) |

`@xterm/addon-fit`、`@xterm/addon-unicode11`、`@xterm/addon-canvas` 与 `xterm.js` 同属一个仓库、同一份 MIT 许可，
因此共用 `LICENSE.xterm.js.txt`。

`LICENSE.marked.txt` 除了 marked 自己的 MIT 文本，还包含上游随附的 **Markdown（John Gruber）BSD 声明**，
那是 marked 项目对 Markdown 语法的致敬性声明，一并保留原文。

> 这张表由 `check-licenses.sh` 兜底：它会扫 `build/*.js` 里所有 `npm/<包>@<版本>` 形式的 CDN 地址，
> 缺登记就报错。**加依赖忘了登记，脚本会拦下来。**

## 兼容性说明

### MIT × Apache-2.0 OR MIT

MIT 与 Apache-2.0 互相兼容，也与"MIT 或 Apache-2.0"这种选择型双许可完全兼容。
xterm.js 家族采用 MIT，可自由用于本项目。

### MPL-2.0 × Apache-2.0 OR MIT

MPL-2.0 是**文件级**弱 copyleft：它要求"对 MPL 覆盖文件的修改必须以 MPL 公开"，
但不传染到同项目的其他文件，也不限制整体作品的许可。

本项目对 Pyodide 的使用方式：

- **不修改** Pyodide 源码，也不打包其产物
- 运行时通过 CDN 以 `<script>` / `importScripts` 方式加载官方构建
- 因此不产生任何需要以 MPL 公开的衍生文件

在这种使用方式下，MPL-2.0 与 Apache-2.0 / MIT 共存无冲突。
（即便将来需要修改 Pyodide，只要把改动过的文件以 MPL 公开，其余部分仍可维持双许可。）

## 明确排除

以下类型**永不引入**，无论功能上是否方便：

- GPL-2.0 / GPL-3.0 / AGPL-3.0（强 copyleft，与双许可目的冲突）
- SSPL / BUSL / Commons Clause / Elastic License（非 OSI 认可或含商用限制）
- 任何 "non-commercial" / "for evaluation only" / "no derivative" 条款的代码或资源
- 来源不明、无许可证声明、或仅口头授权的代码片段
- 有版权但被当作"免费素材"传播的字体、图标集、示例文本、图片

## 自研替代

为减少第三方依赖，以下部分均为手写，不引入外部资源：

| 需求 | 通常做法 | 本项目做法 |
| --- | --- | --- |
| 图标 | 图标字体 / SVG 图标集 | 手写 SVG，见 `build/30-core.js` 的 `SVG_ICONS` |
| 终端行编辑 | 引入 readline 库 | 自研 `LineEditor`（`build/20-worker.js`） |
| HTML 消毒 | DOMPurify | 自研白名单 `sanitizeHtml()`（`build/60-agent.js`），只留标签/属性表里的东西 |
| 窗口拖拽 | interact.js / draggable | 原生 Pointer Events |
| HTTP 客户端（后端） | requests / axios / go-resty | 各自语言标准库 |

Markdown 渲染用 CDN 上的 `marked`，但**渲染结果一律过 `sanitizeHtml()`** 才进 DOM：
`marked` 只负责语法转 HTML，不负责安全，这条分工不能搞反。

## 更新流程

升级第三方版本时，请同步做三件事：

1. 改 `build/40-term.js`（xterm）或 `build/20-worker.js`（Pyodide）里的版本号常量
2. 更新本文件的版本列
3. 重新下载对应许可证原文覆盖 `licenses/` 下的文件，并核对是否换了许可

```bash
# 例：抓 Pyodide 的 MPL-2.0 原文
curl -fsSL https://www.mozilla.org/media/MPL/2.0/index.815ca599c9df.txt \
  -o licenses/LICENSE.pyodide.txt
```
