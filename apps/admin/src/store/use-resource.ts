import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ResourceState } from './resource-state'
import { store } from './store'

export interface ResourceOptions {
  /** Skip the background refresh while the cached value is younger than this,
   *  in milliseconds. `0` — the default — asks again on every mount. */
  staleAfter?: number
  /** Show the previous key's value until the new key answers, rather than
   *  blanking the view. What a paged table wants; what a form must not do. */
  keepPrevious?: boolean
  /** A change here dispatches again *without* changing the cache key: how an
   *  answer whose inputs moved refreshes in place instead of starting over
   *  under a new key with nothing in it. */
  watch?: string
}

/**
 * Reads one cache key and keeps it fresh: what the store holds renders now,
 * and the request goes out behind it.
 *
 * A `key` of `null` means there is nothing to load — a form for a new entry, a
 * page with no collection chosen — and answers with the blank state.
 */
export function useResource<T>(
  key: string | null,
  load: () => Promise<T>,
  options: ResourceOptions = {},
): ResourceState<T> {
  const { staleAfter = 0, keepPrevious = false, watch } = options

  // The loader closes over props that change on every render, while the effect
  // must re-run only when the key does. The ref is what separates the two.
  const loader = useRef(load)
  loader.current = load

  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(key, onChange), [key]),
    useCallback(() => store.state<T>(key), [key]),
    useCallback(() => store.state<T>(key), [key]),
  )

  useEffect(() => {
    if (key === null) return
    store.dispatch(key, () => loader.current(), staleAfter)
  }, [key, staleAfter, watch])

  // Written during render on purpose: it is a copy of the value being returned,
  // so a re-run leaves it saying the same thing.
  const previous = useRef<T | null>(null)
  if (state.value !== null) previous.current = state.value

  const value = keepPrevious && state.value === null ? previous.current : state.value

  // The dispatch happens in an effect, a frame after this first returns. A key
  // holding nothing and reporting no failure is therefore already waiting, and
  // saying otherwise flashes an empty view before the request is even made.
  const loading =
    state.loading || (key !== null && state.value === null && state.error === null)

  if (value === state.value && loading === state.loading) return state
  return { ...state, value, loading }
}
