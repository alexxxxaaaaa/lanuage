import type { Request, Response } from 'express'
import {
  fillWordByAiAuto,
  fillWordByAi,
  generateExpressionCasualByAi,
  generateWordQuizByAi,
  getAiUsageSummary,
  translateExpressionToZhByAi,
} from '../services/aiService'

export async function fillWordByAiController(request: Request, response: Response) {
  const { word, language, extended } = request.body as {
    word?: string
    language?: 'en' | 'jp'
    extended?: boolean
  }
  const result =
    language === 'en' || language === 'jp'
      ? await fillWordByAi({ word: word ?? '', language, extended: !!extended })
      : await fillWordByAiAuto(word ?? '', !!extended)
  return response.json(result)
}

export async function getAiUsageController(request: Request, response: Response) {
  const daysRaw = typeof request.query.days === 'string' ? Number(request.query.days) : 7
  const result = await getAiUsageSummary(daysRaw)
  return response.json(result)
}

export async function generateWordQuizController(request: Request, response: Response) {
  const { word, reading, meaning, example, language } = request.body as {
    word?: string
    reading?: string
    meaning?: string
    example?: string
    language?: 'en' | 'jp'
  }
  const result = await generateWordQuizByAi({
    word: word ?? '',
    reading: reading ?? '',
    meaning: meaning ?? '',
    example: example ?? '',
    language: language === 'jp' ? 'jp' : 'en',
  })
  return response.json(result)
}

export async function generateExpressionCasualController(
  request: Request,
  response: Response,
) {
  const { zhText, language } = request.body as { zhText?: string; language?: 'en' | 'jp' }
  const result = await generateExpressionCasualByAi({
    zhText: zhText ?? '',
    language: language === 'jp' ? 'jp' : language === 'en' ? 'en' : undefined,
  })
  return response.json(result)
}

export async function translateExpressionToZhController(
  request: Request,
  response: Response,
) {
  const { text, language } = request.body as { text?: string; language?: 'en' | 'jp' }
  const result = await translateExpressionToZhByAi({
    text: text ?? '',
    language: language === 'jp' ? 'jp' : 'en',
  })
  return response.json(result)
}
