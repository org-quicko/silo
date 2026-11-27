import { describe, expect, test } from 'bun:test'
import type { CollectionSummary } from '../../api/types/collection-summary'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { Route } from '../../router/route'
import { SchemaRedirectGuard, type PendingSchemaScope } from './schema-redirect-guard'

const scope: ScopeRef = { project: 'default', env: 'production' }

function summary(name: string): CollectionSummary {
  return {
    id: `col_${name}`,
    name,
    entries: 0,
    requiresAuth: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

describe('SchemaRedirectGuard', () => {
  test('suppresses missing-collection redirect only while on the pending originating schema route', () => {
    const oldRoute: Route = {
      view: 'schema',
      serverId: 'srv-1',
      project: 'default',
      env: 'production',
      collection: 'posts',
    }
    const pending: PendingSchemaScope = {
      serverId: 'srv-1',
      project: 'default',
      env: 'production',
      collection: 'posts',
      mutationId: 1,
    }
    const afterRename: CollectionSummary[] = [summary('articles')]

    // Without pending guard, missing collection redirects to /collections.
    expect(
      SchemaRedirectGuard.shouldRedirectMissingCollection({
        route: oldRoute,
        collections: afterRename,
        serverId: 'srv-1',
        scope,
        pending: null,
      }),
    ).toBe(true)

    // While rename/delete refresh is active for `posts`, missing redirect is suppressed.
    expect(
      SchemaRedirectGuard.shouldRedirectMissingCollection({
        route: oldRoute,
        collections: afterRename,
        serverId: 'srv-1',
        scope,
        pending,
      }),
    ).toBe(false)

    expect(
      SchemaRedirectGuard.shouldRedirectMissingCollection({
        route: oldRoute,
        collections: afterRename,
        serverId: 'srv-1',
        scope,
        pending: { ...pending, navId: 10 },
        currentNavId: 11,
      }),
    ).toBe(true)

    // Navigating to a different collection or entries view must not stay suppressed.
    expect(
      SchemaRedirectGuard.shouldRedirectMissingCollection({
        route: { ...oldRoute, collection: 'other' },
        collections: afterRename,
        serverId: 'srv-1',
        scope,
        pending,
      }),
    ).toBe(true)
    expect(
      SchemaRedirectGuard.shouldRedirectMissingCollection({
        route: {
          view: 'entries',
          serverId: 'srv-1',
          project: 'default',
          env: 'production',
          collection: 'posts',
          query: { q: '', filter: '', sort: '', desc: false, page: 1, cols: null },
        },
        collections: afterRename,
        serverId: 'srv-1',
        scope,
        pending,
      }),
    ).toBe(true)
  })

  test('lets rename redirect to newName succeed regardless of collections vs schema response order', async () => {
    const simulateRenameOrder = async (collectionsFirst: boolean): Promise<Route> => {
      let currentRoute: Route = {
        view: 'schema',
        serverId: 'srv-1',
        project: 'default',
        env: 'production',
        collection: 'posts',
      }
      let currentCollections: CollectionSummary[] = [summary('posts')]
      let pending: PendingSchemaScope | null = {
        serverId: 'srv-1',
        project: 'default',
        env: 'production',
        collection: 'posts',
        mutationId: 1,
      }

      const runRouteGuard = () => {
        if (
          SchemaRedirectGuard.shouldRedirectMissingCollection({
            route: currentRoute,
            collections: currentCollections,
            serverId: 'srv-1',
            scope,
            pending,
          })
        ) {
          currentRoute = {
            view: 'collections',
            serverId: 'srv-1',
            project: 'default',
            env: 'production',
          }
        }
      }

      let resolveCollections!: () => void
      let resolveSchema!: () => void
      const refreshCollections = new Promise<void>((resolve) => {
        resolveCollections = () => {
          currentCollections = [summary('articles')]
          resolve()
        }
      })
      const refreshSchema = new Promise<void>((resolve) => {
        resolveSchema = resolve
      })

      const bothDone = Promise.all([refreshSchema, refreshCollections]).then(() => {
        // Simulates `onSaved` checking `stillOnThisSchema()` after both settle.
        if (currentRoute.view === 'schema' && currentRoute.collection === 'posts') {
          currentRoute = {
            view: 'entries',
            serverId: 'srv-1',
            project: 'default',
            env: 'production',
            collection: 'articles',
            query: { q: '', filter: '', sort: '', desc: false, page: 1, cols: null },
          }
        }
        pending = null
      })

      if (collectionsFirst) {
        resolveCollections()
        await refreshCollections
        runRouteGuard()
        expect(currentRoute.view).toBe('schema')
        resolveSchema()
      } else {
        resolveSchema()
        await refreshSchema
        runRouteGuard()
        expect(currentRoute.view).toBe('schema')
        resolveCollections()
        await refreshCollections
        runRouteGuard()
        expect(currentRoute.view).toBe('schema')
      }

      await bothDone
      runRouteGuard()
      return currentRoute
    }

    const firstOrderResult = await simulateRenameOrder(true)
    const secondOrderResult = await simulateRenameOrder(false)
    expect(firstOrderResult.view).toBe('entries')
    expect('collection' in firstOrderResult ? firstOrderResult.collection : null).toBe('articles')
    expect(secondOrderResult.view).toBe('entries')
    expect('collection' in secondOrderResult ? secondOrderResult.collection : null).toBe('articles')
  })

  test('mutationId ownership prevents stale cleanup from clearing a second rename even when Browser Back restores the same navId', () => {
    const visit1Guard: PendingSchemaScope = {
      serverId: 'srv-1',
      project: 'default',
      env: 'production',
      collection: 'posts',
      mutationId: 1,
      navId: 10,
    }
    const visit2GuardSameNavId: PendingSchemaScope = {
      ...visit1Guard,
      mutationId: 2,
      navId: 10,
    }
    const visit2GuardNewNavId: PendingSchemaScope = {
      ...visit1Guard,
      mutationId: 2,
      navId: 12,
    }
    const oldRoute: Route = {
      view: 'schema',
      serverId: 'srv-1',
      project: 'default',
      env: 'production',
      collection: 'posts',
    }
    const missingFromList: CollectionSummary[] = [summary('articles')]

    // If the user left (10 -> 11) and re-entered via link (12), visit 1's navId (10)
    // must NOT suppress redirect during visit 2 (currentNavId = 12).
    expect(
      SchemaRedirectGuard.shouldRedirectMissingCollection({
        route: oldRoute,
        collections: missingFromList,
        serverId: 'srv-1',
        scope,
        pending: visit1Guard,
        currentNavId: 12,
      }),
    ).toBe(true)

    // After Browser Back restores `navId: 10`, starting a second rename yields `mutationId: 2`.
    // Mutation 1's late cleanup (`mutationIdAtStart: 1`) must NOT clear mutation 2's guard!
    expect(SchemaRedirectGuard.release(visit2GuardSameNavId, 1, false)).toEqual(
      visit2GuardSameNavId,
    )
    expect(SchemaRedirectGuard.release(visit2GuardNewNavId, 1, false)).toEqual(
      visit2GuardNewNavId,
    )
    expect(SchemaRedirectGuard.release(visit2GuardSameNavId, null, false)).toEqual(
      visit2GuardSameNavId,
    )
    // Only the owning mutation (`mutationId: 2`) releases it.
    expect(SchemaRedirectGuard.release(visit2GuardSameNavId, 2, true)).toBeNull()
  })
})
