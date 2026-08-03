import type { Folder } from '@prisma/client'

/**
 * 词单归属存在 WordFolder 连接表上，但那是存储细节 —— 接口上一个词还是
 * 「属于哪几个词单」。取词时统一带上归属，返回前统一摊平，三个 service
 * 共用这一份，形状才不会各出各的。
 */

export const WORD_FOLDERS = { folders: { include: { folder: true } } } as const

type WithFolderLinks = {
  folders: { folderId: string; folder: Folder }[]
}

export function flattenWord<T extends WithFolderLinks>(word: T) {
  const { folders, ...rest } = word
  return {
    ...rest,
    folders: folders.map((link) => link.folder),
    folderIds: folders.map((link) => link.folderId),
  }
}
