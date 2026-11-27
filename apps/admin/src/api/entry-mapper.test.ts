import { describe, expect, test } from 'bun:test'
import { EntryMapper } from './entry-mapper'

describe('EntryMapper.fromApiEntry', () => {
  test('splits the flat entry response into envelope and data', () => {
    const mapped = EntryMapper.fromApiEntry(
      {
        id: '01M24ZX2ZK60T72CNPCM222E3Z',
        rev: 4,
        title: 'Alice Blue',
        category: 'investments',
        created_at: '2026-09-10T06:25:55.699Z',
        updated_at: '2026-09-10T06:25:55.699Z',
      },
      'applications',
    )

    expect(mapped).toEqual({
      id: '01M24ZX2ZK60T72CNPCM222E3Z',
      collection: 'applications',
      rev: 4,
      seq: 0,
      created_at: '2026-09-10T06:25:55.699Z',
      updated_at: '2026-09-10T06:25:55.699Z',
      data: { title: 'Alice Blue', category: 'investments' },
    })
  })

  test('a user field named collection survives, because the response never carries one', () => {
    // It was destructured off as envelope before D62, so a field by that name
    // read fine over curl and vanished in the UI. `collection` is not reserved.
    const mapped = EntryMapper.fromApiEntry(
      {
        id: '01M2',
        rev: 1,
        collection: 'spring/summer',
        created_at: '2026-09-10T06:25:55.699Z',
        updated_at: '2026-09-10T06:25:55.699Z',
      },
      'garments',
    )

    expect(mapped.collection).toBe('garments')
    expect(mapped.data.collection).toBe('spring/summer')
  })

  test('an entry with sibling fields and an object-valued data property keeps everything intact', () => {
    const mapped = EntryMapper.fromApiEntry(
      {
        id: '01M2',
        rev: 2,
        title: 'Payload Spec',
        collection: 'docs',
        data: { nested: true, count: 3 },
        created_at: '2026-09-10T06:25:55.699Z',
        updated_at: '2026-09-10T06:25:55.699Z',
      },
      'articles',
    )

    expect(mapped.collection).toBe('articles')
    expect(mapped.data).toEqual({
      title: 'Payload Spec',
      collection: 'docs',
      data: { nested: true, count: 3 },
    })
  })

  test('an entry with sibling fields and an array-valued data property keeps everything intact', () => {
    const mapped = EntryMapper.fromApiEntry(
      {
        id: '01M3',
        rev: 3,
        title: 'Series',
        collection: 'series',
        data: ['alpha', 'beta'],
        created_at: '2026-09-10T06:25:55.699Z',
        updated_at: '2026-09-10T06:25:55.699Z',
      },
      'reports',
    )

    expect(mapped.collection).toBe('reports')
    expect(mapped.data).toEqual({
      title: 'Series',
      collection: 'series',
      data: ['alpha', 'beta'],
    })
  })
})

describe('EntryMapper.fromEnvelope', () => {
  test('passes through an explicit enveloped entry', () => {
    const mapped = EntryMapper.fromEnvelope(
      {
        id: '01M2',
        collection: 'posts',
        rev: 2,
        seq: 9,
        created_at: '2026-09-10T06:25:55.699Z',
        updated_at: '2026-09-10T06:25:55.699Z',
        data: { title: 'Hello' },
      },
      'ignored',
    )

    expect(mapped).toEqual({
      id: '01M2',
      collection: 'posts',
      rev: 2,
      seq: 9,
      created_at: '2026-09-10T06:25:55.699Z',
      updated_at: '2026-09-10T06:25:55.699Z',
      data: { title: 'Hello' },
    })
  })

  test('uses fallbackCollection when envelope omits collection', () => {
    const mapped = EntryMapper.fromEnvelope(
      {
        id: '01M4',
        rev: 1,
        created_at: '2026-09-10T06:25:55.699Z',
        updated_at: '2026-09-10T06:25:55.699Z',
        data: { title: 'Fallback' },
      },
      'notes',
    )

    expect(mapped.collection).toBe('notes')
    expect(mapped.seq).toBe(0)
    expect(mapped.data).toEqual({ title: 'Fallback' })
  })
})
