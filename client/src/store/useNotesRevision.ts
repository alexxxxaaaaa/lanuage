import { create } from 'zustand'

type NotesRevisionState = {
  revision: number
  /** 笔记写成功后调一次，让还挂在后台的列表页重新拉。 */
  bump: () => void
}

/**
 * 「笔记数据变过了」的信号。
 *
 * 详情页是自动保存的，而列表页在 keep-alive 下一直挂着：从详情页返回列表时，
 * 列表的刷新完全可能跑在那笔 PATCH 前头，于是列表上还是旧标题。让写入方在
 * 请求真正落地之后 bump 一下，列表把这个数当依赖，就不用去猜谁先谁后。
 */
export const useNotesRevision = create<NotesRevisionState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}))
