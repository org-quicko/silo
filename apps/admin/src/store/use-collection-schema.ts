import { api } from '../api/silo-api'
import type { Collection } from '../api/types/collection'
import type { ResourceState } from './resource-state'
import type { ScopeRef } from '../api/types/scope-ref'
import { StoreKeys } from './store-keys'
import { useResource } from './use-resource'

/**
 * One collection with its schema — what a page rendering that collection needs,
 * and all it needs (D54).
 *
 * `null` for the name means no collection is being rendered, and answers blank
 * rather than loading.
 */
export function useCollectionSchema(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  name: string | null,
): ResourceState<Collection> {
  const key = name ? StoreKeys.schema(serverId, scope, name) : null

  return useResource(key, () => api.collections.get(url, apiKey, scope, name as string))
}
