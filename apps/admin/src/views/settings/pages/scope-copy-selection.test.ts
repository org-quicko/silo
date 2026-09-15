import { describe, expect, test } from 'bun:test'
import { ScopeCopySelection } from './scope-copy-selection'

describe('ScopeCopySelection', () => {
  test('a full collection subsumes its individual entries', () => {
    const subset = ScopeCopySelection.addEntry([], 'posts', 'one')
    expect(ScopeCopySelection.addCollection(subset, 'posts')).toEqual([{ collection: 'posts' }])
    expect(ScopeCopySelection.addEntry([{ collection: 'posts' }], 'posts', 'two')).toEqual([{ collection: 'posts' }])
  })

  test('deduplicates entries and removing the final entry leaves no implicit whole-scope copy', () => {
    const selected = ScopeCopySelection.addEntry(ScopeCopySelection.addEntry([], 'posts', 'one'), 'posts', 'one')
    expect(selected).toEqual([{ collection: 'posts', entryIds: ['one'] }])
    expect(ScopeCopySelection.removeEntry(selected, 'posts', 'one')).toEqual([])
  })
})
