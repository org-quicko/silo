import { useEffect } from 'react'
import { Claims } from '@silo/shared/claims'
import type { Collection } from '../api/types/collection'
import type { ScopeRef } from '../api/types/scope-ref'
import type { Route } from '../router/route'
import { router } from '../router/router'
import { Routes } from '../router/routes'

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
  collections: Collection[],
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

    // The index is not a page: it forwards to the first collection there is.
    if (route.view === 'collections') {
      if (collections.length) {
        router.navigate(
          Routes.entries(serverId, scope.project, scope.env, collections[0].name),
          { replace: true },
        )
      }
      return
    }

    const named = 'collection' in route ? route.collection : null
    if (named && !collections.some((collection) => collection.name === named)) {
      router.navigate(collectionsUrl, { replace: true })
    }
  }, [ready, claims, route, collections, serverId, scope.project, scope.env])
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
