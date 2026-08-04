#!/usr/bin/env bash
#
# 把 dist-r2/transcript 下的精简转写传到 Cloudflare R2（公共桶 jlpt）。
#
#   npm run export:r2 && npm run upload:r2      # 先导出再传
#   npm run upload:r2 -- --dry-run              # 只看要传什么
#   npm run upload:r2 -- --jobs 10              # 加大并发
#
# 对象名与 QbankQuestion.audioKey 一一对应，只是换了前缀和扩展名：
#   qbank/audio/2020.12/1-1.mp3   ← 音频（uploadQbankMedia.sh 传的）
#   qbank/transcript/2020.12/1-1.json  ← 本脚本传的
# 前端拿 audioUrl 换个前缀就得到转写地址，后端不用动。
#
# 断点续传：每个成功的对象名写进 .transcript-upload.log，重跑自动跳过。
set -euo pipefail

cd "$(dirname "$0")/.."

DIST="dist-r2/transcript"
BUCKET="${R2_BUCKET:-jlpt}"
PREFIX="qbank/transcript"
JOBS=6
DRY_RUN=0
LOG=".transcript-upload.log"

# 与 uploadQbankMedia.sh 同样的查找顺序：workspace 会把 wrangler 提到仓库根。
WRANGLER="${WRANGLER:-}"
if [[ -z "$WRANGLER" ]]; then
  for candidate in ../node_modules/.bin/wrangler ../server/node_modules/.bin/wrangler; do
    [[ -x "$candidate" ]] && WRANGLER="$candidate" && break
  done
  [[ -n "$WRANGLER" ]] || WRANGLER="npx wrangler"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --jobs) JOBS="$2"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$DIST" ]]; then
  echo "找不到 $DIST，先跑：npm run export:r2" >&2
  exit 1
fi

touch "$LOG"

total=$(find "$DIST" -name '*.json' | wc -l | tr -d ' ')
echo "本地 $total 条，已传 $(wc -l < "$LOG" | tr -d ' ') 条"

# 传一个对象。已在 log 里的直接跳过。
upload_one() {
  local file="$1"
  local rel="${file#"$DIST"/}"           # 2020.12/1-1.json
  local key="$PREFIX/$rel"

  if grep -qxF "$key" "$LOG"; then return 0; fi
  if [[ "$DRY_RUN" == "1" ]]; then echo "  [dry] $key"; return 0; fi

  if $WRANGLER r2 object put "$BUCKET/$key" \
      --file "$file" \
      --content-type application/json \
      --remote >/dev/null 2>&1; then
    # 追加是原子的（单行 < PIPE_BUF），并发下不会写串行。
    echo "$key" >> "$LOG"
    echo "  ✓ $key"
  else
    echo "  ✗ $key" >&2
    return 1
  fi
}
export -f upload_one
export DIST PREFIX BUCKET LOG WRANGLER DRY_RUN

find "$DIST" -name '*.json' -print0 \
  | xargs -0 -P "$JOBS" -I{} bash -c 'upload_one "$@"' _ {}

echo
echo "完成，已传 $(wc -l < "$LOG" | tr -d ' ') / $total"
echo "抽查：curl -s https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/$PREFIX/2025.07/1-1.json | head -c 200"
