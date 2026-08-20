import { Tag } from 'antd'

/**
 * 一条表达可以挂多个场景标签，客户端把它们逗号分隔存在 `sceneTag` 一个字段里
 * （见 client/src/lib/sceneTags.ts）。老数据是单个自由文本，没有逗号，拆出来
 * 就是一项。
 */
export function renderSceneTags(raw: string) {
  const tags = (raw ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  if (!tags.length) return '-'
  return tags.map((tag) => (
    <Tag color="purple" key={tag}>
      {tag}
    </Tag>
  ))
}
