#!/usr/bin/env bash
#
# 把蓝宝书的句型/例句朗读和活用表图片传到 Cloudflare R2（公共桶 jlpt）。
#
#   npm run upload:bluebook-media                  # 全量（1593 个 mp3 + 159 张图 / 29 MB）
#   npm run upload:bluebook-media -- --only image  # 只传图片
#   npm run upload:bluebook-media -- --dry-run     # 只列清单
#
# 对象名就是库里 Grammar.audioKey / examples[].audio / images[] 的值，前面加
# grammar/ 前缀，和题库的 qbank/ 分开：
#   google-xxx.mp3            → jlpt/grammar/audio/google-xxx.mp3
#   bluebook_img_000008.jpeg  → jlpt/grammar/image/bluebook_img_000008.jpeg
#
# 传哪些以 data/bluebook/grammar.json 里的引用为准，不是 media/ 目录里的全部
# 文件 —— 转换器按 (pattern, level) 合并条目时会丢掉一部分重复 note，它们的
# 音频还留在导出目录里，没有任何条目引用。
#
# 断点续传：每个成功的对象名写进 server/.bluebook-upload.log，重跑自动跳过。
set -euo pipefail

cd "$(dirname "$0")/.."

MEDIA_DIR="${MEDIA_DIR:-data/bluebook/media}"
JSON="${JSON:-data/bluebook/grammar.json}"
BUCKET="${R2_BUCKET:-jlpt}"
PREFIX="grammar"
JOBS=6
ONLY="all"
DRY_RUN=0
LOG=".bluebook-upload.log"
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

if [[ ! -f "$JSON" ]]; then
  echo "找不到 $JSON —— 先跑 python3 scripts/convertBluebookApkg.py" >&2
  exit 2
fi
if [[ ! -d "$MEDIA_DIR" ]]; then
  echo "找不到 $MEDIA_DIR —— 先跑 convertBluebookApkg.py --media-out $MEDIA_DIR" >&2
  exit 2
fi

touch "$LOG"

upload_one() {
  local src="$1" key="$2" ctype="$3"
  if grep -qxF "${key}" "${LOG}"; then return 0; fi
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "  · ${key}  ←  ${src}  [${ctype}]"
    return 0
  fi
  if ${WRANGLER} r2 object put "${BUCKET}/${key}" --file="${src}" --content-type="${ctype}" --remote >/dev/null 2>&1; then
    echo "${key}" >> "${LOG}"
    echo "  ✓ ${key}"
  else
    echo "  ✗ ${key}（失败，重跑本脚本会重试）" >&2
  fi
}
export -f upload_one
export LOG BUCKET WRANGLER DRY_RUN

# 三个一组输出：源路径、对象名、content-type，字段以 NUL 分隔。
list_files() {
  MEDIA_DIR="$MEDIA_DIR" PREFIX="$PREFIX" ONLY="$ONLY" python3 -c "
import json, os, sys

media = os.environ['MEDIA_DIR']
prefix = os.environ['PREFIX']
only = os.environ['ONLY']
rows = json.load(open('$JSON', encoding='utf-8'))

audio, image = set(), set()
for r in rows:
    if r['audioKey']:
        audio.add(r['audioKey'])
    for ex in r['examples']:
        if ex['audio']:
            audio.add(ex['audio'])
    image.update(r['images'])

wanted = []
if only in ('all', 'audio'):
    wanted += [(n, 'audio', 'audio/mpeg') for n in sorted(audio)]
if only in ('all', 'image'):
    wanted += [
        (n, 'image', 'image/jpeg' if n.lower().endswith(('.jpg', '.jpeg')) else 'image/png')
        for n in sorted(image)
    ]

for name, kind, ctype in wanted:
    src = os.path.join(media, kind, name)
    if not os.path.exists(src):
        print(f'  ! 缺文件 {kind}/{name}', file=sys.stderr)
        continue
    sys.stdout.write(f'{src}\0{prefix}/{kind}/{name}\0{ctype}\0')
"
}

TOTAL=$(( $(list_files | tr -dc '\0' | wc -c) / 3 ))
DONE=$(wc -l < "$LOG" | tr -d ' ')
echo "待处理 ${TOTAL} 个文件（已完成 ${DONE}），并发 ${JOBS}，桶 ${BUCKET}/${PREFIX}/"
[[ "${DRY_RUN}" == "1" ]] && echo "（--dry-run：只列清单，不真传）"

list_files | xargs -0 -P "${JOBS}" -n 3 bash -c 'upload_one "$0" "$1" "$2"'

echo
echo "完成 $(wc -l < "${LOG}" | tr -d ' ') / ${TOTAL}。失败的重跑本脚本即可续传。"
