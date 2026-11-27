const STORAGE_KEY = 'silo_entries_preferences'

export interface EntriesTablePreferences {
  cols: string[] | null
  pageSize: number
}

interface StoredCollectionPreferences {
  cols?: unknown
  pageSize?: unknown
}

/**
 * Per-(server, project, env, collection) entries-table preferences persisted in
 * `localStorage` (with an in-memory fallback when storage throws): chosen extra
 * columns and rows-per-page, plus page clamping helpers.
 */
export class EntriesPreferences {
  static readonly AllowedPageSizes = [10, 25, 50, 100] as const
  static readonly DefaultPageSize = 50
  private static readonly fallback = new Map<string, StoredCollectionPreferences>()

  static key(serverId: string, project: string, env: string, collection: string): string {
    return `${serverId}/${project}/${env}/${collection}`
  }

  static normalizePageSize(value: unknown): number {
    return typeof value === 'number' &&
      EntriesPreferences.AllowedPageSizes.includes(
        value as (typeof EntriesPreferences.AllowedPageSizes)[number],
      )
      ? value
      : EntriesPreferences.DefaultPageSize
  }

  static read(key: string): EntriesTablePreferences {
    const stored = EntriesPreferences.readAll()[key]
    if (!stored || typeof stored !== 'object') {
      return { cols: null, pageSize: EntriesPreferences.DefaultPageSize }
    }

    const cols = Array.isArray(stored.cols)
      ? [
          ...new Set(
            stored.cols
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ]
      : null

    return {
      cols: cols && cols.length > 0 ? cols : null,
      pageSize: EntriesPreferences.normalizePageSize(stored.pageSize),
    }
  }

  static writeCols(key: string, cols: readonly string[] | null): void {
    const all = EntriesPreferences.readAll()
    const entry: StoredCollectionPreferences = { ...(all[key] || {}) }
    if (cols && cols.length > 0) {
      entry.cols = [...cols]
    } else {
      delete entry.cols
    }
    EntriesPreferences.commitEntry(all, key, entry)
  }

  static writePageSize(key: string, pageSize: number): void {
    const all = EntriesPreferences.readAll()
    const entry: StoredCollectionPreferences = { ...(all[key] || {}) }
    const normalized = EntriesPreferences.normalizePageSize(pageSize)
    if (normalized !== EntriesPreferences.DefaultPageSize) {
      entry.pageSize = normalized
    } else {
      delete entry.pageSize
    }
    EntriesPreferences.commitEntry(all, key, entry)
  }

  static clearFallback(): void {
    EntriesPreferences.fallback.clear()
  }

  /**
   * Clamps `page` back onto the valid last page when deleting rows (or
   * narrowing results) leaves `offset >= total` past page 1.
   */
  static clampPage(page: number, pageSize: number, total: number): number {
    if (!Number.isFinite(page) || page <= 1) return 1
    const safePageSize = pageSize > 0 ? pageSize : EntriesPreferences.DefaultPageSize
    const offset = (page - 1) * safePageSize
    if (offset < total) return page
    return Math.max(1, Math.ceil(total / safePageSize))
  }

  private static storage(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }

  private static commitEntry(
    all: Record<string, StoredCollectionPreferences>,
    key: string,
    entry: StoredCollectionPreferences,
  ): void {
    if (entry.cols === undefined && entry.pageSize === undefined) {
      delete all[key]
      EntriesPreferences.fallback.set(key, {})
    } else {
      all[key] = entry
      EntriesPreferences.fallback.set(key, entry)
    }
    try {
      EntriesPreferences.storage()?.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // Storage quota/availability must never break the table; fallback holds session state.
    }
  }

  private static readAll(): Record<string, StoredCollectionPreferences> {
    const memory = Object.fromEntries(EntriesPreferences.fallback.entries())
    const storage = EntriesPreferences.storage()
    if (!storage) return memory
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) return memory
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, StoredCollectionPreferences>), ...memory }
      }
    } catch {
      return memory
    }
    return memory
  }
}
