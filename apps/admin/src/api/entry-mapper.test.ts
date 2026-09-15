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

  test('an already-enveloped entry passes through', () => {
    const mapped = EntryMapper.fromApiEntry(
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

    expect(mapped.collection).toBe('posts')
    expect(mapped.seq).toBe(9)
    expect(mapped.data).toEqual({ title: 'Hello' })
  })
})
