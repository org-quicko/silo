import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SERVERS_STORAGE_KEY, ServerStorage } from './server'

describe('ServerStorage', () => {
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

  test('writes and reads valid server entries', () => {
    const servers = [
      { id: 's1', name: 'Prod', url: 'https://prod.example', apiKey: 'silo_123' },
    ]
    ServerStorage.write(servers)
    expect(ServerStorage.read()).toEqual(servers)
  })

  test('tolerates corrupt JSON, non-arrays, and malformed entries', () => {
    store[SERVERS_STORAGE_KEY] = '{not valid json'
    expect(ServerStorage.read()).toEqual([])

    store[SERVERS_STORAGE_KEY] = JSON.stringify({ id: 's1' })
    expect(ServerStorage.read()).toEqual([])

    store[SERVERS_STORAGE_KEY] = JSON.stringify([
      null,
      { id: '', name: 'Blank', url: 'http://x', apiKey: 'k' },
      { id: 's1', name: 'Valid', url: 'http://ok', apiKey: 'k' },
      { id: 's2', name: 123, url: 'http://bad', apiKey: 'k' },
    ])
    expect(ServerStorage.read()).toEqual([
      { id: 's1', name: 'Valid', url: 'http://ok', apiKey: 'k' },
    ])
  })
})
