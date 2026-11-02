#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0 OR MIT
#
# 扫一遍前端代码里所有 CDN 依赖，对照 licenses/README.md 的清单，缺登记就报错。
#
# 为什么要有这个脚本：加依赖时顺手写一行 `loadScript('https://cdn.jsdelivr.net/npm/xxx@1.2.3/...')`
# 太容易了，而「许可证漏登记」是发布之后才发现的麻烦事。把它变成 `./check-licenses.sh` 一条命令。
#
# 用法：./check-licenses.sh        # 有缺就 exit 1
set -euo pipefail
cd "$(dirname "$0")"

MANIFEST="licenses/README.md"
[ -f "$MANIFEST" ] || { echo "找不到 $MANIFEST" >&2; exit 2; }

# 1) 从 build/*.js 和 index.html 里抠出所有 CDN 依赖
#    覆盖三种写法：/npm/@scope/name@1.2.3/、unpkg.com/name@1.2.3/、pyodide@0.26.4
#    以及「版本号是变量」的写法：unpkg.com/pyodide@' + PYODIDE_VERSION
deps=$(
  {
    grep -hoE '(npm/|unpkg\.com/)(@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+@[0-9][A-Za-z0-9.+-]*' \
      build/*.js index.html 2>/dev/null
    # 动态版本：只抠包名，版本记作 "?"
    grep -hoE "(npm/|unpkg\.com/)(@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+@['\" ]" \
      build/*.js index.html 2>/dev/null | sed -E "s/@['\" ]$//"
  } | sed -E 's#^(npm/|unpkg\.com/)##' | sort -u
)

[ -n "$deps" ] || { echo "没扫到任何 CDN 依赖，正则是不是坏了？" >&2; exit 2; }

fail=0
printf '%-34s %-10s %s\n' "组件" "版本" "状态"
printf '%-34s %-10s %s\n' "----------------------------------" "----------" "------"
while IFS= read -r d; do
  name=${d%@*}
  ver=${d##*@}
  [ "$ver" = "$d" ] && ver="?"   # 没有 @ 说明是动态版本
  if [ "$ver" = "?" ]; then
    # 动态版本没法比版本号，至少要求包名登记过
    if grep -qiF "${name#@xterm/}" "$MANIFEST" || grep -qiF "$name" "$MANIFEST"; then
      printf '%-34s %-10s %s\n' "$name" "(动态)" "已登记"
    else
      printf '%-34s %-10s %s\n' "$name" "(动态)" "缺失 ✗"
      fail=1
    fi
  elif grep -qF "$ver" "$MANIFEST"; then
    printf '%-34s %-10s %s\n' "$name" "$ver" "已登记"
  else
    printf '%-34s %-10s %s\n' "$name" "$ver" "缺失 ✗"
    fail=1
  fi
done <<< "$deps"

# 2) 清单里引用的许可证文件必须真的存在
echo
while IFS= read -r f; do
  if [ -f "licenses/$f" ]; then
    printf '%-34s %s\n' "licenses/$f" "存在"
  else
    printf '%-34s %s\n' "licenses/$f" "缺失 ✗"
    fail=1
  fi
done < <(grep -oE '`LICENSE\.[A-Za-z0-9._-]+\.txt`' "$MANIFEST" | tr -d '`' | sort -u)

echo
if [ "$fail" -ne 0 ]; then
  echo "有依赖没登记，或清单指向了不存在的许可证文件。" >&2
  echo "补齐：1) 下载许可证原文到 licenses/LICENSE.<name>.txt  2) 在 $MANIFEST 的表里加一行" >&2
  exit 1
fi
echo "全部登记完毕。"
