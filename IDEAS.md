# 想法池 · Ideas

> 这里只放**还没开工**的想法。写清楚「想做什么 / 为什么可行 / 卡在哪 / 第一步怎么迈」，
> 以免下次接手时只剩一句口号。做完了就搬到 README 的开发日志里，并从这里删掉。

---

## HSL —— HTML Subsystem for Linux

> 提出：2026-11-01　状态：**仅记录，未开工**
> 一句话：在 `index.html` 里跑 Linux 程序，像 WSL 之于 Windows。

### 想做什么

现在 `build/25-compat.js` 里的 `ls / cat / grep / vim / nano` 都是**用 JS 重写**的命令，
长得像 Linux，骨子里是 JavaScript。HSL 要把这层「像」换成「是」：

1. **真的能 `exec` 一个可执行文件** —— `./hello`、`/usr/bin/wc`，走 `execve` 语义，不是 switch-case 分发。
2. **fext4（fake ext4）** —— 一个能被 `mount` 的文件系统：superblock、inode 表、目录项、权限位、
   mtime、硬链接、符号链接都在，`stat` 出来的 `st_ino` 稳定且不重复。名字叫 fake，是因为
   它不追求能 `fsck` 通过，只追求**对上层表现得像 ext4**。
3. **WASM 可执行文件** —— `wasm32-wasip1` 编译出来的 `.wasm` 直接双击能跑；
   `ELF` 则先判别架构，能翻的翻，翻不了的明确报错，而不是假装支持。
4. **POSIX 该有的都有** —— 管道、重定向、`&` 后台、`$?`、环境变量、`/proc` 里能看到 pid、fd、cmdline。

### 三条腿，分开落

| 层 | 内容 | 难度 | 依赖 |
| --- | --- | --- | --- |
| **L1 文件系统** | fext4：块设备 + ext4 元数据读写，挂到 `/` | 中 | 纯 JS，无外部依赖 |
| **L2 加载器** | ELF 头解析 / WASM 模块实例化 / 动态链接的取舍 | 中高 | 无（WASI 运行时自研） |
| **L3 系统调用** | WASI preview1 的 `fd_*` / `path_*` / `clock_*` / `poll_*` 映射到 fext4 + xterm | 高 | L1 |

### 可行性判断（别自欺）

- **wasm32-wasip1 这条路是真的能走通的**。`clang --target=wasm32-wasip1` 编出来的
  coreutils 子集、`lua`、`sqlite3`、`busybox` 的 wasm 版都实际存在。
  只要把 WASI 的 30 来个 syscall 实现掉，它们**不改一行源码**就能跑。
- **原生 x86-64 ELF 这条路，单文件里走不通**。要跑就得塞一个用户态指令翻译器
  （v86 / qemu-wasm 量级，几 MB 到几十 MB），和「单文件 300 KB」的定位直接冲突。
  真要支持，只能是**可选重型模式**：用户点一下，从 CDN 拉、缓存进 IndexedDB，
  并且明说「这不是 HSL 的核心，是外挂」。
- **ext4 全量实现不现实**。extent 树、journal、64bit、metadata_csum 全做等于重写 e2fsprogs。
  现实目标是「**只读挂载真镜像 + 可写挂载自建卷**」：给一个 `mke2fs` 出来的镜像能 `ls -l`、
  `cat`、`stat`，写操作只在自己创建的卷上开放，并且不做 journal 恢复。

### 许可证是硬约束

这条必须先想清楚，否则做完了不能发：

| 组件 | 许可证 | 能不能进仓库 |
| --- | --- | --- |
| WASI（`wasi_snapshot_preview1` 规范） | Apache-2.0 / MIT | ✅ 自己实现，随便写 |
| wasi-libc | Apache-2.0 WITH LLVM-exception + MIT | ✅ 可链接 |
| musl | MIT | ✅ |
| 自研 MiniShell / coreutils | 本项目 MIT | ✅ |
| **GNU coreutils** | GPL-3.0 | ❌ 不静态链接、不分发二进制 |
| **busybox** | GPL-2.0 | ❌ 同上 |
| 任何 GPL 程序的 wasm | 继承 GPL | ⚠️ 只能**运行时由用户自备**，仓库里连 URL 都不该写死 |

结论：**HSL 的默认用户态必须是自研 + MIT/Apache 的**，GPL 世界的东西走「用户自己拖进来」。
这跟现在 `licenses/` 里那份清单的口径一致。

### 里程碑

- **M0 · 挂载**：fext4 只读挂载一个自制镜像，`ls -lai /`、`stat`、`cat` 全部走 inode，不走扁平 map。
- **M1 · execve**：`exec('/bin/echo.wasm', ['echo','hi'])`，WASI 的 `fd_write` 打到 xterm。
- **M2 · 管子**：`cat a.txt | wc -l`，两个 wasm 模块通过 fd 表接起来，不再靠 JS 管道字符串拼接。
- **M3 · 进程表**：`ps` 有真 pid，`/proc/<pid>/cmdline` 可读，`&` 能后台，`kill` 能停。
- **M4 · 工具链**：给出「怎么把一个 C 程序编成能在 HSL 里跑的 wasm」的三行说明。

### 第一步（等真开工时）

不写文件系统，不写加载器，先写 **`execve` 的壳**：一个 `exec()` 接受路径 + argv，
内部按扩展名分支（`.wasm` / `.js` / 无扩展名查 shebang），先把 `.js` 分支接到现有 `exec()` 上。
这一步没有新概念，但把「命令 = 可执行文件」的接口先钉死，后面 fext4 和 WASI 才有地方插。

### 提醒我

> 下次开新版本时，如果用户没提 HSL，**主动问一句**：「HSL 那条还做吗？先迈 M0 还是 M1？」
> 这条别丢。
