/**
 * Folder-path helpers for the media library's directory browser (D23).
 *
 * Mirrors the server's normalised shape — `""` for root, `/a/b` otherwise —
 * without repeating its validation: this side only ever reads paths the
 * server already produced.
 */
export class MediaPath {
  /** Every ancestor of `folder`, root-first — what the breadcrumb renders
   *  after the implicit "All files" root, which is not included here. */
  static segments(folder: string): { name: string; path: string }[] {
    if (!folder) return []
    const parts = folder.split('/').filter(Boolean)
    const out: { name: string; path: string }[] = []
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      out.push({ name: part, path: acc })
    }
    return out
  }

  /** The direct child folders of `parent` among `all` — one level down, not the whole subtree. */
  static children(all: string[], parent: string): string[] {
    const depth = MediaPath.depth(parent) + 1
    return all.filter((f) => f !== parent && MediaPath.isWithin(f, parent) && MediaPath.depth(f) === depth)
  }

  /** The last path segment — what a folder tile shows as its name. */
  static name(folder: string): string {
    const parts = folder.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? folder
  }

  /** `folder`'s parent — "" for a top-level folder, and for root itself.
   *  Where the browser lands after the folder it was in is deleted (D49). */
  static parent(folder: string): string {
    const parts = folder.split('/').filter(Boolean)
    parts.pop()
    return parts.length === 0 ? '' : '/' + parts.join('/')
  }

  private static depth(folder: string): number {
    return folder.split('/').filter(Boolean).length
  }

  private static isWithin(folder: string, parent: string): boolean {
    if (!parent) return true
    return folder === parent || folder.startsWith(parent + '/')
  }
}
