import { describe, expect, test } from 'bun:test'
import { PathLabel } from './path-label'

describe('PathLabel.of', () => {
  test.each([
    ['$.data.views', 'views'],
    ['$.data.author.name', 'author.name'],
    ['$.updated_at', 'updated_at'],
    ["$.data['my field']", "['my field']"],
    // `$.database` is a field called "database", not the data root — the
    // prefix has to include the separator or this shortens to "base".
    ['$.database', 'database'],
    ['$.data.tags[*]', 'tags[*]'],
  ])('shortens %s to %s', (path, expected) => {
    expect(PathLabel.of(path)).toBe(expected)
  })

  test('leaves anything it does not recognise exactly as it is', () => {
    expect(PathLabel.of('$')).toBe('$')
  })
})
