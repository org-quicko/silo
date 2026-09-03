import { useEffect } from 'react'
import type { Entry } from '../api/types/entry'
import type { ScopeRef } from '../api/types/scope-ref'
import { useEntry } from '../store/use-entry'
import { router } from '../router/router'
import { Routes } from '../router/routes'

/**
 * A deep link to an entry carries only its id, so the entry comes from the
 * store rather than being handed down from the list — which is also what makes
 * going back into a row you just left instant.
 *
 * A stale or bad id falls back to the collection it claims to belong to. An
 * empty form would look like a new entry, which it is not.
 */
export function useDeepLinkedEntry(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  collection: string | null,
  entryId: string | null,
): Entry | null {
  const state = useEntry(serverId, url, apiKey, scope, collection, entryId)

  // Only when nothing is cached: a refresh that failed on an entry already on
  // screen is not grounds for navigating out of the form it is being edited in.
  useEffect(() => {
    if (!collection || !state.error || state.value) return
    router.navigate(Routes.entries(serverId, scope.project, scope.env, collection), {
      replace: true,
    })
  }, [serverId, scope.project, scope.env, collection, state.error, state.value])

  return state.value
}
