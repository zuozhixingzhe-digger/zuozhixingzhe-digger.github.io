#!/usr/bin/env bash
# hterminal build script — 把 build/ 下的片段拼成自包含的 index.html
# SPDX-License-Identifier: Apache-2.0 OR MIT
# 由 AI 智能体生成并维护。
set -euo pipefail
cd "$(dirname "$0")"

# 构建前先确认所有 CDN 依赖都在 licenses/README.md 登记过
# 静默通过，失败才把整张表打出来——不让「漏登记」的产物被构建出来
if ! ./check-licenses.sh > /tmp/ht-licenses.log 2>&1; then
  cat /tmp/ht-licenses.log
  echo "构建中止：有第三方依赖未登记许可证。" >&2
  exit 1
fi

python3 - <<'PY'
parts = []
for f in ['build/00-head.html', 'build/10-body.html']:
    parts.append(open(f).read().rstrip('\n'))
worker = open('build/20-worker.js').read() + '\n\n' + open('build/21-shared.js').read() + '\n\n' + open('build/25-compat.js').read()
parts.append('\n<script id="worker-src" type="text/js-worker">\n' + worker + '\n</script>\n')
main = []
for f in ['build/21-shared.js', 'build/30-core.js', 'build/40-term.js', 'build/50-apps.js', 'build/55-tools.js', 'build/56-data.js', 'build/57-color.js', 'build/58-image.js', 'build/59-media.js', 'build/60-agent.js', 'build/61-html.js', 'build/65-tui.js', 'build/66b-hanzi-data.js', 'build/66-hsb2.js', 'build/67-hanzi.js', 'build/68-guard.js', 'build/70-boot.js']:
    main.append(open(f).read().rstrip('\n'))
parts.append('\n<script>\n' + '\n\n'.join(main) + '\n</script>\n</body>\n</html>\n')
open('index.html', 'w').write('\n'.join(parts))
PY

node --check build/20-worker.js
node --check build/25-compat.js
cat build/21-shared.js build/30-core.js build/40-term.js build/50-apps.js build/55-tools.js build/56-data.js build/57-color.js build/58-image.js build/59-media.js build/60-agent.js build/61-html.js build/65-tui.js build/66b-hanzi-data.js build/66-hsb2.js build/67-hanzi.js build/68-guard.js build/70-boot.js > /tmp/hterm-main.js
node --check /tmp/hterm-main.js
printf 'index.html: %s bytes\n' "$(wc -c < index.html)"
