import type { MediaUploadPlan } from './media-upload-plan'

/**
 * Turns what a reader picked or dropped into a {@link MediaUploadPlan}.
 *
 * A folder arrives two ways. The picker (`webkitdirectory`) hands over every
 * file with its path in `webkitRelativePath`, and never an empty directory. A
 * drop hands over `FileSystemEntry` handles that have to be walked, which is
 * the only route by which an empty directory is seen at all.
 */
export class MediaUploadPlanner {
  /** Files from a picker: a folder pick keeps each file's directory, a plain
   *  pick has none. */
  static fromFiles(files: Iterable<File>): MediaUploadPlan {
    const plan: MediaUploadPlan = { uploads: [], emptyFolders: [] }
    for (const file of files) {
      // Non-standard, so a runtime without it is a file with no directory.
      plan.uploads.push({ file, folder: MediaUploadPlanner.directoryOf(file.webkitRelativePath || '') })
    }
    return plan
  }

  /**
   * Everything in a drop, folders walked to their leaves.
   *
   * Call it from the drop handler itself, before any `await`: the browser
   * empties a `DataTransfer` once the handler returns, so the handles are
   * taken here, synchronously, and only walked afterwards.
   */
  static async fromDrop(transfer: DataTransfer): Promise<MediaUploadPlan> {
    const entries: FileSystemEntry[] = []
    const loose: File[] = []
    for (const item of Array.from(transfer.items ?? [])) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry) entries.push(entry)
      else {
        const file = item.getAsFile()
        if (file) loose.push(file)
      }
    }
    // A browser with no entry API still lists the dropped files.
    if (entries.length === 0 && loose.length === 0) loose.push(...Array.from(transfer.files ?? []))

    const plan = MediaUploadPlanner.fromFiles(loose)
    for (const entry of entries) await MediaUploadPlanner.walk(entry, '', plan)
    return plan
  }

  private static async walk(entry: FileSystemEntry, parent: string, plan: MediaUploadPlan): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      plan.uploads.push({ file, folder: parent })
      return
    }

    const path = parent ? `${parent}/${entry.name}` : entry.name
    const children = await MediaUploadPlanner.children(entry as FileSystemDirectoryEntry)
    if (children.length === 0) plan.emptyFolders.push(path)
    for (const child of children) await MediaUploadPlanner.walk(child, path, plan)
  }

  /** Every entry of a directory. `readEntries` answers in batches (100 at a
   *  time in Chromium) and signals the end with an empty one. */
  private static async children(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = directory.createReader()
    const all: FileSystemEntry[] = []
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) return all
      all.push(...batch)
    }
  }

  /** `"a/b/c.png"` is in `"a/b"`; a bare name, or `""`, is in no directory. */
  private static directoryOf(relativePath: string): string {
    const parts = relativePath.split('/').filter(Boolean)
    parts.pop()
    return parts.join('/')
  }
}
