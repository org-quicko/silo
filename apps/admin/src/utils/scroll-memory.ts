/**
 * Where the reader had scrolled to, per view, for this session only.
 *
 * In memory rather than in storage, deliberately. This exists so that opening a
 * row and coming back does not throw away the place in the list you were
 * reading — a navigation within one session. A reload is a fresh look at the
 * page, and dropping somebody back into the middle of a list whose contents may
 * have moved since is worse than starting at the top.
 *
 * Keyed by the view's URL, so page, sort, filter and search each remember their
 * own position and none inherits another's.
 */
export class ScrollMemory {
  /** Enough for the handful of views a reader moves between; the oldest goes
   *  first, so a long session cannot grow this without bound. */
  private static readonly Limit = 24

  private static readonly positions = new Map<string, number>()

  static get(key: string): number {
    return ScrollMemory.positions.get(key) ?? 0
  }

  static set(key: string, top: number): void {
    // Re-inserted rather than updated in place: `Map` keeps insertion order, so
    // deleting first is what makes the eviction below least-recently-written.
    ScrollMemory.positions.delete(key)
    ScrollMemory.positions.set(key, top)

    if (ScrollMemory.positions.size <= ScrollMemory.Limit) return
    const oldest = ScrollMemory.positions.keys().next()
    if (!oldest.done) ScrollMemory.positions.delete(oldest.value)
  }

  static forget(key: string): void {
    ScrollMemory.positions.delete(key)
  }

  static clear(): void {
    ScrollMemory.positions.clear()
  }
}
