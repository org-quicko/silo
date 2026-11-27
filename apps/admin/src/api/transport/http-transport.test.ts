import { afterEach, describe, expect, test } from 'bun:test'
import { PluginsApi } from '../clients/plugins-api'
import { HttpTransport } from './http-transport'

const originalFetch = globalThis.fetch

function setFetch(stub: typeof fetch): void {
  globalThis.fetch = stub
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('HttpTransport authEpoch session gating', () => {
  test('invokes unauthorizedHandler on 401 when session has not changed across all transport entry points', async () => {
    const transport = new HttpTransport()
    let disconnects = 0
    const disconnect = () => {
      disconnects += 1
    }
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-1')

    setFetch(
      (async () =>
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Denied' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    )

    await transport.silo('https://silo.local', 'key-1').health().catch(() => undefined)
    expect(disconnects).toBe(1)

    await expect(transport.request('https://silo.local', 'key-1', '/api/test')).rejects.toThrow('Denied')
    expect(disconnects).toBe(2)

    await expect(
      transport.streamed('https://silo.local', 'key-1', '/api/stream', { method: 'POST' }, () => {}),
    ).rejects.toThrow('Denied')
    expect(disconnects).toBe(3)

    await expect(
      transport.requestHeaders('https://silo.local', 'key-1', '/api/headers', { method: 'DELETE' }),
    ).rejects.toThrow('Denied')
    expect(disconnects).toBe(4)
  })

  test('ignores late 401 responses from an earlier API key even when the disconnect callback identity stays the same', async () => {
    const transport = new HttpTransport()
    let disconnects = 0
    const disconnect = () => {
      disconnects += 1
    }
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-1')

    const resolvers: Array<(response: Response) => void> = []
    setFetch(
      (() =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        })) as unknown as typeof fetch,
    )

    const oldSiloCall = transport.silo('https://silo.local', 'key-1').health()
    const oldRequestCall = transport.request('https://silo.local', 'key-1', '/api/entries')
    const oldStreamCall = transport.streamed(
      'https://silo.local',
      'key-1',
      '/api/import',
      { method: 'POST' },
      () => {},
    )
    const oldHeadersCall = transport.requestHeaders(
      'https://silo.local',
      'key-1',
      '/api/entries/1',
      { method: 'DELETE' },
    )

    // Switch to a different API key on the same server using the same stable `disconnect` fn.
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-2')

    const unauthorized = () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Old key rejected' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

    const settled = Promise.allSettled([
      oldSiloCall,
      oldRequestCall,
      oldStreamCall,
      oldHeadersCall,
    ])

    for (const resolve of resolvers) resolve(unauthorized())

    const outcomes = await settled
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true)
    expect(disconnects).toBe(0)

    // Requests started under key-2 still trigger disconnect on 401.
    const newCall = transport.request('https://silo.local', 'key-2', '/api/entries')
    resolvers[resolvers.length - 1]?.(unauthorized())
    await expect(newCall).rejects.toThrow('Old key rejected')
    expect(disconnects).toBe(1)
  })

  test('ignores late 401 after handler is cleared mid-flight even if re-installed before settlement', async () => {
    const transport = new HttpTransport()
    let disconnects = 0
    const disconnect = () => {
      disconnects += 1
    }
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-1')

    let resolveFetch!: (response: Response) => void
    setFetch(
      (() =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })) as unknown as typeof fetch,
    )

    const inFlight = transport.request('https://silo.local', 'key-1', '/api/entries')
    transport.setUnauthorizedHandler(null, null)
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-1')

    resolveFetch(
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Stale' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(inFlight).rejects.toThrow('Stale')
    expect(disconnects).toBe(0)
  })

  test('PluginsApi.installArchive captures authEpoch before fetchRaw FormData upload', async () => {
    const transport = new HttpTransport()
    const pluginsApi = new PluginsApi(transport)
    let disconnects = 0
    const disconnect = () => {
      disconnects += 1
    }
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-1')

    let resolveUpload!: (response: Response) => void
    setFetch(
      (() =>
        new Promise<Response>((resolve) => {
          resolveUpload = resolve
        })) as unknown as typeof fetch,
    )

    const archive = new File(['zip-bytes'], 'plugin.zip', { type: 'application/zip' })
    const oldUpload = pluginsApi.installArchive('https://silo.local', 'key-1', archive)

    // Switch keys while the FormData installArchive upload is still in flight.
    transport.setUnauthorizedHandler(disconnect, 'srv-1:key-2')

    resolveUpload(
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Expired key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(oldUpload).rejects.toThrow('Expired key')
    expect(disconnects).toBe(0)

    // A 401 from an upload started under key-2 still disconnects the active session.
    setFetch(
      (async () =>
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Denied' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    )
    await expect(pluginsApi.installArchive('https://silo.local', 'key-2', archive)).rejects.toThrow(
      'Denied',
    )
    expect(disconnects).toBe(1)
  })
})
