import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ScopeMemory } from './scope-memory'

/**
 * `pick` exists because a remembered scope can name something the server no
 * longer has, and the first version of this hook trusted it: deleting the
 * environment you were last in left the settings switcher displaying it and
 * linking to pages that 404.
 */
describe('ScopeMemory.pick', () => {
  test('keeps a remembered id that still exists', () => {
    expect(ScopeMemory.pick('staging', ['prod', 'staging'], false)).toBe('staging')
  })

  test('falls back to the first available when the remembered id is gone', () => {
    expect(ScopeMemory.pick('dev', ['prod', 'staging'], false)).toBe('prod')
  })

  test('defers the check while the list is still loading', () => {
    // An empty list mid-load says nothing about the id, so rejecting it here
    // would flip the switcher to a different scope and back again.
    expect(ScopeMemory.pick('staging', [], true)).toBe('staging')
  })

  test('falls back to null when nothing is available', () => {
    expect(ScopeMemory.pick('staging', [], false)).toBeNull()
    expect(ScopeMemory.pick(null, [], false)).toBeNull()
    expect(ScopeMemory.pick(undefined, [], true)).toBeNull()
  })

  test('with nothing remembered, takes the first available', () => {
    expect(ScopeMemory.pick(null, ['prod'], false)).toBe('prod')
    expect(ScopeMemory.pick(undefined, ['prod'], true)).toBe('prod')
  })
})

describe('ScopeMemory storage', () => {
  // Bun's test runtime has no DOM; the class only needs get/set/removeItem.
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    }
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  test('remembers a scope per server', () => {
    ScopeMemory.set('s1', { project: 'acme', env: 'prod' })
    ScopeMemory.set('s2', { project: 'other', env: 'dev' })
    expect(ScopeMemory.get('s1')).toEqual({ project: 'acme', env: 'prod' })
    expect(ScopeMemory.get('s2')).toEqual({ project: 'other', env: 'dev' })
    expect(ScopeMemory.get('s3')).toBeNull()
  })

  test('forgetting one server leaves the others', () => {
    ScopeMemory.set('s1', { project: 'acme', env: 'prod' })
    ScopeMemory.set('s2', { project: 'other', env: 'dev' })
    ScopeMemory.forget('s1')
    expect(ScopeMemory.get('s1')).toBeNull()
    expect(ScopeMemory.get('s2')).toEqual({ project: 'other', env: 'dev' })
  })

  test('a corrupt or hand-edited value cannot break navigation', () => {
    store['silo_active_scope'] = 'not json'
    expect(ScopeMemory.get('s1')).toBeNull()
    store['silo_active_scope'] = '["an","array"]'
    expect(ScopeMemory.get('s1')).toBeNull()
    store['silo_active_scope'] = '{"s1":{"project":"acme"}}'
    expect(ScopeMemory.get('s1')).toBeNull()

    // And a write still recovers from it.
    ScopeMemory.set('s1', { project: 'acme', env: 'prod' })
    expect(ScopeMemory.get('s1')).toEqual({ project: 'acme', env: 'prod' })
  })
})
