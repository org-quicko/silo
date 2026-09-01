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

  test('sends the search text as ?q=, the name the API documents', async () => {
    let requestedUrl = ''
    const fakeTransport = {
      request: async (_url: string, _key: string, path: string) => {
        requestedUrl = path
        return { data: [], total: 0, limit: 20, offset: 0, truncated: false, engine: 'fts5' as const }
      },
    } as unknown as HttpTransport
    const api = new SearchApi(fakeTransport)
    await api.run('http://localhost', 'secret', { kind: 'instance' }, { query: 'test' })
    expect(requestedUrl).toBe('/api/search?q=test')
  })
})
