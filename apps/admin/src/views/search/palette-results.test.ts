import { describe, expect, test } from 'bun:test'
import { PaletteResults } from './palette-results'
import type { MediaAsset } from '../../api/types/media-asset'
import type { SearchHit } from '../../api/types/search-hit'

const ctx = { serverId: 's1', scope: { project: 'acme', env: 'prod' } }

const hit = (over: Partial<SearchHit> & { id: string }): SearchHit => ({
  project: 'acme',
  env: 'prod',
  collection: 'posts',
  entry: {
    id: over.id,
    collection: over.collection || 'posts',
    rev: 1,
    seq: 1,
    created_at: '',
    updated_at: '',
    data: { title: `Title ${over.id}` },
  },
  snippets: [],
  ...over,
})

const asset = (filename: string): MediaAsset => ({
  id: `m_${filename}`,
  filename,
  folder: '/brand',
  blob_key: 'k',
  size: 1,
  content_type: 'image/png',
  hash: 'h',
  state: 'active',
  tags: [],
  url: '/api/media/x/raw',
  created_at: '',
  updated_at: '',
})

const match = (name: string, over: { count?: number | null; matchedField?: string | null } = {}) => ({
  name,
  count: over.count ?? null,
  matchedField: over.matchedField ?? null,
})

describe('PaletteResults.build', () => {
  test('groups by collection, keeping the order the ranking gave', () => {
    const groups = PaletteResults.build(
      [
        hit({ id: 'a', collection: 'posts' }),
        hit({ id: 'b', collection: 'authors' }),
        hit({ id: 'c', collection: 'posts' }),
      ],
      [],
      ctx,
    )
    // "posts" first because its best hit ranked first — not alphabetically.
    expect(groups.map((g) => g.label)).toEqual(['posts', 'authors'])
    expect(groups[0].items).toHaveLength(2)
  })

  test('names the scope only when the result is outside the one on screen', () => {
    const groups = PaletteResults.build(
      [hit({ id: 'a' }), hit({ id: 'b', collection: 'notes', project: 'other', env: 'stage' })],
      [],
      ctx,
    )
    expect(groups[0].scope).toBeNull()
    expect(groups[1].scope).toBe('other/stage')
  })

  test('links a result to the scope it was found in, not the one being browsed', () => {
    const groups = PaletteResults.build([hit({ id: 'x', project: 'other', env: 'stage' })], [], ctx)
    expect(groups[0].items[0].href).toBe(
      '/servers/s1/projects/other/environments/stage/collections/posts/entries/x',
    )
  })

  test('media is its own group, and only in the UI', () => {
    const groups = PaletteResults.build([hit({ id: 'a' })], [asset('logo.png')], ctx)
    expect(groups.map((g) => g.kind)).toEqual(['entry', 'media'])
    // The library has no per-asset URL, so the link carries the search instead.
    expect(groups[1].items[0].href).toContain('/media?q=logo.png')
  })

  test('no media means no media group, rather than an empty heading', () => {
    expect(PaletteResults.build([hit({ id: 'a' })], [], ctx)).toHaveLength(1)
  })

  test('an entry with nothing titleable falls back to its id', () => {
    const bare = hit({ id: '01J8XQ4Z8K9M2P3R5T7V9X1B3D' })
    bare.entry.data = { published: null }
    expect(PaletteResults.build([bare], [], ctx)[0].items[0].title).toBe('01J8XQ4Z…B3D')
  })

  test('matched collections lead, since they are navigation rather than content', () => {
    const groups = PaletteResults.build([hit({ id: 'a' })], [asset('logo.png')], ctx, [
      match('posts', { count: 12 }),
    ])
    expect(groups.map((g) => g.kind)).toEqual(['collection', 'entry', 'media'])
    expect(groups[0].items[0].title).toBe('posts')
    expect(groups[0].items[0].subtitle).toBe('12 entries')
    // The name is what matched, so the link is the collection itself — carrying
    // the query in would land the reader on a list of nothing.
    expect(groups[0].items[0].href).toBe(
      '/servers/s1/projects/acme/environments/prod/collections/posts',
    )
  })

  test('a collection that matched on a field says which one', () => {
    const groups = PaletteResults.build([], [], ctx, [match('orders', { matchedField: 'customer_id' })])
    expect(groups[0].items[0].subtitle).toBe('field: customer_id')
  })

  test('no collections means no heading, and none is the default', () => {
    expect(PaletteResults.build([hit({ id: 'a' })], [], ctx, [])).toHaveLength(1)
    expect(PaletteResults.build([hit({ id: 'a' })], [], ctx)).toHaveLength(1)
  })

  test('at most five collections, so the entry hits stay above the fold', () => {
    const groups = PaletteResults.build(
      [hit({ id: 'a' })],
      [],
      ctx,
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => match(n)),
    )
    expect(groups[0].items.map((i) => i.title)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('flatten walks the groups in reading order, which is what the arrow keys follow', () => {
    const groups = PaletteResults.build(
      [hit({ id: 'a' }), hit({ id: 'b', collection: 'notes' })],
      [asset('logo.png')],
      ctx,
      [match('posts')],
    )
    expect(PaletteResults.flatten(groups).map((i) => i.id)).toEqual([
      'collection:acme/prod/posts',
      'entry:acme/prod/posts/a',
      'entry:acme/prod/notes/b',
      'media:m_logo.png',
    ])
  })
})
