import { describe, expect, test } from 'bun:test'
import { Store } from './store'

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Store', () => {
  test('an untouched key reads blank, with one identity', () => {
    const store = new Store()
    expect(store.state('a')).toEqual({ value: null, loading: false, error: null, loadedAt: 0 })
    expect(store.state('a')).toBe(store.state('b'))
  })

  test('a dispatched key loads, then reads from the cache', async () => {
    const store = new Store()
    let calls = 0

    await store.dispatch('a', async () => ++calls)
    expect(store.state<number>('a').value).toBe(1)

    await store.dispatch('a', async () => ++calls, 60_000)
    expect(calls).toBe(1)
  })

  test('two dispatches for one key share a request', async () => {
    const store = new Store()
    let calls = 0
    const load = async () => {
      calls += 1
      await settled()
      return calls
    }

    await Promise.all([store.dispatch('a', load), store.dispatch('a', load)])
    expect(calls).toBe(1)
  })

  test('a failure is recorded, never thrown, and keeps the value it had', async () => {
    const store = new Store()
    await store.dispatch('a', async () => 'first')

    await store.dispatch('a', async () => {
      throw new Error('offline')
    })

    expect(store.state<string>('a').value).toBe('first')
    expect(store.state('a').error).toBe('offline')
    expect(store.state('a').loading).toBe(false)
  })

  // The one property the epoch exists for: a read that started before a write
  // must not put the pre-write answer back when it lands.
  test('a request settling behind its key writes nothing', async () => {
    const store = new Store()
    const stale = store.dispatch('a', async () => {
      await settled()
      return 'stale'
    })

    store.set('a', 'saved')
    await stale

    expect(store.state<string>('a').value).toBe('saved')
  })

  test('invalidate keeps the value and lets the next dispatch through', async () => {
    const store = new Store()
    let calls = 0
    const load = async () => `answer ${++calls}`

    await store.dispatch('a', load)
    store.invalidate('a')

    expect(store.state<string>('a').value).toBe('answer 1')
    await store.dispatch('a', load, 60_000)
    expect(store.state<string>('a').value).toBe('answer 2')
  })

  test('invalidatePrefix takes a subtree, and the separator is part of it', async () => {
    const store = new Store()
    await store.dispatch('s/city', async () => 1)
    await store.dispatch('s/city/pages/1', async () => 2)
    await store.dispatch('s/cities', async () => 3)

    store.invalidatePrefix('s/city')

    expect(store.state('s/city').loadedAt).toBe(0)
    expect(store.state('s/city/pages/1').loadedAt).toBe(0)
    expect(store.state('s/cities').loadedAt).not.toBe(0)
  })

  test('subscribers hear their own key and nobody else', async () => {
    const store = new Store()
    let heard = 0
    const stop = store.subscribe('a', () => {
      heard += 1
    })

    await store.dispatch('a', async () => 1)
    const afterOwnKey = heard
    await store.dispatch('b', async () => 2)
    expect(heard).toBe(afterOwnKey)

    stop()
    await store.refresh('a', async () => 3)
    expect(heard).toBe(afterOwnKey)
  })

  test('clear forgets every key and tells their subscribers', async () => {
    const store = new Store()
    await store.dispatch('a', async () => 1)
    let heard = 0
    store.subscribe('a', () => {
      heard += 1
    })

    store.clear()

    expect(store.state('a').value).toBeNull()
    expect(heard).toBe(1)
  })

  test('in-flight dispatch started before clear() never settles into the post-clear store', async () => {
    const store = new Store()
    let finishOld!: (value: string) => void
    const oldLoad = store.dispatch(
      'a',
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve
        }),
    )

    store.clear()
    finishOld('old-key-secret')
    await oldLoad

    expect(store.state<string>('a').value).toBeNull()
    expect(store.state<string>('a').loading).toBe(false)
  })

  test('invalidating an in-flight request clears loading when the stale request finishes with no replacement running', async () => {
    const store = new Store()
    let finishFirst!: (value: string) => void
    const first = store.dispatch(
      'a',
      () =>
        new Promise<string>((resolve) => {
          finishFirst = resolve
        }),
    )
    expect(store.state('a').loading).toBe(true)

    store.invalidate('a')
    finishFirst('stale')
    await first

    expect(store.state<string>('a').value).toBeNull()
    expect(store.state('a').loading).toBe(false)
  })

  test('sessionEpoch increments on clear() and gates cross-mount recordMutation signals', () => {
    const store = new Store()
    const scopeKey = 'srv/default/production'
    const epochAtStart = store.sessionEpoch()
    expect(epochAtStart).toBe(0)
    expect(store.mutationVersion(scopeKey)).toBe(0)

    // First listener unmounts (simulating Settings visit), then a new Workspace
    // listener mounts under the same credential session before the slow write finishes.
    let firstHeard = 0
    const stopFirst = store.subscribeMutation(scopeKey, () => {
      firstHeard += 1
    })
    stopFirst()

    let secondHeard = 0
    const stopSecond = store.subscribeMutation(scopeKey, () => {
      secondHeard += 1
    })

    expect(store.recordMutation(scopeKey, epochAtStart)).toBe(true)
    expect(firstHeard).toBe(0)
    expect(secondHeard).toBe(1)
    expect(store.mutationVersion(scopeKey)).toBe(1)

    // Once credentials change (`clear()`), the stale epoch must not signal again.
    store.clear()
    expect(store.sessionEpoch()).toBe(epochAtStart + 1)
    expect(store.recordMutation(scopeKey, epochAtStart)).toBe(false)
    expect(secondHeard).toBe(1)
    expect(store.mutationVersion(scopeKey)).toBe(1)
    stopSecond()
  })
})
