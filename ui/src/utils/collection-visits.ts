const STORAGE_KEY = 'silo_collection_visits'
const LIMIT = 20

/**
 * Recently-visited collections, per (server, project, env) — most recent
 * first. Backs the `@`-mention popup's "sorted by recency of visit, then
 * name" rule (handoff 1f): a list ordered only alphabetically would put the
 * collection someone works in every day behind twenty they have never opened.
 *
 * A URL is still what makes a scope linkable (§ State Management); this is
 * pure UI convenience layered on top; losing it costs nothing but a sort
 * order.
 */
export class CollectionVisits {
  static record(serverId: string, project: string, env: string, name: string): void {
    const key = CollectionVisits.key(serverId, project, env)
    const all = CollectionVisits.read()
    const list = (all[key] ?? []).filter((n) => n !== name)
    list.unshift(name)
    all[key] = list.slice(0, LIMIT)
    CollectionVisits.write(all)
  }

  /** Every recorded name for this scope, most recent first — not filtered against what currently exists. */
  static recent(serverId: string, project: string, env: string): string[] {
    return CollectionVisits.read()[CollectionVisits.key(serverId, project, env)] ?? []
  }

  private static key(serverId: string, project: string, env: string): string {
    return `${serverId}/${project}/${env}`
  }

  private static read(): Record<string, string[]> {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private static write(all: Record<string, string[]>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }
}
