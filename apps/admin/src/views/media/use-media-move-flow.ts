import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { MediaPath } from './media-path'

export interface MoveSubject {
  assets: MediaAsset[]
  folderPaths: string[]
}

/**
 * Validates whether the given items can be moved to `targetFolder`.
 * Prevents invalid moves such as moving a folder into itself or its descendants,
 * or moving items into the directory they are already located in.
 */
export function validateMove(subject: MoveSubject, targetFolder: string): { valid: boolean; reason?: string } {
  const { assets, folderPaths } = subject
  if (assets.length === 0 && folderPaths.length === 0) {
    return { valid: false, reason: 'Nothing selected to move' }
  }

  // Check for folder cycle / moving into itself or descendant
  for (const folder of folderPaths) {
    if (folder === targetFolder) {
      return { valid: false, reason: `Cannot move "${MediaPath.name(folder)}" into itself` }
    }
    if (targetFolder.startsWith(folder + '/')) {
      return { valid: false, reason: `Cannot move "${MediaPath.name(folder)}" into one of its subfolders` }
    }
  }

  // Check if every item is already in the target folder
  const allAlreadyThere =
    assets.every((a) => a.folder === targetFolder) &&
    folderPaths.every((f) => MediaPath.parent(f) === targetFolder)

  if (allAlreadyThere) {
    return { valid: false, reason: 'Items are already in this folder' }
  }

  return { valid: true }
}

/**
 * Drives the drag-and-drop move confirmation flow.
 */
export function useMediaMoveFlow(
  moveItems: (assets: MediaAsset[], folderPaths: string[], targetFolder: string) => Promise<boolean>,
  onMoved?: (subject: MoveSubject, targetFolder: string) => void,
) {
  const [subject, setSubject] = useState<MoveSubject | null>(null)
  const [targetFolder, setTargetFolder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const start = (items: MoveSubject, target: string): boolean => {
    const { valid } = validateMove(items, target)
    if (!valid) return false

    setSubject(items)
    setTargetFolder(target)
    return true
  }

  const cancel = () => {
    setSubject(null)
    setTargetFolder(null)
  }

  const confirm = async () => {
    if (!subject || targetFolder === null) return
    setBusy(true)
    try {
      const ok = await moveItems(subject.assets, subject.folderPaths, targetFolder)
      if (ok) {
        onMoved?.(subject, targetFolder)
        cancel()
      }
    } finally {
      setBusy(false)
    }
  }

  return {
    subject,
    targetFolder,
    busy,
    start,
    cancel,
    confirm,
  }
}
