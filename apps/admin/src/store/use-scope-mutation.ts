import { useCallback, useSyncExternalStore } from 'react'
import type { ScopeRef } from '../api/types/scope-ref'
import { store } from './store'
import { StoreKeys } from './store-keys'

/** Subscribes to same-key collection/entry write signals for `scope` so a
 *  freshly mounted shell (e.g. returning from Settings mid-save) still
 *  refreshes once an in-flight mutation settles. */
export function useScopeMutationVersion(serverId: string, scope: ScopeRef): number {
  const scopeKey = StoreKeys.scope(serverId, scope)
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribeMutation(scopeKey, onChange),
    [scopeKey],
  )
  const getSnapshot = useCallback(() => store.mutationVersion(scopeKey), [scopeKey])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
