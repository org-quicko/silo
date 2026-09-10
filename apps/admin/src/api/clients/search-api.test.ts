import { describe, expect, test } from 'bun:test'
import type { HttpTransport } from '../transport/http-transport'
import { SearchApi } from './search-api'

describe('SearchApi', () => {
  test('formats reach paths correctly', () => {
    expect(SearchApi.path({ kind: 'instance' })).toBe('/api/search')
    expect(SearchApi.path({ kind: 'scope', scope: { project: 'proj', env: 'prod' } })).toBe(
      '/api/projects/proj/environments/prod/search',
    )
    expect(
      SearchApi.path({ kind: 'collection', scope: { project: 'proj', env: 'prod' }, collection: 'posts' }),
    ).toBe('/api/projects/proj/environments/prod/collections/posts/search')
  })

  test('delegates search query to silo client', async () => {
    let requestedQuery: any = null
    const fakeSilo = {
      search: async (q: any) => {
        requestedQuery = q
        return { hits: [], total: 0, limit: 20, offset: 0, truncated: false, engine: 'fts5' }
      },
    }
    const fakeTransport = {
      silo: () => fakeSilo,
    } as unknown as HttpTransport
    const api = new SearchApi(fakeTransport)
    await api.run('http://localhost', 'secret', { kind: 'instance' }, { query: 'test' })
    expect(requestedQuery.query).toBe('test')
  })
})
