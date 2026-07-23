import { apiClient } from './client'

export type GrammarQuestion = {
  id: string
  grammarId: string
  grammarPattern: string
  grammarMeaning: string
  prompt: string
  options: string[]
  answerIndex: number
  attempt: {
    selectedIndex: number
    isCorrect: boolean
  } | null
}

export async function listGrammarQuestions(mode: 'all' | 'wrong') {
  const r = await apiClient.get<GrammarQuestion[]>('/api/grammar-questions', {
    params: { mode },
  })
  return r.data
}

export async function listGrammarQuestionsFor(grammarId: string) {
  const r = await apiClient.get<GrammarQuestion[]>(
    `/api/grammar-questions/by-grammar/${grammarId}`,
  )
  return r.data
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
