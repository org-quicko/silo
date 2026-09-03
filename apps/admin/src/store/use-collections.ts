import { useCallback } from 'react'
import { api } from '../api/silo-api'
import type { CollectionSummary } from '../api/types/collection-summary'
import type { ScopeRef } from '../api/types/scope-ref'
import { store } from './store'
import { StoreKeys } from './store-keys'
import { useResource } from './use-resource'

export interface CollectionsResource {
  collections: CollectionSummary[]
  /** True once the server has answered for this scope, from cache or fresh. */
  loaded: boolean
  loading: boolean
  error: string | null
  /** Drops the cached list and asks again, answering with what came back — what
   *  a create, rename or delete calls before navigating to its result. */
  refresh: () => Promise<CollectionSummary[]>
}

/**
 * The collection list the sidebar navigates and every scoped view resolves a
 * name against.
 *
 * One request for the whole scope, entry counts included (D54). It used to be
 * one request for the list plus one `limit=1` list *per collection* to learn
 * each count — which transfers a whole entry to read a number.
 */
export function useCollections(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
): CollectionsResource {
  const key = StoreKeys.collections(serverId, scope)
  const state = useResource(key, () => api.collections.list(url, apiKey, scope))

  const refresh = useCallback(
    () =>
      store.refresh(key, () => api.collections.list(url, apiKey, scope)).then((list) => list ?? []),
    // The key already names the scope, so `scope`'s own identity is not a
    // reason to rebuild this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, url, apiKey],
  )

  return {
    collections: state.value ?? [],
    loaded: state.value !== null,
    loading: state.loading,
    error: state.error,
    refresh,
  }
}
