import type { StrapiMediaFile } from './strapi-media'

/**
 * One media field of one row, and where in the entry its value belongs.
 *
 * A path rather than a field name, because a media field is not only a key on
 * the entry any more: `validation.issue`'s icons are two levels down, inside an
 * array inside an array. `["items", 3, "issues", 11, "mobile_icon"]` is the
 * whole of what the writer needs to know about that.
 */
export interface StrapiMediaSlot {
  /** Object keys and array indices, from the root of the entry. */
  path: (string | number)[]
  /** Whether the field holds an array of files or one. */
  multiple: boolean
  /** Strapi's own order. */
  files: StrapiMediaFile[]
}

/**
 * Moving a slot down a level, and filling it.
 *
 * Its own artifact because the two halves are read a long way apart —
 * `StrapiRows` builds the paths while reading the database, `MediaLibrary`
 * follows them after uploading bytes — and a path convention agreed in two
 * places is one that eventually disagrees.
 */
export class StrapiMediaSlots {
  /** `slots` as seen from the parent that holds them at `prefix`. */
  static nest(
    slots: readonly StrapiMediaSlot[],
    prefix: readonly (string | number)[],
  ): StrapiMediaSlot[] {
    return slots.map((slot) => ({ ...slot, path: [...prefix, ...slot.path] }))
  }

  /**
   * Write `value` at `path`.
   *
   * The containers are already there — the reader built the objects and arrays
   * on its way down — so this walks and never creates. A path that does not lead
   * anywhere is dropped rather than thrown: the alternative is failing a whole
   * entry over one icon.
   */
  static assign(entry: Record<string, unknown>, path: readonly (string | number)[], value: unknown): void {
    if (path.length === 0) return

    let at: any = entry
    for (const step of path.slice(0, -1)) {
      if (at === null || typeof at !== 'object') return
      at = at[step]
    }
    if (at === null || typeof at !== 'object') return
    at[path[path.length - 1]!] = value
  }
}
