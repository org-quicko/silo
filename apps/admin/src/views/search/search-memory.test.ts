import { describe, expect, test } from 'bun:test'
import { SearchMemory, type SearchState } from './search-memory'

describe('SearchMemory', () => {
  const dummyState: SearchState = {
    text: 'Axis',
    chip: null,
    hits: [],
    assets: [],
    engine: 'fts5',
    truncated: false,
    error: '',
  }

  test('saves and retrieves search state per server and scope', () => {
    SearchMemory.set('srv1', 'projA', 'prod', dummyState)
    expect(SearchMemory.get('srv1', 'projA', 'prod')).toEqual(dummyState)
    expect(SearchMemory.get('srv1', 'projA', 'stage')).toBeNull()
    expect(SearchMemory.get('srv2', 'projA', 'prod')).toBeNull()
  })

  test('clears state on request', () => {
    SearchMemory.set('srv1', 'projB', 'prod', dummyState)
    SearchMemory.clear('srv1', 'projB', 'prod')
    expect(SearchMemory.get('srv1', 'projB', 'prod')).toBeNull()
  })
})
