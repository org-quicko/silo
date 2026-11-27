import { describe, expect, test } from 'bun:test'
import { JsonSyntax } from './json-syntax'

describe('JsonSyntax', () => {
  test('diagnose returns null for valid JSON and honors allowEmpty', () => {
    expect(JsonSyntax.diagnose('{"title":"hello","count":3}')).toBeNull()
    expect(JsonSyntax.diagnose('   ')).toEqual({
      message: 'JSON cannot be empty.',
      from: 0,
      to: 0,
      line: 1,
      column: 1,
    })
    expect(JsonSyntax.diagnose('   ', { allowEmpty: true })).toBeNull()
  })

  test('diagnose computes line, column, and clamped span for syntax errors', () => {
    const text = '{\n  "a": 1,\n  "b": [1, 2, ]\n}'
    const diagnostic = JsonSyntax.diagnose(text)
    expect(diagnostic).not.toBeNull()
    expect(diagnostic!.line).toBeGreaterThanOrEqual(1)
    expect(diagnostic!.column).toBeGreaterThanOrEqual(1)
    expect(diagnostic!.from).toBeGreaterThanOrEqual(0)
    expect(diagnostic!.to).toBeGreaterThan(diagnostic!.from)
    expect(diagnostic!.to).toBeLessThanOrEqual(text.length)

    const eofText = '{"a": 1'
    const eofDiag = JsonSyntax.diagnose(eofText)
    expect(eofDiag).not.toBeNull()
    expect(eofDiag!.from).toBeGreaterThanOrEqual(0)
    expect(eofDiag!.to).toBeLessThanOrEqual(eofText.length)
  })

  test('diagnoseKey locates the quoted property key before its colon and falls back when absent', () => {
    const text = '{\n  "title": "ok",\n  "id": "123"\n}'
    const hit = JsonSyntax.diagnoseKey(text, 'id', 'Reserved field "id"')
    expect(hit.line).toBe(3)
    expect(hit.column).toBe(3)
    expect(text.slice(hit.from, hit.to)).toBe('"id"')
    expect(hit.message).toBe('Reserved field "id"')

    const fallback = JsonSyntax.diagnoseKey(text, 'missing', 'Not found')
    expect(fallback).toEqual({ message: 'Not found', from: 0, to: 1, line: 1, column: 1 })
  })

  test('positionToLineColumn and lineColumnToOffset round-trip across lines', () => {
    const text = 'alpha\nbeta\ngamma'
    expect(JsonSyntax.positionToLineColumn(text, 0)).toEqual({ line: 1, column: 1 })
    expect(JsonSyntax.positionToLineColumn(text, 6)).toEqual({ line: 2, column: 1 })
    expect(JsonSyntax.positionToLineColumn(text, 8)).toEqual({ line: 2, column: 3 })
    expect(JsonSyntax.lineColumnToOffset(text, 2, 3)).toBe(8)
    expect(JsonSyntax.lineColumnToOffset(text, 3, 99)).toBe(text.length)
  })

  test('format, minify, and sortKeysInText transform valid JSON and report invalid JSON', () => {
    const raw = '{"z":1,"a":{"d":4,"b":[3,2,1]}}'
    expect(JsonSyntax.format(raw)).toEqual({
      ok: true,
      text: '{\n  "z": 1,\n  "a": {\n    "d": 4,\n    "b": [\n      3,\n      2,\n      1\n    ]\n  }\n}',
    })
    expect(JsonSyntax.minify('{\n  "a": 1,\n  "b": 2\n}')).toEqual({
      ok: true,
      text: '{"a":1,"b":2}',
    })
    expect(JsonSyntax.sortKeysInText(raw)).toEqual({
      ok: true,
      text: '{\n  "a": {\n    "b": [\n      3,\n      2,\n      1\n    ],\n    "d": 4\n  },\n  "z": 1\n}',
    })

    const bad = JsonSyntax.format('{bad}')
    expect(bad.ok).toBe(false)
    const badMinify = JsonSyntax.minify('{bad}')
    expect(badMinify.ok).toBe(false)
    const badSort = JsonSyntax.sortKeysInText('{bad}')
    expect(badSort.ok).toBe(false)

    const overflow = JsonSyntax.format('{"n":1e400}')
    expect(overflow.ok).toBe(false)
    const bigInt = JsonSyntax.minify('{"n":9007199254740993}')
    expect(bigInt.ok).toBe(false)
    const safeInt = JsonSyntax.sortKeysInText('{"b":9007199254740992,"a":1}')
    expect(safeInt.ok).toBe(true)
  })

  test('summarize and measure describe values and text sizes accurately', () => {
    expect(JsonSyntax.summarize(undefined)).toBe('empty')
    expect(JsonSyntax.summarize(null)).toBe('null')
    expect(JsonSyntax.summarize(true)).toBe('true')
    expect(JsonSyntax.summarize(false)).toBe('false')
    expect(JsonSyntax.summarize(42)).toBe('42')
    expect(JsonSyntax.summarize('short')).toBe('"short"')
    expect(JsonSyntax.summarize('a very long string that exceeds twenty four characters')).toBe(
      '"a very long string th…"',
    )
    expect(JsonSyntax.summarize({})).toBe('{}')
    expect(JsonSyntax.summarize({ a: 1 })).toBe('{1 key}')
    expect(JsonSyntax.summarize({ a: 1, b: 2 })).toBe('{2 keys}')
    expect(JsonSyntax.summarize([])).toBe('[]')
    expect(JsonSyntax.summarize([1])).toBe('[1 item]')
    expect(JsonSyntax.summarize([1, 2, 3])).toBe('[3 items]')

    expect(JsonSyntax.measure('')).toEqual({ lines: 0, bytes: 0 })
    expect(JsonSyntax.measure('{\n  "hi": "€"\n}')).toEqual({ lines: 3, bytes: 17 })
  })
})
