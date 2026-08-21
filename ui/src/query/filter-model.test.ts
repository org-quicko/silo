import { describe, expect, test } from 'bun:test'
import { FilterModel, type FilterDraft } from './filter-model'

/**
 * The builder writes its state into the URL as a Query AST and reads it back
 * out, so a filtered view is linkable. Both directions are pinned here: a
 * round trip that loses a condition produces a link that looks right and
 * filters differently, which is the failure nobody reports.
 */
const draft = (rows: FilterDraft['rows'], join: 'and' | 'or' = 'and'): FilterDraft => ({ join, rows })

describe('FilterModel.toFilter', () => {
  test('one condition is the leaf itself, with no wrapping group', () => {
    expect(FilterModel.toFilter(draft([{ path: '$.data.title', op: 'eq', value: 'hi', type: 'string' }]))).toEqual({
      op: 'eq',
      path: '$.data.title',
      value: 'hi',
    })
  })

  test('several conditions take the chosen join', () => {
    const f = FilterModel.toFilter(
      draft(
        [
          { path: '$.data.title', op: 'contains', value: 'a', type: 'string' },
          { path: '$.data.views', op: 'gt', value: '10', type: 'number' },
        ],
        'or',
      ),
    )
    expect(f).toEqual({
      op: 'or',
      args: [
        { op: 'contains', path: '$.data.title', value: 'a' },
        { op: 'gt', path: '$.data.views', value: 10 },
      ],
    })
  })

  test('an unfinished row is not an empty filter — it is left out', () => {
    expect(
      FilterModel.toFilter(
        draft([
          { path: '$.data.title', op: 'eq', value: '', type: 'string' },
          { path: '$.data.slug', op: 'eq', value: 'x', type: 'string' },
        ]),
      ),
    ).toEqual({ op: 'eq', path: '$.data.slug', value: 'x' })
  })

  test('nothing complete means no filter at all, not an empty group', () => {
    expect(FilterModel.toFilter(FilterModel.Empty)).toBeNull()
    expect(FilterModel.toFilter(draft([{ path: '$.data.a', op: 'eq', value: '  ', type: 'string' }]))).toBeNull()
  })

  test('`exists` needs no value, and never carries one', () => {
    expect(FilterModel.toFilter(draft([{ path: '$.data.cover', op: 'exists', value: '', type: 'string' }]))).toEqual({
      op: 'exists',
      path: '$.data.cover',
    })
  })

  test('`in` splits on commas; every other op keeps the comma', () => {
    expect(FilterModel.toFilter(draft([{ path: '$.data.tags[*]', op: 'in', value: 'go, db', type: 'string' }]))).toEqual({
      op: 'in',
      path: '$.data.tags[*]',
      value: ['go', 'db'],
    })
    expect(FilterModel.toFilter(draft([{ path: '$.data.title', op: 'eq', value: 'go, db', type: 'string' }]))).toEqual({
      op: 'eq',
      path: '$.data.title',
      value: 'go, db',
    })
  })

  test('a number row that is not a number is unfinished, not NaN', () => {
    expect(FilterModel.toFilter(draft([{ path: '$.data.views', op: 'gt', value: 'many', type: 'number' }]))).toBeNull()
  })

  test('a path the parser refuses never reaches the API', () => {
    // Recursive descent is outside the D29 subset; the server would 400.
    expect(FilterModel.toFilter(draft([{ path: '$..title', op: 'eq', value: 'x', type: 'string' }]))).toBeNull()
  })
})

describe('FilterModel.fromFilter', () => {
  test('round-trips a single condition', () => {
    const before = draft([{ path: '$.data.views', op: 'gte', value: '5', type: 'number' }])
    expect(FilterModel.fromFilter(FilterModel.toFilter(before))).toEqual(before)
  })

  test('round-trips a group, join included', () => {
    const before = draft(
      [
        { path: '$.data.title', op: 'contains', value: 'x', type: 'string' },
        { path: '$.data.draft', op: 'eq', value: 'true', type: 'boolean' },
      ],
      'or',
    )
    expect(FilterModel.fromFilter(FilterModel.toFilter(before))).toEqual(before)
  })

  test('no filter is an empty builder, not an unreadable one', () => {
    expect(FilterModel.fromFilter(null)).toEqual(FilterModel.Empty)
  })

  test.each([
    ['not', { op: 'not', args: [{ op: 'eq', path: '$.data.a', value: 1 }] }],
    ['a nested group', { op: 'and', args: [{ op: 'or', args: [{ op: 'eq', path: '$.data.a', value: 1 }] }] }],
    ['an unknown op', { op: 'matches', path: '$.data.a', value: 'x' }],
    ['a null value', { op: 'eq', path: '$.data.a', value: null }],
    ['a mixed list', { op: 'in', path: '$.data.a', value: ['x', 2] }],
  ])('refuses to draw %s, rather than dropping half of it', (_name, filter) => {
    expect(FilterModel.fromFilter(filter as any)).toBeNull()
  })
})
