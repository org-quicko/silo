import { api } from '../api/silo-api'
import type { Collection } from '../api/types/collection'
import type { ScopeRef } from '../api/types/scope-ref'
import { StoreKeys } from './store-keys'
import { useResource } from './use-resource'

export interface CollectionSchemasResource {
  collections: Collection[]
  loaded: boolean
}

/**
 * Every schema in the scope, for the one thing that genuinely reads across all
 * of them: the search bar matching a collection by one of its *field* names.
 *
 * Nothing else needs this. A page rendering one collection asks for that
 * collection (`useCollectionSchema`), and the schema the server answers with is
 * self-contained — its `silo://` refs are bundled into its own `$defs` (D54).
 *
 * `enabled` is what keeps it off the shell's path, and off the path of every
 * session that never types into the bar.
 */
export function useCollectionSchemas(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  enabled: boolean,
): CollectionSchemasResource {
  const key = enabled ? StoreKeys.schemas(serverId, scope) : null
  const state = useResource(key, () => api.collections.schemas(url, apiKey, scope))

  return { collections: state.value ?? [], loaded: state.value !== null }
}
