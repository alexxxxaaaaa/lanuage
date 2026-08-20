import { apiClient } from './client'

export type GrammarQuestion = {
  id: string
  grammarId: string
  grammarPattern: string
  grammarMeaning: string
  prompt: string
  options: string[]
  answerIndex: number
  /** 这题考的知识点，答完才显示。空串 = 还没标注，此时不显示这一行。 */
  testedPoint: string
  /** 用户手写的备注。空串 = 没写过。 */
  note: string
  attempt: {
    selectedIndex: number
    isCorrect: boolean
  } | null
}

export type GrammarQuestionPage = {
  items: GrammarQuestion[]
  /** 当前 mode 下的总题数（不是本页条数）。 */
  total: number
}

/** 'done' 答过的（对错都算）、'undone' 一次没答过的、'wrong' 上次答错的。 */
export type QuestionMode = 'all' | 'done' | 'undone' | 'wrong'

export async function listGrammarQuestions(
  mode: QuestionMode,
  page: number,
  pageSize: number,
  q = '',
) {
  const r = await apiClient.get<GrammarQuestionPage>('/api/grammar-questions', {
    params: { mode, page, pageSize, ...(q ? { q } : {}) },
  })
  return r.data
}

export async function listGrammarQuestionsFor(grammarId: string) {
  const r = await apiClient.get<GrammarQuestion[]>(
    `/api/grammar-questions/by-grammar/${grammarId}`,
  )
  return r.data
}

/** 存备注。传空串就是删掉备注。 */
export async function updateGrammarQuestionNote(
  questionId: string,
  note: string,
) {
  const r = await apiClient.patch<{ note: string }>(
    `/api/grammar-questions/${questionId}/note`,
    { note },
  )
  return r.data.note
}

export async function submitGrammarQuestionAttempt(
  questionId: string,
  selectedIndex: number,
) {
  const r = await apiClient.post<{ isCorrect: boolean; answerIndex: number }>(
    `/api/grammar-questions/${questionId}/attempt`,
    { selectedIndex },
  )
  return r.data
}
