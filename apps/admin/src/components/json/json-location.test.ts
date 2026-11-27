import { describe, expect, test } from 'bun:test'
import { JsonLocation } from './json-location'

describe('JsonLocation', () => {
  test('indexes RFC 6901 pointers with escaped ~, /, empty keys, and array indices', () => {
    const text = '{\n  "": 1,\n  "a/b": "slash",\n  "c~d": [true, { "0": "zero" }]\n}'
    const loc = JsonLocation.index(text)

    expect(loc.spanOf('')).toEqual({
      keyFrom: undefined,
      keyTo: undefined,
      valueFrom: 0,
      valueTo: text.length,
    })

    const emptyDiag = loc.diagnosticForKey('/', 'Empty key error')
    expect(text.slice(emptyDiag.from, emptyDiag.to)).toBe('""')
    expect(emptyDiag.line).toBe(2)

    const slashDiag = loc.diagnosticForKey('/a~1b', 'Slash key error')
    expect(text.slice(slashDiag.from, slashDiag.to)).toBe('"a/b"')

    const tildeValue = loc.diagnosticForValue('/c~0d/1/0', 'Nested zero')
    expect(text.slice(tildeValue.from, tildeValue.to)).toBe('"zero"')
  })

  test('decodes unicode-escaped keys and distinguishes nested vs top-level reserved keys', () => {
    const text = '{\n  "author": { "id": "nested" },\n  "\\u0069d": "reserved"\n}'
    const loc = JsonLocation.index(text)

    const nested = loc.diagnosticForKey('/author/id', 'Nested id')
    expect(nested.line).toBe(2)
    expect(text.slice(nested.from, nested.to)).toBe('"id"')

    const top = loc.diagnosticForKey('/id', 'Top reserved id')
    expect(top.line).toBe(3)
    expect(text.slice(top.from, top.to)).toBe('"\\u0069d"')
  })

  test('picks the last occurrence for duplicate keys (matching JSON.parse)', () => {
    const text = '{\n  "title": "first",\n  "title": 42\n}'
    const loc = JsonLocation.index(text)
    const diag = loc.diagnosticForValue('/title', 'Must be string')

    expect(diag.line).toBe(3)
    expect(text.slice(diag.from, diag.to)).toBe('42')
  })

  test('handles CRLF, emoji before error, compact lines, and short object anchors', () => {
    const text = '{"emoji":"🚀","bad":123,"other":true}\r\n{"nested":{}}'
    const compact = '{"emoji":"🚀","bad":123,"other":true}'
    const loc = JsonLocation.index(compact)

    const badDiag = loc.diagnosticForValue('/bad', 'Invalid number')
    expect(compact.slice(badDiag.from, badDiag.to)).toBe('123')
    expect(badDiag.line).toBe(1)

    const anchor = loc.diagnosticForObjectAnchor('', 'Missing required "title"')
    expect(compact.slice(anchor.from, anchor.to)).toBe('}')
    expect(anchor.to - anchor.from).toBe(1)

    const crlf = '{\r\n  "emoji": "🚀",\r\n  "bad": 123\r\n}'
    const crlfLoc = JsonLocation.index(crlf)
    const crlfDiag = crlfLoc.diagnosticForValue('/bad', 'Bad')
    expect(crlfDiag.line).toBe(3)
    expect(crlfDiag.column).toBe(10)
    expect(crlf.slice(crlfDiag.from, crlfDiag.to)).toBe('123')
    expect(text.length).toBeGreaterThan(0)
  })
})
