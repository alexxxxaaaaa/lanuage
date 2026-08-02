#!/usr/bin/env bash
#
# 把 n1-qbank 的听力音频和情報検索图片传到 Cloudflare R2（公共桶 jlpt）。
#
#   npm run upload:qbank-media                 # 全量（约 1043 个文件 / 1.6 GB）
#   npm run upload:qbank-media -- --only audio # 只传音频
#   npm run upload:qbank-media -- --jobs 10    # 加大并发
#
# 对象名和库里的 QbankQuestion.audioKey / 文章正文里的图片路径一一对应，
# 只多一层 qbank/ 前缀（桶根目录已经被真题整卷 mp3 占着，别混在一起）：
#   audio/2020.12/1-1.mp3   → jlpt/qbank/audio/2020.12/1-1.mp3
#   images/2013.07/xx.png   → jlpt/qbank/images/2013.07/xx.png
# 音频文件名里的「聴解」在这里被去掉，R2 对象名保持纯 ASCII，省掉 URL 编码的麻烦。
#
# 传哪些音频以 index.json 为准（题库里被题目引用的那些），不是 audio/ 目录里的
# 全部文件 —— 目录里还躺着整卷 full.mp3、纳豆按材料另存一份的 材料N.mp3 等，
# 没有任何题引用它们，传上去纯占空间。
#
# 断点续传：每个成功的对象名写进 server/.qbank-upload.log，重跑自动跳过。
# 想强制重传就删掉那个 log（或删掉其中对应的行）。
set -euo pipefail

cd "$(dirname "$0")/.."

QBANK_DIR="${QBANK_DIR:-../n1-qbank}"
BUCKET="${R2_BUCKET:-jlpt}"
PREFIX="qbank"
JOBS=6
ONLY="all"
DRY_RUN=0
LOG=".qbank-upload.log"
# workspace 会把 wrangler 提到仓库根的 node_modules，两处都找一下；
# 都没有才退回 npx（每个文件多 1–2 秒，1000 多个文件差别很大）。
WRANGLER="${WRANGLER:-}"
if [[ -z "$WRANGLER" ]]; then
  for candidate in ./node_modules/.bin/wrangler ../node_modules/.bin/wrangler; do
    [[ -x "$candidate" ]] && WRANGLER="$candidate" && break
  done
  [[ -n "$WRANGLER" ]] || WRANGLER="npx wrangler"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

touch "$LOG"

# 单个文件的上传，被 xargs 并发调用。
# 注意变量一律写成 ${VAR}：macOS 自带的 bash 3.2 会把紧跟在 $VAR 后面的全角字符
# 当成变量名的一部分（"${key}（" 不加花括号就会报 unbound variable）。
upload_one() {
  local src="$1" key="$2" ctype="$3"
  if grep -qxF "${key}" "${LOG}"; then return 0; fi
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "  · ${key}  ←  ${src}  [${ctype}]"
    return 0
  fi
  if ${WRANGLER} r2 object put "${BUCKET}/${key}" --file="${src}" --content-type="${ctype}" --remote >/dev/null 2>&1; then
    # 追加写，O_APPEND 下单行不会被并发撕裂
    echo "${key}" >> "${LOG}"
    echo "  ✓ ${key}"
  else
    echo "  ✗ ${key}（失败，重跑本脚本会重试）" >&2
  fi
}
export -f upload_one
export LOG BUCKET WRANGLER DRY_RUN

# 列出待传文件，字段以 NUL 分隔（三个一组：源路径、对象名、content-type）
list_files() {
  if [[ "$ONLY" == "all" || "$ONLY" == "audio" ]]; then
    # 题库真正引用到的音频，从 index.json 取（每题一行 audio 字段）
    python3 -c "
import json, sys
qs = json.load(open('$QBANK_DIR/index.json'))['questions']
for rel in sorted({q['audio'] for q in qs if q.get('audio')}):
    sys.stdout.write(rel + '\n')
" | while read -r rel; do
      f="$QBANK_DIR/$rel"                            # audio/2020.12/聴解1-1.mp3
      [[ -f "$f" ]] || { echo "  ! 缺文件 $rel" >&2; continue; }
      key="$PREFIX/$(echo "$rel" | sed -E 's/聴解([0-9]+)-([0-9]+)\.mp3$/\1-\2.mp3/')"
      printf '%s\0%s\0%s\0' "$f" "$key" "audio/mpeg"
    done
  fi
  if [[ "$ONLY" == "all" || "$ONLY" == "images" ]]; then
    find "$QBANK_DIR/images" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) 2>/dev/null | while read -r f; do
      rel="${f#"$QBANK_DIR"/}"
      case "$f" in
        *.png) ct="image/png" ;;
        *)     ct="image/jpeg" ;;
      esac
      printf '%s\0%s\0%s\0' "$f" "$PREFIX/$rel" "$ct"
    done
  fi
}

TOTAL=$(( $(list_files | tr -dc '\0' | wc -c) / 3 ))
DONE=$(wc -l < "$LOG" | tr -d ' ')
echo "待处理 ${TOTAL} 个文件（已完成 ${DONE}），并发 ${JOBS}，桶 ${BUCKET}/${PREFIX}/"
[[ "${DRY_RUN}" == "1" ]] && echo "（--dry-run：只列清单，不真传）"

list_files | xargs -0 -P "${JOBS}" -n 3 bash -c 'upload_one "$0" "$1" "$2"'

echo
echo "完成 $(wc -l < "${LOG}" | tr -d ' ') / ${TOTAL}。失败的重跑本脚本即可续传。"
echo "抽查："
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -r 0-1 \\"
echo "    https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/qbank/audio/2020.12/1-1.mp3"
