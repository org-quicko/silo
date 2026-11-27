import { describe, expect, test } from 'bun:test'
import { Columns } from './columns'

const schema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    status: { type: 'string' },
    author: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    body: { type: 'object', properties: {} },
    c1: { type: 'string' },
    c2: { type: 'string' },
    c3: { type: 'string' },
    c4: { type: 'string' },
  },
}

describe('Columns.parseStored', () => {
  test('validates, deduplicates, excludes primary/sub, and caps stored columns', () => {
    expect(
      Columns.parseStored(['title', 'author', 'author', 'missing', 'status', 'tags', 'c1', 'c2', 'c3', 'c4'], schema, [
        'title',
      ]),
    ).toEqual(['author', 'status', 'tags', 'c1', 'c2', 'c3'])
  })

  test('returns null when stored list is empty or contains no valid eligible fields', () => {
    expect(Columns.parseStored(null, schema, ['title'])).toBeNull()
    expect(Columns.parseStored(['title', 'nonexistent'], schema, ['title'])).toBeNull()
  })
})
