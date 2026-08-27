import { describe, test, expect } from 'bun:test'
import {
  PANEL_PROTOCOL,
  isRefusal,
  panelPrefix,
  readPanelMessage,
  readPanelPath,
} from './plugin-panel-protocol'

const plugin = 'silo-plugin-strapi-import'

const message = (over: Record<string, unknown> = {}) => ({
  silo: PANEL_PROTOCOL,
  kind: 'fetch',
  id: 'p1',
  method: 'GET',
  path: `/api/ext/${plugin}/source`,
  ...over,
})

/**
 * The panel boundary (D41).
 *
 * This is the whole security property of a plugin panel, which is why it is a
 * pure function with its own test rather than a check inside a React effect. A
 * panel runs in a sandboxed iframe with no origin, so the only thing it can do is
 * ask the admin to make a request — and the admin makes it with the **operator's**
 * key. What stops that being a way to spend the operator's full claim set
 * anywhere is `readPanelMessage`, and nothing else.
 */
describe('what a panel may ask the admin to do', () => {
  test('a request to its own plugin is relayed', () => {
    const read = readPanelMessage(message(), plugin)
    expect(isRefusal(read)).toBe(false)
    expect(read).toMatchObject({ kind: 'fetch', id: 'p1', method: 'GET' })
  })

  test('the plugin root, with no trailing slash, is inside its own namespace', () => {
    expect(readPanelPath(`/api/ext/${plugin}`, plugin)).toBe(`/api/ext/${plugin}`)
  })

  test('a query survives, because that is where a route reads its parameters', () => {
    expect(readPanelPath(`/api/ext/${plugin}/source?name=data.db`, plugin)).toBe(
      `/api/ext/${plugin}/source?name=data.db`,
    )
  })

  /**
   * Every one of these resolves outside the prefix, and the reason they are one
   * test is that they are one bug: a check against the raw string is checking a
   * different value than the one `fetch` will request. `..` is *resolved* and then
   * the result is checked, which no spelling walks around.
   */
  describe('refuses anything that leaves the namespace', () => {
    const escapes = [
      ['a sibling endpoint', '/api/keys'],
      ['another plugin', '/api/ext/other/steal'],
      ['a dot-dot climb', `/api/ext/${plugin}/../../keys`],
      ['a climb with a dot between', `/api/ext/${plugin}/./../../keys`],
      ['a percent-encoded climb', `/api/ext/${plugin}/%2e%2e/%2e%2e/keys`],
      ['an absolute URL', 'https://evil.example/api/ext/x'],
      ['a protocol-relative URL', '//evil.example/api/keys'],
      ['a name that merely starts the same', `/api/ext/${plugin}-evil/x`],
      ['a relative path', 'source'],
    ] as const

    for (const [what, path] of escapes) {
      test(what, () => {
        const read = readPanelPath(path, plugin)
        expect(isRefusal(read)).toBe(true)
      })
    }
  })

  /**
   * Normalising, not string-matching, cuts both ways — and this is the direction
   * that proves it.
   *
   * `//..` pops the empty segment and lands back in the plugin's own namespace,
   * so it is a legal path that a naive "contains `..`" rejection would have
   * refused. What decides is where the path resolves, which is the only question
   * the eventual `fetch` asks either.
   */
  test('a climb that resolves back inside is allowed, normalised', () => {
    expect(readPanelPath(`/api/ext/${plugin}//../source`, plugin)).toBe(
      `/api/ext/${plugin}/source`,
    )
  })

  /**
   * The header allowlist protects one value: the operator's `Authorization`,
   * which the transport sets. A denylist would have to name every spelling a
   * panel might reach for, and be wrong the first time one is added.
   */
  test('drops every header outside the allowlist', () => {
    const read = readPanelMessage(
      message({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer stolen',
          'X-Api-Key': 'stolen',
          Cookie: 'a=b',
          'x-forwarded-for': '1.2.3.4',
        },
      }),
      plugin,
    )
    expect(isRefusal(read)).toBe(false)
    // Lowercased, so a handler looks one up without knowing how it was written.
    expect((read as any).headers).toEqual({ 'content-type': 'application/json' })
  })

  test('bytes and text both travel; anything else is refused', () => {
    const bytes = readPanelMessage(message({ method: 'POST', body: new Uint8Array([1, 2]) }), plugin)
    expect((bytes as any).body).toBeInstanceOf(Uint8Array)

    const buffer = readPanelMessage(
      message({ method: 'POST', body: new Uint8Array([1, 2]).buffer }),
      plugin,
    )
    expect((buffer as any).body).toBeInstanceOf(Uint8Array)

    expect((readPanelMessage(message({ method: 'POST', body: 'x' }), plugin) as any).body).toBe('x')
    expect((readPanelMessage(message(), plugin) as any).body).toBeNull()
    expect(isRefusal(readPanelMessage(message({ method: 'POST', body: { a: 1 } }), plugin))).toBe(
      true,
    )
  })

  test('refuses an unversioned message, an unknown kind, and a method nothing serves', () => {
    expect(isRefusal(readPanelMessage({ kind: 'fetch' }, plugin))).toBe(true)
    expect(isRefusal(readPanelMessage(message({ kind: 'eval' }), plugin))).toBe(true)
    expect(isRefusal(readPanelMessage(message({ method: 'TRACE' }), plugin))).toBe(true)
    expect(isRefusal(readPanelMessage(message({ id: '' }), plugin))).toBe(true)
    expect(isRefusal(readPanelMessage('a string', plugin))).toBe(true)
  })

  test('a height request is a number and nothing else', () => {
    expect(readPanelMessage({ silo: PANEL_PROTOCOL, kind: 'height', height: 420 }, plugin)).toEqual({
      kind: 'height',
      height: 420,
    })
    for (const height of [-1, Number.NaN, Number.POSITIVE_INFINITY, '400', undefined]) {
      expect(
        isRefusal(readPanelMessage({ silo: PANEL_PROTOCOL, kind: 'height', height }, plugin)),
      ).toBe(true)
    }
  })

  /** A scoped package name carries a `/`, so the prefix has to be built from an
   *  encoded segment or the containment check compares the wrong depth. */
  test('a scoped plugin name is one encoded segment', () => {
    const scoped = '@acme/silo-plugin-x'
    expect(panelPrefix(scoped)).toBe('/api/ext/%40acme%2Fsilo-plugin-x/')
    expect(readPanelPath(`/api/ext/%40acme%2Fsilo-plugin-x/go`, scoped)).toBe(
      '/api/ext/%40acme%2Fsilo-plugin-x/go',
    )
    expect(isRefusal(readPanelPath('/api/ext/@acme/silo-plugin-x/go', scoped))).toBe(true)
  })
})
