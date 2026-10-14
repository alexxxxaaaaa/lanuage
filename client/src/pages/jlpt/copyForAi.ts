import { paperLabel } from './constants'

/**
 * 两个入口的题目类型不一样（精练页是 QbankQuestion，考试页是 ExamQuestion，
 * 后者没有 year/month/passage/selected），所以这里按结构收最小集合，缺的
 * 字段各自可选。
 */
export type CopyableQuestion = {
  seq: string
  stemJp: string
  options: string[]
  answer?: number
  altAnswer?: number
  /** 卷次。考试页由调用方单独传。 */
  year?: number
  month?: number
  /** 阅读 / 情報検索的原文。考试页的原文挂在卷子上，由调用方传进来。 */
  passage?: { content: string } | null
  /** 用户选的选项（1-based）。 */
  selected?: number | null
}

/**
 * 把一道题拼成一段可以直接丢给外部 AI 的文本。
 *
 * 做这个是因为题库自带的解析常常不够细，实际用法是把题目复制出去问别的 AI。
 * 手动复制要一块块选（题干、四个选项、哪个是答案、自己选了什么），阅读题还
 * 得连上面那段原文一起 —— 一键拼好比选文字快得多，也不会漏掉上下文。
 *
 * 不带题目译文和题库原有的解析：既然是嫌它讲得不够才拿出去问，把它塞进
 * 提示词只会给对方设个框，照着复述一遍。译文同理 —— 让 AI 自己读原文。
 *
 * 末尾附一句现成的提问，粘过去就能直接发，不用再自己组织话术。
 */
export function buildAiQuestionText(q: CopyableQuestion): string {
  const parts: string[] = []

  // 卷次拿不到就只写题号 —— 考试页的 year/month 在卷子上，不在题上。
  const head =
    q.year && q.month ? `${paperLabel(q.year, q.month)} ${q.seq}` : q.seq
  parts.push(`【${head}】`)

  // 阅读 / 情報検索的原文。图片型的 passage 存的是 markdown 图片语法，复制
  // 出去只会变成一行没用的路径，所以跳过。
  const passage = q.passage?.content?.trim()
  if (passage && !passage.startsWith('![')) {
    parts.push('', '【原文】', passage)
  }

  parts.push('', '【题目】', q.stemJp.trim())

  parts.push('', ...q.options.map((opt, i) => `${i + 1}. ${opt}`))

  const answers = [q.answer, q.altAnswer].filter((n): n is number => !!n && n > 0)
  parts.push('', `正确答案：${answers.join(' 或 ')}`)
  if (q.selected) {
    parts.push(`我选的：${q.selected}${q.selected === q.answer ? '（对）' : '（错）'}`)
  }


  parts.push(
    '',
    '请详细讲解这道题：正确答案为什么对、其余选项分别错在哪里、涉及的语法点或词汇辨析，' +
      '以及下次遇到同类题该怎么判断。',
  )

  return parts.join('\n')
}

/**
 * 复制到剪贴板。navigator.clipboard 要求安全上下文（https / localhost），
 * 不满足或被拒时回落到旧的 execCommand —— 手机浏览器里这条路还挺常走。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走下面的回落
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // 放在视口外，但不能用 display:none —— 那样选不中，execCommand 会失败。
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
