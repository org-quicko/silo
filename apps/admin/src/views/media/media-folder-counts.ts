/**
 * Loads a count for each subfolder on screen, a few requests at a time.
 *
 * Every request costs the server a slot in its read queue for the key check,
 * then another for the list, and on SQLite that queue holds 64 (D81). Sent all
 * at once, the counts of a folder with fifty subfolders filled it and the
 * server refused the rest (resources/design/storage.md, D81).
 */
export class MediaFolderCounts {
  /** Count requests in flight at once. */
  static readonly MaxInFlight = 6

  /**
   * `count(path)` for every path, keyed by path, with at most `maxInFlight`
   * out at a time. `count` must not reject: it answers a failure with a count
   * of its own. Once `signal` aborts no new request starts, and the answer
   * holds only the counts already in.
   */
  static async load(
    paths: readonly string[],
    count: (path: string) => Promise<number>,
    signal?: AbortSignal,
    maxInFlight: number = MediaFolderCounts.MaxInFlight,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    let next = 0
    const lane = async () => {
      while (next < paths.length && !signal?.aborted) {
        const path = paths[next++]
        counts[path] = await count(path)
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxInFlight, paths.length) }, lane))
    return counts
  }
}
