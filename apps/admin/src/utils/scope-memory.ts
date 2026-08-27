import type { ScopeRef } from '../api/types/scope-ref'

const STORAGE_KEY = 'silo_active_scope'

/**
 * The last (project, env) the browser was working in, per server.
 *
 * The URL stays the source of truth — this only answers the question a URL
 * cannot: which scope should the settings nav's PROJECT and ENVIRONMENT groups
 * point at while an *unscoped* page (API keys, connection, appearance) is open?
 * Without it, opening settings from the keys page would have nowhere to send
 * "Environments".
 */
export class ScopeMemory {
  static get(serverId: string): ScopeRef | null {
    const all = ScopeMemory.read()
    const scope = all[serverId]
    return scope && typeof scope.project === 'string' && typeof scope.env === 'string' ? scope : null
  }

  static set(serverId: string, scope: ScopeRef): void {
    const all = ScopeMemory.read()
    const current = all[serverId]
    if (current && current.project === scope.project && current.env === scope.env) return
    all[serverId] = { project: scope.project, env: scope.env }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }

  /**
   * Resolve a remembered id against what the server currently lists, falling
   * back to the first available one.
   *
   * A remembered id can outlive the thing it names — delete the environment
   * you were last in and the memory still points at it. Trusting it then would
   * leave the switcher displaying a scope that no longer exists and linking to
   * pages that 404. While the list is still loading it is empty for reasons
   * that say nothing about the id, so the check is deferred rather than failed.
   */
  static pick(remembered: string | null | undefined, available: string[], loading: boolean): string | null {
    if (remembered && (loading || available.includes(remembered))) return remembered
    return available[0] ?? null
  }

  static forget(serverId: string): void {
    const all = ScopeMemory.read()
    if (!(serverId in all)) return
    delete all[serverId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }

  private static read(): Record<string, ScopeRef> {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      // A hand-edited or half-written value must not break navigation.
      return {}
    }
  }
}
