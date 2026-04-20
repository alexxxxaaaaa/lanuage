import axios from 'axios'

export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? error.message ?? fallbackMessage
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallbackMessage
}

export function isDuplicateWordError(error: unknown) {
  if (!axios.isAxiosError<{ message?: string }>(error)) {
    return false
  }

  const status = error.response?.status
  const message = error.response?.data?.message ?? ''
  return status === 409 && message.includes('word already exists')
}
