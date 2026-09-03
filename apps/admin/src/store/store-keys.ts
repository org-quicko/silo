import type { ScopeRef } from '../api/types/scope-ref'

/**
 * Every cache key the admin reads, spelled once.
 *
 * A key is rooted at the *saved connection's* id rather than the server's URL:
 * two saved servers can address one instance with different API keys, and a
 * key's claims decide what its answers contain, so their caches must not meet.
 * Segments are `/`-separated so `Store.invalidatePrefix` can name a subtree —
 * one collection's entries and every page of them — in one call.
 */
export class StoreKeys {
  /** Who the connected key is. */
  static session(serverId: string): string {
    return `${serverId}/session`
  }

  /** The instance's version, from the unauthenticated health route. */
  static health(serverId: string): string {
    return `${serverId}/health`
  }

  static collections(serverId: string, scope: ScopeRef): string {
    return `${StoreKeys.scope(serverId, scope)}/collections`
  }

  /** Every schema in the scope, as one answer. Loaded only by the screens that
   *  need the whole graph (D54), never by the shell. */
  static schemas(serverId: string, scope: ScopeRef): string {
    return `${StoreKeys.scope(serverId, scope)}/schemas`
  }

  /** One collection's schema. */
  static schema(serverId: string, scope: ScopeRef, collection: string): string {
    return `${StoreKeys.collection(serverId, scope, collection)}/schema`
  }

  static entry(serverId: string, scope: ScopeRef, collection: string, id: string): string {
    return `${StoreKeys.collection(serverId, scope, collection)}/entries/${id}`
  }

  /** One answered list or search. The query is part of the key, so paging back
   *  is a cache read and out-of-order responses cannot overwrite each other. */
  static entryPage(serverId: string, scope: ScopeRef, collection: string, query: unknown): string {
    return `${StoreKeys.collection(serverId, scope, collection)}/pages/${JSON.stringify(query)}`
  }

  /** Everything held about one collection, for invalidating after a write. */
  static collection(serverId: string, scope: ScopeRef, collection: string): string {
    return `${StoreKeys.scope(serverId, scope)}/collections/${collection}`
  }

  /** Everything held about one project and environment. */
  static scope(serverId: string, scope: ScopeRef): string {
    return `${serverId}/${scope.project}/${scope.env}`
  }
}
