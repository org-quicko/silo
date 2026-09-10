import { describe, expect, test } from 'bun:test'
import { Variable } from '../../api/types/variable'
import { VariableHints } from './variable-hints'

function variable(name: string, value: string | null): Variable {
  return Variable.fromWire({
    name,
    description: '',
    value,
    set_in: value === null ? 0 : 1,
    created_at: '2026-09-07T00:00:00.000Z',
    updated_at: '2026-09-07T00:00:00.000Z',
  })
}

const declared = [variable('API_URL', 'https://prod.example.com'), variable('DRAFT', null)]

describe('VariableHints.of', () => {
  test('separates resolved, unset and undeclared', () => {
    expect(VariableHints.of('{{API_URL}} {{DRAFT}} {{TYPO}}', declared)).toEqual([
      { name: 'API_URL', state: 'resolved', value: 'https://prod.example.com' },
      { name: 'DRAFT', state: 'unset', value: null },
      { name: 'TYPO', state: 'undeclared', value: null },
    ])
  })

  test('an empty value is resolved, not unset', () => {
    expect(VariableHints.of('{{BLANK}}', [variable('BLANK', '')])).toEqual([
      { name: 'BLANK', state: 'resolved', value: '' },
    ])
  })

  test('a repeated reference is one hint', () => {
    expect(VariableHints.of('{{API_URL}}/a and {{API_URL}}/b', declared)).toHaveLength(1)
  })

  test('a field with no reference, or no string at all, has nothing to say', () => {
    expect(VariableHints.of('plain text', declared)).toEqual([])
    expect(VariableHints.of(42, declared)).toEqual([])
    expect(VariableHints.of(undefined, declared)).toEqual([])
  })
})

describe('VariableHints.draftAt', () => {
  test('finds a name being typed', () => {
    expect(VariableHints.draftAt('call {{API', 10)).toEqual({ prefix: 'API', start: 5, end: 10 })
  })

  test('an empty draft right after the braces still offers the list', () => {
    expect(VariableHints.draftAt('{{', 2)).toEqual({ prefix: '', start: 0, end: 2 })
  })

  test('offers nothing after a closed reference', () => {
    expect(VariableHints.draftAt('{{API_URL}}', 11)).toBeNull()
  })

  test('offers nothing for a single brace or for plain text', () => {
    expect(VariableHints.draftAt('{API', 4)).toBeNull()
    expect(VariableHints.draftAt('API', 3)).toBeNull()
  })

  test('a space between the braces and the caret ends it', () => {
    expect(VariableHints.draftAt('{{ API', 6)).toBeNull()
  })

  test('the caret inside one reference is not confused by an earlier one', () => {
    const text = '{{API_URL}} then {{DR'
    expect(VariableHints.draftAt(text, text.length)).toEqual({
      prefix: 'DR',
      start: 17,
      end: 21,
    })
  })
})

describe('VariableHints.suggestions', () => {
  const many = [
    variable('API_URL', 'a'),
    variable('APP_NAME', 'b'),
    variable('CDN_URL', 'c'),
  ]

  test('prefix matches come before contains matches', () => {
    const draft = { prefix: 'ap', start: 0, end: 4 }
    expect(VariableHints.suggestions(draft, many).map((v) => v.name)).toEqual([
      'API_URL',
      'APP_NAME',
    ])
  })

  test('a substring still finds a name it is not a prefix of', () => {
    const draft = { prefix: 'url', start: 0, end: 5 }
    expect(VariableHints.suggestions(draft, many).map((v) => v.name)).toEqual([
      'API_URL',
      'CDN_URL',
    ])
  })

  test('an empty prefix offers everything, up to the limit', () => {
    const draft = { prefix: '', start: 0, end: 2 }
    expect(VariableHints.suggestions(draft, many, 2)).toHaveLength(2)
  })
})

describe('VariableHints.complete', () => {
  test('closes the reference and puts the caret after it', () => {
    const text = 'call {{API'
    const draft = VariableHints.draftAt(text, text.length)!
    expect(VariableHints.complete(text, draft, 'API_URL')).toEqual({
      text: 'call {{API_URL}}',
      caret: 16,
    })
  })

  test('does not double the closing braces when they are already there', () => {
    const text = 'call {{API}} tomorrow'
    const draft = VariableHints.draftAt(text, 10)!
    expect(VariableHints.complete(text, draft, 'API_URL')).toEqual({
      text: 'call {{API_URL}} tomorrow',
      caret: 16,
    })
  })

  test('keeps whatever followed the draft', () => {
    const text = '{{API and more'
    const draft = VariableHints.draftAt(text, 5)!
    expect(VariableHints.complete(text, draft, 'API_URL').text).toBe('{{API_URL}} and more')
  })
})
