import type { CollectionSummary } from '../../api/types/collection-summary'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { Route } from '../../router/route'

export interface PendingSchemaScope {
  serverId: string
  project: string
  env: string
  collection: string
  /** Monotonic id uniquely identifying one mutation lifecycle even across Back. */
  mutationId: number
  /** Optional router navigation id tying suppression to the initiating visit. */
  navId?: number
}

/**
 * Coordinates `useRouteGuard` suppression while an active schema mutation
 * (`save`, `rename`, or `delete`) awaits `refreshCollections()` and completes
 * its own post-mutation redirect.
 *
 * When `refreshCollections()` settles ahead of `store.refresh(schema)`, the
 * originating collection name disappears from `collections` while `route`
 * still references it; suppressing the fallback missing-collection redirect
 * lets `onSaved` / `onDeleted` finish navigating to the intended destination.
 */
export class SchemaRedirectGuard {
  static matches(
    pending: PendingSchemaScope | null,
    route: Route,
    serverId: string,
    scope: ScopeRef,
    currentNavId?: number,
  ): boolean {
    if (!pending) return false
    if (route.view !== 'schema' || route.collection === null) return false
    if (
      pending.navId !== undefined &&
      currentNavId !== undefined &&
      pending.navId !== currentNavId
    ) {
      return false
    }
    return (
      pending.serverId === serverId &&
      pending.project === scope.project &&
      pending.env === scope.env &&
      pending.collection === route.collection
    )
  }

  /** Releases only the suppression owned by `mutationIdAtStart` so a stale
   *  completion (even after Browser Back restores the same `navId`) never
   *  clears a newer mutation's suppression. */
  static release(
    current: PendingSchemaScope | null,
    mutationIdAtStart: number | null | undefined,
    isCurrent = true,
  ): PendingSchemaScope | null {
    if (!current) return null
    if (mutationIdAtStart !== null && mutationIdAtStart !== undefined) {
      return current.mutationId === mutationIdAtStart ? null : current
    }
    return isCurrent ? null : current
  }

  static shouldRedirectMissingCollection(options: {
    route: Route
    collections: CollectionSummary[]
    serverId: string
    scope: ScopeRef
    pending: PendingSchemaScope | null
    currentNavId?: number
  }): boolean {
    const named = 'collection' in options.route ? options.route.collection : null
    if (!named) return false
    if (options.collections.some((collection) => collection.name === named)) return false
    return !SchemaRedirectGuard.matches(
      options.pending,
      options.route,
      options.serverId,
      options.scope,
      options.currentNavId,
    )
  }
}
