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

  test('flatten walks the groups in reading order, which is what the arrow keys follow', () => {
    const groups = PaletteResults.build(
      [hit({ id: 'a' }), hit({ id: 'b', collection: 'notes' })],
      [asset('logo.png')],
      ctx,
    )
    expect(PaletteResults.flatten(groups).map((i) => i.id)).toEqual([
      'entry:acme/prod/posts/a',
      'entry:acme/prod/notes/b',
      'media:m_logo.png',
    ])
  })
})
