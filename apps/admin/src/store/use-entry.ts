import { api } from '../api/silo-api'
import type { Entry } from '../api/types/entry'
import type { ResourceState } from './resource-state'
import type { ScopeRef } from '../api/types/scope-ref'
import { StoreKeys } from './store-keys'
import { useResource } from './use-resource'

/**
 * One entry by id.
 *
 * A `null` collection or id means there is nothing to fetch — the form for a
 * new entry — and answers blank rather than loading.
 */
export function useEntry(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  collection: string | null,
  entryId: string | null,
): ResourceState<Entry> {
  const key = collection && entryId ? StoreKeys.entry(serverId, scope, collection, entryId) : null

  return useResource(key, () =>
    api.entries.get(url, apiKey, scope, collection as string, entryId as string),
  )
}
