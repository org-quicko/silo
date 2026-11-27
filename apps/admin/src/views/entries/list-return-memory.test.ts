import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ListReturnMemory } from './list-return-memory'

describe('ListReturnMemory', () => {
  const scope = { project: 'acme', env: 'prod' }
  let store: Record<string, string>
  let previousDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    store = {}
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (name: string) => (name in store ? store[name] : null),
        setItem: (name: string, value: string) => {
          store[name] = value
        },
        removeItem: (name: string) => {
          delete store[name]
        },
      },
    })
    ListReturnMemory.clearAll()
  })

  afterEach(() => {
    ListReturnMemory.clearAll()
    if (previousDescriptor) Object.defineProperty(globalThis, 'sessionStorage', previousDescriptor)
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })

  test('scopes returnTo and focusEntryId per navigation token without leaking to other tokens', () => {
    const urlA =
      '/servers/s1/projects/acme/environments/prod/collections/posts?q=hello&sort=-%24.data.title&filter=%7B%7D&page=3&cols=status%2Ctags'
    const tokenA = ListReturnMemory.save('s1', scope, 'posts', {
      returnTo: urlA,
      focusEntryId: 'entry-a',
    })
    const urlB = '/servers/s1/projects/acme/environments/prod/collections/posts?page=1'
    const tokenB = ListReturnMemory.save('s1', scope, 'posts', {
      returnTo: urlB,
      focusEntryId: 'entry-b',
    })

    expect(ListReturnMemory.get(tokenA, 's1', scope, 'posts')).toEqual({
      returnTo: urlA,
      focusEntryId: 'entry-a',
    })
    expect(ListReturnMemory.get(tokenB, 's1', scope, 'posts')).toEqual({
      returnTo: urlB,
      focusEntryId: 'entry-b',
    })
    expect(ListReturnMemory.get(undefined, 's1', scope, 'posts')).toBeNull()
    expect(ListReturnMemory.get(tokenA, 's1', scope, 'authors')).toBeNull()
  })

  test('falls back to in-memory map when sessionStorage methods or getter throw', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: () => {
          throw new Error('SecurityError')
        },
      },
    })

    const url = '/servers/s1/projects/acme/environments/prod/collections/posts?q=fallback'
    const token = ListReturnMemory.save('s1', scope, 'posts', {
      returnTo: url,
      focusEntryId: 'entry-1',
    })
    expect(ListReturnMemory.get(token, 's1', scope, 'posts')).toEqual({
      returnTo: url,
      focusEntryId: 'entry-1',
    })

    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError on getter')
      },
    })
    const url2 = '/servers/s1/projects/acme/environments/prod/collections/posts?q=getter'
    const token2 = ListReturnMemory.save('s1', scope, 'posts', {
      returnTo: url2,
      focusEntryId: 'entry-2',
    })
    expect(ListReturnMemory.get(token2, 's1', scope, 'posts')).toEqual({
      returnTo: url2,
      focusEntryId: 'entry-2',
    })
  })

  test('ignores mismatched routes', () => {
    const token = ListReturnMemory.save('s1', scope, 'posts', {
      returnTo: '/servers/s1/projects/acme/environments/prod/collections/authors',
      focusEntryId: 'entry-x',
    })
    expect(token).toBeNull()
  })
})
