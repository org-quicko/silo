/**
 * The flat folder list the server answers with, shaped into the tree the move
 * picker browses (D66).
 *
 * Kept apart from the dialog that renders it on the same reasoning
 * `MediaPath` already exists for: a tree is a value, and the questions asked
 * of it are answerable without a DOM.
 */
export interface FolderNode {
  /** `''` for the library root, `/a/b` otherwise — the shape `folder` takes
   *  everywhere else in the library. */
  path: string
  /** The last segment, or `RootName` at the root. */
  name: string
  children: FolderNode[]
}

export class MediaFolderTree {
  /** What the root is called on screen — the same words the breadcrumb uses,
   *  since they name the same place. */
  static readonly RootName = 'All files'

  /** The whole library as one root-anchored tree, each level sorted by name.
   *  An ancestor the list never named is created anyway, so a gap in it
   *  cannot orphan the folders sitting under it. */
  static build(folders: string[]): FolderNode {
    const root: FolderNode = { path: '', name: MediaFolderTree.RootName, children: [] }
    const byPath = new Map<string, FolderNode>([['', root]])

    for (const folder of [...folders].sort()) {
      let parent = root
      let accumulated = ''
      for (const segment of folder.split('/').filter(Boolean)) {
        accumulated += '/' + segment
        let node = byPath.get(accumulated)
        if (!node) {
          node = { path: accumulated, name: segment, children: [] }
          byPath.set(accumulated, node)
          parent.children.push(node)
        }
        parent = node
      }
    }

    return root
  }

  /** `folder` and every ancestor of it, root first — what the picker expands
   *  when it opens, so where the items are now is already in view. */
  static ancestors(folder: string): string[] {
    const out = ['']
    let accumulated = ''
    for (const segment of folder.split('/').filter(Boolean)) {
      accumulated += '/' + segment
      out.push(accumulated)
    }
    return out
  }
}
