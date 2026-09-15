import { describe, expect, test } from 'bun:test'
import { MediaFolderTree } from './media-folder-tree'

/**
 * The value the move picker browses: what a flat folder list becomes, and
 * which nodes open with it.
 */
describe('MediaFolderTree.build', () => {
  test('an empty library is the root and nothing else', () => {
    const root = MediaFolderTree.build([])
    expect(root.path).toBe('')
    expect(root.name).toBe(MediaFolderTree.RootName)
    expect(root.children).toEqual([])
  })

  test('nests each folder under its parent, naming it by its last segment', () => {
    const root = MediaFolderTree.build(['/heroes', '/heroes/2026'])
    expect(root.children.map((child) => child.path)).toEqual(['/heroes'])
    expect(root.children[0].name).toBe('heroes')
    expect(root.children[0].children.map((child) => child.name)).toEqual(['2026'])
  })

  test('sorts each level rather than trusting the listing order', () => {
    const root = MediaFolderTree.build(['/zebra', '/apple', '/mango'])
    expect(root.children.map((child) => child.name)).toEqual(['apple', 'mango', 'zebra'])
  })

  test('creates an ancestor the list never named, so nothing is orphaned', () => {
    const root = MediaFolderTree.build(['/a/b/c'])
    expect(root.children.map((child) => child.path)).toEqual(['/a'])
    expect(root.children[0].children[0].path).toBe('/a/b')
    expect(root.children[0].children[0].children[0].path).toBe('/a/b/c')
  })

  test('names a folder once however many descendants it has', () => {
    const root = MediaFolderTree.build(['/a', '/a/b', '/a/c'])
    expect(root.children).toHaveLength(1)
    expect(root.children[0].children.map((child) => child.name)).toEqual(['b', 'c'])
  })
})

describe('MediaFolderTree.ancestors', () => {
  test('root alone is the root', () => {
    expect(MediaFolderTree.ancestors('')).toEqual([''])
  })

  test('a nested folder carries every ancestor, root first', () => {
    expect(MediaFolderTree.ancestors('/a/b')).toEqual(['', '/a', '/a/b'])
  })
})
