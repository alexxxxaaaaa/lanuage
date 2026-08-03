import { create } from 'zustand'
import { getWordIndex, type WordIndexItem } from '../api/words'

/**
 * 「我的单词库」的全量词头，供查词页右侧索引栏和本地词库合并展示。
 *
 * 一个会话拉一次就够 —— 词头只在增删单词时变，那几处写完显式 refresh()。
 * 放全局而不是放组件里：查词页是 keep-alive 的，用户在别处加了词，回来
 * 要看到它出现在索引里。
 */

type WordIndexState = {
  items: WordIndexItem[]
  /** 每次成功拉取自增。索引合并结果拿它当缓存键，加词后自然失效。 */
  revision: number
  hasLoaded: boolean
  /** 第一次用到时拉；已有数据直接返回。 */
  load: () => void
  /** 单词增删或改词头之后调，重新对一份。 */
  refresh: () => void
}

let inflight: Promise<void> | null = null

function fetchItems() {
  inflight ??= getWordIndex()
    .then((items) => {
      useWordIndex.setState((state) => ({
        items,
        revision: state.revision + 1,
        hasLoaded: true,
      }))
    })
    .catch(() => {
      // 拉不到就只展示本地词库那部分，不该让整个索引栏挂掉。
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export const useWordIndex = create<WordIndexState>(() => ({
  items: [],
  revision: 0,
  hasLoaded: false,
  load: () => {
    if (useWordIndex.getState().hasLoaded) return
    void fetchItems()
  },
  refresh: () => {
    void fetchItems()
  },
}))
