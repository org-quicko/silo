import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EntriesPreferences } from './entries-preferences'

describe('EntriesPreferences storage', () => {
  const key = EntriesPreferences.key('s1', 'acme', 'prod', 'posts')
  const otherKey = EntriesPreferences.key('s1', 'acme', 'prod', 'authors')
  let store: Record<string, string>
  let previousDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    EntriesPreferences.clearFallback()
    previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    store = {}
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (name: string) => (name in store ? store[name] : null),
        setItem: (name: string, value: string) => {
          store[name] = value
        },
      },
    })
  })

  afterEach(() => {
    EntriesPreferences.clearFallback()
    if (previousDescriptor) Object.defineProperty(globalThis, 'localStorage', previousDescriptor)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  test('persists cols and pageSize independently per (server, scope, collection)', () => {
    EntriesPreferences.writeCols(key, ['status', 'author'])
    EntriesPreferences.writePageSize(key, 25)
    EntriesPreferences.writePageSize(otherKey, 100)

    expect(EntriesPreferences.read(key)).toEqual({ cols: ['status', 'author'], pageSize: 25 })
    expect(EntriesPreferences.read(otherKey)).toEqual({ cols: null, pageSize: 100 })
  })

  test('falls back to in-memory preferences when localStorage methods or getter throw', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
    })

    EntriesPreferences.writeCols(key, ['status'])
    EntriesPreferences.writePageSize(key, 25)
    expect(EntriesPreferences.read(key)).toEqual({ cols: ['status'], pageSize: 25 })

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError on getter')
      },
    })

    EntriesPreferences.writePageSize(otherKey, 100)
    expect(EntriesPreferences.read(otherKey)).toEqual({ cols: null, pageSize: 100 })
  })

  test('falls back cleanly on invalid stored values and cleans up defaults', () => {
    localStorage.setItem(
      'silo_entries_preferences',
      JSON.stringify({ [key]: { cols: ['', 123, ' status ', 'status'], pageSize: 999 } }),
    )
    expect(EntriesPreferences.read(key)).toEqual({
      cols: ['status'],
      pageSize: EntriesPreferences.DefaultPageSize,
    })

    EntriesPreferences.writeCols(key, null)
    EntriesPreferences.writePageSize(key, EntriesPreferences.DefaultPageSize)
    expect(JSON.parse(localStorage.getItem('silo_entries_preferences') || '{}')[key]).toBeUndefined()
  })

  test('survives corrupt JSON in localStorage', () => {
    localStorage.setItem('silo_entries_preferences', '{broken')
    expect(EntriesPreferences.read(key)).toEqual({
      cols: null,
      pageSize: EntriesPreferences.DefaultPageSize,
    })
  })
})

describe('EntriesPreferences.clampPage', () => {
  test('clamps page when offset >= total and page > 1', () => {
    expect(EntriesPreferences.clampPage(1, 50, 0)).toBe(1)
    expect(EntriesPreferences.clampPage(2, 50, 50)).toBe(1)
    expect(EntriesPreferences.clampPage(3, 50, 100)).toBe(2)
    expect(EntriesPreferences.clampPage(3, 50, 101)).toBe(3)
    expect(EntriesPreferences.clampPage(4, 25, 0)).toBe(1)
  })
})
