import { describe, expect, test } from 'bun:test'
import { ScopeMatcher } from './scope-match'

const collections = [
  { name: 'orders', count: 12, schema: { properties: { customer_id: {}, total: {} } } },
  { name: 'customers', count: 4, schema: { properties: { name: {} } } },
  { name: 'posts', count: 30, schema: { properties: { title: {} } } },
]

describe('ScopeMatcher.rank', () => {
  test('an empty query lists everything', () => {
    expect(ScopeMatcher.rank('', collections, []).map((m) => m.name)).toEqual(['customers', 'orders', 'posts'])
  })

  test('name matches come before field matches', () => {
    const ranked = ScopeMatcher.rank('cust', collections, [])
    expect(ranked).toEqual([
      { name: 'customers', count: 4, matchedField: null },
      { name: 'orders', count: 12, matchedField: 'customer_id' },
    ])
  })

  test('no match at all is an empty list, not a fallback to everything', () => {
    expect(ScopeMatcher.rank('zzz', collections, [])).toEqual([])
  })

  test('recency of visit outranks alphabetical order within a group', () => {
    const ranked = ScopeMatcher.rank('', collections, ['posts'])
    expect(ranked.map((m) => m.name)).toEqual(['posts', 'customers', 'orders'])
  })
})
