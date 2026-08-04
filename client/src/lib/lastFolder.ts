// 「上次把词加进了哪个词单」。加词页和播客划词加词共用 —— 在哪记词这件事
// 是用户的一个习惯，不该因为入口不同而记两份。

const LAST_FOLDER_KEY = 'add-word:last-folder-id'

export function loadLastFolder(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(LAST_FOLDER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveLastFolder(id: string) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(LAST_FOLDER_KEY, id)
  } catch {
    /* quota / privacy mode — ignore */
  }
}
