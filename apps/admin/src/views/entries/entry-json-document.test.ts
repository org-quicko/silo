import { describe, expect, test } from 'bun:test'
import { EntryJsonDocument } from './entry-json-document'

describe('EntryJsonDocument.format', () => {
  test('returns {} for empty or missing input', () => {
    expect(EntryJsonDocument.format(undefined)).toBe('{}')
    expect(EntryJsonDocument.format(null)).toBe('{}')
    expect(EntryJsonDocument.format({})).toBe('{}')
  })

  test('formats user fields while omitting top-level reserved fields', () => {
    const formatted = EntryJsonDocument.format({
      id: '01ABC',
      rev: 3,
      seq: 7,
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
      title: 'Hello',
      subtitle: null,
      endpoint: '{{API_URL}}/posts',
      author: { id: 'nested-author-id', name: 'Ada' },
    })

    expect(formatted).toBe(
      JSON.stringify(
        {
          title: 'Hello',
          subtitle: null,
          endpoint: '{{API_URL}}/posts',
          author: { id: 'nested-author-id', name: 'Ada' },
        },
        null,
        2,
      ),
    )
  })

  test('preserves an own __proto__ property while filtering reserved fields', () => {
    const input = JSON.parse('{"title":"Hi","__proto__":{"role":"admin"},"id":"01ABC"}')
    expect(EntryJsonDocument.format(input)).toBe(
      '{\n  "title": "Hi",\n  "__proto__": {\n    "role": "admin"\n  }\n}',
    )
  })
})

describe('EntryJsonDocument.parse', () => {
  test('parses valid plain JSON objects and preserves {{NAME}} templates and explicit nulls', () => {
    const result = EntryJsonDocument.parse(
      JSON.stringify({
        title: 'Launch',
        summary: null,
        url: '{{SITE_URL}}/launch',
        author: { id: 'nested-id-is-allowed' },
      }),
    )

    expect(result).toEqual({
      ok: true,
      data: {
        title: 'Launch',
        summary: null,
        url: '{{SITE_URL}}/launch',
        author: { id: 'nested-id-is-allowed' },
      },
    })
  })

  test('accepts an empty JSON object', () => {
    expect(EntryJsonDocument.parse('  {}  ')).toEqual({ ok: true, data: {} })
  })

  test('rejects empty text and invalid JSON syntax', () => {
    const empty = EntryJsonDocument.parse('   ')
    expect(empty.ok).toBe(false)

    const syntax = EntryJsonDocument.parse('{ "title": ')
    expect(syntax.ok).toBe(false)
    if (!syntax.ok) expect(syntax.error.length).toBeGreaterThan(0)
  })

  test('rejects arrays, null, and JSON primitives', () => {
    for (const sample of ['[]', '["a"]', 'null', '42', '"hello"', 'true']) {
      const result = EntryJsonDocument.parse(sample)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('plain JSON object')
    }
  })

  test('refuses reserved top-level field names', () => {
    for (const reservedName of ['id', 'rev', 'seq', 'created_at', 'updated_at']) {
      const result = EntryJsonDocument.parse(JSON.stringify({ title: 'Ok', [reservedName]: 'bad' }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain(reservedName)
    }
  })
})

describe('EntryJsonDocument.prettyPrint', () => {
  test('pretty-prints valid entry JSON objects', () => {
    const result = EntryJsonDocument.prettyPrint('{"title":"One","note":null,"host":"{{HOST}}"}')
    expect(result).toEqual({
      ok: true,
      text: '{\n  "title": "One",\n  "note": null,\n  "host": "{{HOST}}"\n}',
    })
  })

  test('returns validation errors for non-objects or reserved fields', () => {
    const arrayResult = EntryJsonDocument.prettyPrint('[1, 2]')
    expect(arrayResult.ok).toBe(false)

    const reservedResult = EntryJsonDocument.prettyPrint('{"id":"01ABC","title":"Nope"}')
    expect(reservedResult.ok).toBe(false)
    if (!reservedResult.ok) expect(reservedResult.error).toContain('id')
  })
})
