import { AppError } from '../errors/AppError'

export type DictionaryLookupResult = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  language: 'en' | 'jp'
}

function clean(input: string) {
  return input.replace(/\s+/g, ' ').trim()
}

async function lookupEnglish(term: string): Promise<DictionaryLookupResult[]> {
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`,
  )
  if (!response.ok) {
    if (response.status === 404) return []
    throw new AppError('dictionary lookup failed', 502)
  }

  const data = (await response.json()) as Array<{
    word?: string
    phonetics?: Array<{ text?: string }>
    meanings?: Array<{
      partOfSpeech?: string
      definitions?: Array<{ definition?: string; example?: string }>
    }>
  }>

  return data.slice(0, 5).map((entry) => {
    const firstMeaning = entry.meanings?.[0]
    const firstDefinition = firstMeaning?.definitions?.[0]
    const reading = clean(entry.phonetics?.find((item) => item.text)?.text ?? '')
    const meaning = clean(firstDefinition?.definition ?? '')
    const example = clean(firstDefinition?.example ?? '')
    const note = clean(firstMeaning?.partOfSpeech ?? '')
    return {
      word: clean(entry.word ?? term),
      reading,
      meaning,
      example,
      note,
      language: 'en',
    }
  })
}

async function lookupJapanese(term: string): Promise<DictionaryLookupResult[]> {
  const response = await fetch(
    `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(term)}`,
  )
  if (!response.ok) {
    throw new AppError('dictionary lookup failed', 502)
  }

  const payload = (await response.json()) as {
    data?: Array<{
      japanese?: Array<{ word?: string; reading?: string }>
      senses?: Array<{
        english_definitions?: string[]
        parts_of_speech?: string[]
      }>
    }>
  }

  const rows = payload.data ?? []
  return rows.slice(0, 8).map((row) => {
    const jp = row.japanese?.[0]
    const sense = row.senses?.[0]
    return {
      word: clean(jp?.word ?? jp?.reading ?? term),
      reading: clean(jp?.reading ?? ''),
      meaning: clean((sense?.english_definitions ?? []).join('; ')),
      example: '',
      note: clean((sense?.parts_of_speech ?? []).join(', ')),
      language: 'jp',
    }
  })
}

export async function lookupDictionary(
  term: string,
  language: 'en' | 'jp',
): Promise<DictionaryLookupResult[]> {
  const normalized = term.trim()
  if (!normalized) {
    throw new AppError('term is required', 400)
  }
  if (language !== 'en' && language !== 'jp') {
    throw new AppError('language must be en or jp', 400)
  }

  if (language === 'jp') {
    return lookupJapanese(normalized)
  }
  return lookupEnglish(normalized)
}
