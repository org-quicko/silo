import { useEffect } from 'react'
import { Claims } from '@silo/shared/claims'
import type { CollectionSummary } from '../api/types/collection-summary'
import type { ScopeRef } from '../api/types/scope-ref'
import type { Route } from '../router/route'
import { router } from '../router/router'
import { Routes } from '../router/routes'
import { CollectionVisits } from '../utils/collection-visits'

/**
 * Resolves routes that can only be settled once the collections and the key's
 * claims are known: the collection index, links to collections that no longer
 * exist, and claim-protected areas reached with a key that cannot use them.
 *
 * Every redirect replaces rather than pushes, so Back does not bounce.
 */
export function useRouteGuard(
  ready: boolean,
  route: Route,
  claims: string[],
  collections: CollectionSummary[],
  serverId: string,
  scope: ScopeRef,
): void {
  useEffect(() => {
    if (!ready) return

    const collectionsUrl = Routes.collections(serverId, scope.project, scope.env)

    if (isBlocked(route, claims, scope)) {
      router.navigate(collectionsUrl, { replace: true })
      return
    }

    // The index is not a page: it forwards to a collection. Which one is the
    // last one opened in this scope, not the first one alphabetically — the
    // breadcrumb's `Collections` crumb leads here from inside a collection, and
    // forwarding to `collections[0]` answered it by moving the reader somewhere
    // they had not asked to go.
    if (route.view === 'collections') {
      const landing = firstExisting(
        CollectionVisits.recent(serverId, scope.project, scope.env),
        collections,
      )
      if (landing) {
        router.navigate(Routes.entries(serverId, scope.project, scope.env, landing), {
          replace: true,
        })
      }
      return
    }

    const named = 'collection' in route ? route.collection : null
    if (named && !collections.some((collection) => collection.name === named)) {
      router.navigate(collectionsUrl, { replace: true })
    }
  }, [ready, claims, route, collections, serverId, scope.project, scope.env])
}

/** The most recently visited collection that still exists, else the first
 *  there is. A recorded visit outlives the collection it names, so the list is
 *  filtered against what the session actually loaded. */
function firstExisting(recent: readonly string[], collections: CollectionSummary[]): string | null {
  const exists = new Set(collections.map((collection) => collection.name))
  return recent.find((name) => exists.has(name)) ?? collections[0]?.name ?? null
}

/** Whether this key may not open the route at all. */
function isBlocked(route: Route, claims: string[], scope: ScopeRef): boolean {
  if (route.view === 'media') return !Claims.has(claims, Claims.MediaRead)

  if (route.view === 'schema' && route.collection === null) {
    return !Claims.hasAnyCollectionPermission(
      claims,
      Claims.CollectionCreate,
      scope.project,
      scope.env,
    )
  }
  if (route.view === 'schema' && route.collection !== null) {
    return !Claims.has(
      claims,
      Claims.collection(
        scope.project,
        scope.env,
        route.collection,
        Claims.CollectionSchemaUpdate,
      ),
    )
  }
  return false
}
