import { useCallback } from 'react'
import { api } from '../api/silo-api'
import type { ScopeRef } from '../api/types/scope-ref'
import type { Variable } from '../api/types/variable'
import { store } from './store'
import { StoreKeys } from './store-keys'
import { useResource } from './use-resource'

export interface VariablesResource {
  variables: Variable[]
  /** True once the server has answered for this scope, from cache or fresh. */
  loaded: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<Variable[]>
}

/**
 * Every variable the project declares, valued for this environment (D57).
 *
 * Read by two very different surfaces, which is why it is a store resource
 * rather than state on the settings page: the Variables page edits it, and
 * **every entry form reads it** to show what a `{{NAME}}` someone typed
 * resolves to. Without one cache those previews would be a request per form.
 *
 * `staleAfter` is generous on purpose. A value changes when an operator changes
 * it, not on its own, and the editor's preview is a hint rather than the
 * answer — the API is. Re-asking on every field render would spend a request to
 * refresh something that is almost never different.
 */
export function useVariables(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  options: { enabled?: boolean } = {},
): VariablesResource {
  const { enabled = true } = options
  const key = StoreKeys.variables(serverId, scope)

  const state = useResource(
    key,
    // A key with no read in this scope gets a 403, which is a legitimate answer
    // and not a failure worth surfacing in a form: the preview simply has
    // nothing to show. The page itself reports it, because there it is the
    // whole point of the screen.
    () => (enabled ? api.variables.list(url, apiKey, scope) : Promise.resolve([])),
    { staleAfter: 30_000 },
  )

  const refresh = useCallback(
    () => store.refresh(key, () => api.variables.list(url, apiKey, scope)).then((list) => list ?? []),
    // The key already names the scope, so `scope`'s identity is not a reason to
    // rebuild this — the same rule `useCollections` follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, url, apiKey],
  )

  return {
    variables: state.value ?? [],
    loaded: state.value !== null,
    loading: state.loading,
    error: state.error,
    refresh,
  }
}

/**
 * Drops every environment's cached variables for one project.
 *
 * Declaring, renaming and undeclaring are project-wide, so invalidating only
 * the scope that issued the request would leave a sibling environment's cached
 * list naming a variable that no longer exists. The prefix reaches every
 * environment's copy and nothing else — see `StoreKeys.variables` for why the
 * key is rooted at the project rather than nested under the scope.
 */
export function invalidateProjectVariables(serverId: string, project: string): void {
  store.invalidatePrefix(StoreKeys.variablesInProject(serverId, project))
}
