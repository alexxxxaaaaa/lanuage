/**
 * 场景标签词表 —— 建表达时多选，AI 按它调整译文的语域。
 *
 * `value` 就是存进 `Expression.sceneTag` 的那串中文。存文本而不是英文 key，是
 * 因为这一列同时还是搜索字段（`/api/expressions?q=` 直接 `contains` 查它）、
 * 后台表格的显示值，而且历史数据本来就是早期 AI 自由生成的中文标签 —— 换成
 * key 得给这三处各配一层映射，还得洗一遍老数据。`labelKey` 只管界面上按当前
 * 语言怎么显示，不影响存的东西。
 */
export const SCENE_TAGS = [
  { value: '口语', labelKey: 'spoken' },
  { value: '商务', labelKey: 'business' },
  { value: '正式', labelKey: 'formal' },
  { value: '书面报告', labelKey: 'report' },
  { value: '邮件', labelKey: 'email' },
  { value: '礼貌', labelKey: 'polite' },
  { value: '学术', labelKey: 'academic' },
  { value: '演讲', labelKey: 'presentation' },
  { value: '面试', labelKey: 'interview' },
  { value: '社交媒体', labelKey: 'social' },
] as const

/** 一条表达可以挂多个标签，逗号分隔存在一个字段里。 */
const SEPARATOR = ','

/** 老数据是单个自由文本，没有逗号，parse 出来就是只有一项的数组。 */
export function parseSceneTags(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(SEPARATOR)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function serializeSceneTags(tags: string[]): string {
  const unique = new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  return Array.from(unique).join(SEPARATOR)
}
