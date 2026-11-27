import { describe, expect, test } from 'bun:test'
import { JsonValue } from './json-value'

describe('JsonValue', () => {
  test('typeOf and defaultFor cover all JSON types plus empty', () => {
    expect(JsonValue.typeOf(undefined)).toBe('empty')
    expect(JsonValue.typeOf(null)).toBe('null')
    expect(JsonValue.typeOf([])).toBe('array')
    expect(JsonValue.typeOf({})).toBe('object')
    expect(JsonValue.typeOf('hi')).toBe('string')
    expect(JsonValue.typeOf(7)).toBe('number')
    expect(JsonValue.typeOf(false)).toBe('boolean')

    expect(JsonValue.defaultFor('object')).toEqual({})
    expect(JsonValue.defaultFor('array')).toEqual([])
    expect(JsonValue.defaultFor('string')).toBe('')
    expect(JsonValue.defaultFor('number')).toBe(0)
    expect(JsonValue.defaultFor('boolean')).toBe(false)
    expect(JsonValue.defaultFor('null')).toBeNull()
  })

  test('coerce converts sensibly between types without throwing', () => {
    expect(JsonValue.coerce(42, 'string')).toBe('42')
    expect(JsonValue.coerce({ a: 1 }, 'string')).toBe('{"a":1}')
    expect(JsonValue.coerce(null, 'string')).toBe('')

    expect(JsonValue.coerce('3.5', 'number')).toBe(3.5)
    expect(JsonValue.coerce('abc', 'number')).toBe(0)
    expect(JsonValue.coerce(true, 'number')).toBe(1)

    expect(JsonValue.coerce('false', 'boolean')).toBe(false)
    expect(JsonValue.coerce('true', 'boolean')).toBe(true)
    expect(JsonValue.coerce(0, 'boolean')).toBe(false)
    expect(JsonValue.coerce(2, 'boolean')).toBe(true)

    expect(JsonValue.coerce('anything', 'null')).toBeNull()
    expect(JsonValue.coerce(['a', 'b'], 'object')).toEqual({ '0': 'a', '1': 'b' })
    expect(JsonValue.coerce({ a: 1, b: 2 }, 'array')).toEqual([1, 2])
    expect(JsonValue.coerce('hello', 'array')).toEqual(['hello'])
    expect(JsonValue.coerce(undefined, 'array')).toEqual([])
  })

  test('setAt and removeAt mutate nested structures immutably', () => {
    const root = { user: { name: 'Ada', tags: ['a', 'b', 'c'] } }
    const updated = JsonValue.setAt(root, ['user', 'tags', 1], 'beta')
    expect(updated).toEqual({ user: { name: 'Ada', tags: ['a', 'beta', 'c'] } })
    expect(root.user.tags[1]).toBe('b')

    expect(JsonValue.removeAt(updated, ['user', 'tags', 1])).toEqual({
      user: { name: 'Ada', tags: ['a', 'c'] },
    })
    expect(JsonValue.removeAt(updated, ['user', 'name'])).toEqual({
      user: { tags: ['a', 'beta', 'c'] },
    })
    expect(JsonValue.removeAt(updated, [])).toBeUndefined()
  })

  test('renameKeyAt preserves property order and rejects duplicate sibling keys', () => {
    const root = { nested: { first: 1, second: 2, third: 3 } }
    const renamed = JsonValue.renameKeyAt(root, ['nested'], 'second', 'middle')
    expect(renamed.ok).toBe(true)
    if (renamed.ok) {
      expect(Object.keys((renamed.value as any).nested)).toEqual(['first', 'middle', 'third'])
      expect((renamed.value as any).nested.middle).toBe(2)
    }

    const collision = JsonValue.renameKeyAt(root, ['nested'], 'second', 'first')
    expect(collision).toEqual({ ok: false, error: 'Key "first" already exists.' })
  })

  test('addObjectProperty, addArrayItem, moveArrayItem, and duplicateAt work cleanly', () => {
    const base = { key: 'one', meta: { a: [10, 20, 30] } }
    const addedProp = JsonValue.addObjectProperty(base, [])
    expect(addedProp.key).toBe('key_2')
    expect((addedProp.value as any).key_2).toBe('')

    const addedItem = JsonValue.addArrayItem(addedProp.value, ['meta', 'a'], { nested: true })
    expect(addedItem.index).toBe(3)
    expect((addedItem.value as any).meta.a[3]).toEqual({ nested: true })

    const moved = JsonValue.moveArrayItem(addedItem.value, ['meta', 'a'], 2, 0)
    expect((moved as any).meta.a[0]).toBe(30)

    const duplicatedProp = JsonValue.duplicateAt({ alpha: { x: 1 }, beta: 2 }, ['alpha']) as any
    expect(Object.keys(duplicatedProp)).toEqual(['alpha', 'alpha_copy', 'beta'])
    duplicatedProp.alpha_copy.x = 99
    expect(duplicatedProp.alpha.x).toBe(1)

    const duplicatedItem = JsonValue.duplicateAt([{ id: 1 }, { id: 2 }], [0]) as any[]
    expect(duplicatedItem).toHaveLength(3)
    duplicatedItem[1].id = 99
    expect(duplicatedItem[0].id).toBe(1)
  })

  test('countNodes, collectContainerPaths, and defaultCollapsedPaths handle depth and limits', () => {
    const tree = {
      a: {
        b: {
          c: [1, 2],
        },
      },
      list: [{ item: true }],
    }

    expect(JsonValue.countNodes(undefined)).toBe(0)
    expect(JsonValue.countNodes(tree)).toBe(9)
    expect(JsonValue.countNodes(tree, 4)).toBe(5)

    expect(JsonValue.collectContainerPaths(tree)).toEqual([
      '["a"]',
      '["a","b"]',
      '["a","b","c"]',
      '["list"]',
      '["list",0]',
    ])

    const collapsed = JsonValue.defaultCollapsedPaths(tree, 2)
    expect(collapsed.has('["a"]')).toBe(false)
    expect(collapsed.has('["a","b"]')).toBe(true)
    expect(collapsed.has('["a","b","c"]')).toBe(true)
    expect(collapsed.has('["list"]')).toBe(false)
    expect(collapsed.has('["list",0]')).toBe(true)
  })
})
