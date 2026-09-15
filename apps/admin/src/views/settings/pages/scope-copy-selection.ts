import type { CopyScopeSelection } from '../../../api/types/copy-scope-options'

/** Immutable selection rules for collection and individual-entry copy choices. */
export class ScopeCopySelection {
  static addCollection(current: CopyScopeSelection[], collection: string): CopyScopeSelection[] {
    return [...current.filter((item) => item.collection !== collection), { collection }]
  }

  static addEntry(current: CopyScopeSelection[], collection: string, id: string): CopyScopeSelection[] {
    const selected = current.find((item) => item.collection === collection)
    if (selected && selected.entryIds === undefined) return current
    const entryIds = selected?.entryIds || []
    return [...current.filter((item) => item.collection !== collection), { collection, entryIds: entryIds.includes(id) ? entryIds : [...entryIds, id] }]
  }

  static removeCollection(current: CopyScopeSelection[], collection: string): CopyScopeSelection[] {
    return current.filter((item) => item.collection !== collection)
  }

  static removeEntry(current: CopyScopeSelection[], collection: string, id: string): CopyScopeSelection[] {
    return current.flatMap((item) => {
      if (item.collection !== collection || item.entryIds === undefined) return [item]
      const entryIds = item.entryIds.filter((value) => value !== id)
      return entryIds.length ? [{ collection, entryIds }] : []
    })
  }
}
