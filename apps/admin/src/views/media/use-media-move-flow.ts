import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { MediaPath } from './media-path'
import type { WriteOutcome } from './use-media-library'

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
 * Drives the two ways a move is asked for (D66), which differ only in whether
 * the destination is known when the flow starts: a drop already names one and
 * needs it confirmed, the Move action does not and opens the picker.
 *
 * `targetFolder` is what separates them — a string is a drop awaiting
 * confirmation, `null` is the picker. One dialog shows at a time, the same
 * shape `useMediaDeleteFlow` and `useMediaRenameFolderFlow` already take for
 * their own pairs.
 */
export function useMediaMoveFlow(
  moveItems: (assets: MediaAsset[], folderPaths: string[], targetFolder: string) => Promise<WriteOutcome>,
  onMoved?: (subject: MoveSubject, targetFolder: string) => void,
) {
  const [subject, setSubject] = useState<MoveSubject | null>(null)
  const [targetFolder, setTargetFolder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = (items: MoveSubject, target: string): boolean => {
    const { valid } = validateMove(items, target)
    if (!valid) return false

    setSubject(items)
    setTargetFolder(target)
    setError('')
    return true
  }

  /** Opens the picker instead: the destination is what the reader is here to
   *  choose, so there is nothing to validate yet. */
  const startPicker = (items: MoveSubject) => {
    setSubject(items)
    setTargetFolder(null)
    setError('')
  }

  const cancel = () => {
    setSubject(null)
    setTargetFolder(null)
    setError('')
  }

  /** The one move. The picker's Move button is its own confirmation, so it
   *  lands here directly rather than through a second dialog. A refusal stays
   *  in the dialog, which stays open with the destination still chosen. */
  const moveTo = async (target: string) => {
    if (!subject || !validateMove(subject, target).valid) return
    setBusy(true)
    setError('')
    try {
      const failure = await moveItems(subject.assets, subject.folderPaths, target)
      setError(failure ?? '')
      if (!failure) {
        onMoved?.(subject, target)
        cancel()
      }
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (targetFolder === null) return
    await moveTo(targetFolder)
  }

  return {
    subject,
    targetFolder,
    busy,
    error,
    start,
    startPicker,
    cancel,
    confirm,
    moveTo,
  }
}
