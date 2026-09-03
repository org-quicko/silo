import type { ResourceState } from './resource-state'

/** The request `dispatch` makes for a key. */
export type ResourceLoader<T> = () => Promise<T>

/**
 * The admin's server-state store: one `ResourceState` per cache key, an
 * observer set per key, and `dispatch` as the only way a request is made.
 *
 * Reads never wait — `state` answers from the cache — and `dispatch` refreshes
 * behind them, so a view that has been open before draws what it already had
 * while the new answer is in flight. Two dispatches for one key share one
 * request, which is what makes a refresh on every mount cheap.
 *
 * Keys are built by `StoreKeys`; `docs/design/admin-ui.md` §9.1 says why the
 * cache is a store rather than state hanging off each view.
 */
export class Store {
  /** The state of a key nothing has touched. One frozen instance, because
   *  `useSyncExternalStore` compares snapshots by identity. */
  private static readonly blank: ResourceState<never> = Object.freeze({
    value: null,
    loading: false,
    error: null,
    loadedAt: 0,
  })

  private readonly states = new Map<string, ResourceState<unknown>>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly running = new Map<string, { epoch: number; request: Promise<unknown> }>()
  /** Bumped by `invalidate` and `set`. A request that settles behind its key's
   *  epoch writes nothing — that is what stops a read started before a save
   *  from putting the pre-save answer back. */
  private readonly epochs = new Map<string, number>()

  state<T>(key: string | null): ResourceState<T> {
    if (key === null) return Store.blank
    return (this.states.get(key) as ResourceState<T> | undefined) ?? Store.blank
  }

  subscribe(key: string | null, listener: () => void): () => void {
    if (key === null) return () => {}
    const observers = this.listeners.get(key) ?? new Set<() => void>()
    observers.add(listener)
    this.listeners.set(key, observers)
    return () => {
      observers.delete(listener)
      if (observers.size === 0) this.listeners.delete(key)
    }
  }

  /**
   * Loads a key unless its value is younger than `staleAfter` milliseconds or a
   * request for it is already in flight. Never rejects: a failure is part of
   * the key's state, and this is called from effects where nothing would catch.
   */
  dispatch<T>(key: string, load: ResourceLoader<T>, staleAfter = 0): Promise<T | null> {
    const current = this.state<T>(key)
    const fresh = current.loadedAt > 0 && Date.now() - current.loadedAt < staleAfter
    if (fresh) return Promise.resolve(current.value)

    const epoch = this.epoch(key)
    const running = this.running.get(key)
    if (running && running.epoch === epoch) return running.request as Promise<T | null>

    this.write(key, { ...current, loading: true, error: null })
    const request = load().then(
      (value) => this.settle(key, epoch, { value, loading: false, error: null, loadedAt: Date.now() }),
      (caught) => this.settle(key, epoch, { ...this.state<T>(key), loading: false, error: Store.messageOf(caught) }),
    )
    this.running.set(key, { epoch, request })
    return request
  }

  /** Drops what a key holds and loads it again — what a mutation's own refresh
   *  wants, where the cache is known to be behind. */
  refresh<T>(key: string, load: ResourceLoader<T>): Promise<T | null> {
    this.invalidate(key)
    return this.dispatch(key, load)
  }

  /** Marks a key stale without dropping its value, so the next reader shows
   *  what it had and asks again. */
  invalidate(key: string): void {
    this.epochs.set(key, this.epoch(key) + 1)
    const current = this.states.get(key)
    if (current) this.write(key, { ...current, loadedAt: 0 })
  }

  /** Every key at or under a `/`-separated prefix: one collection's entries and
   *  pages after a write to any of them. The separator is part of the match, so
   *  a collection named `city` does not invalidate `cities`. */
  invalidatePrefix(prefix: string): void {
    for (const key of [...this.states.keys(), ...this.running.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) this.invalidate(key)
    }
  }

  /** Writes an answer the app already has — a saved entry — so going back to it
   *  does not wait for a round trip to say what was just sent. */
  set<T>(key: string, value: T): void {
    this.epochs.set(key, this.epoch(key) + 1)
    this.write(key, { value, loading: false, error: null, loadedAt: Date.now() })
  }

  /** Forgets everything. Called when the session ends: the next key holder may
   *  be a different API key, whose claims decide what its answers contain. */
  clear(): void {
    const keys = [...this.states.keys()]
    this.states.clear()
    this.running.clear()
    for (const key of keys) {
      this.epochs.set(key, this.epoch(key) + 1)
      this.notify(key)
    }
  }

  private settle<T>(key: string, epoch: number, next: ResourceState<T>): T | null {
    if (this.running.get(key)?.epoch === epoch) this.running.delete(key)
    if (this.epoch(key) !== epoch) return this.state<T>(key).value
    this.write(key, next)
    return next.value
  }

  private epoch(key: string): number {
    return this.epochs.get(key) ?? 0
  }

  private write<T>(key: string, next: ResourceState<T>): void {
    this.states.set(key, next as ResourceState<unknown>)
    this.notify(key)
  }

  private notify(key: string): void {
    const observers = this.listeners.get(key)
    if (!observers) return
    for (const listener of [...observers]) listener()
  }

  private static messageOf(caught: unknown): string {
    return caught instanceof Error && caught.message ? caught.message : 'Request failed'
  }
}

export const store = new Store()
