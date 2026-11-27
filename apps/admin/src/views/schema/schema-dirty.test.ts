import { describe, expect, test } from 'bun:test'
import { SchemaDraft } from '../../schema/schema-draft'
import { SchemaDirty } from './schema-dirty'

describe('SchemaDirty.check', () => {
  const initialText = JSON.stringify(SchemaDraft.Default, null, 2)
  const initialParsed = SchemaDraft.parse(initialText)

  const baseInput = () => ({
    isNew: true,
    name: '',
    text: initialText,
    initialText,
    fields: initialParsed.fields,
    initialFields: initialParsed.fields,
    auth: initialParsed.auth,
    initialAuth: initialParsed.auth,
    parsedOk: initialParsed.ok,
  })

  test('clean when nothing changed', () => {
    expect(SchemaDirty.check(baseInput())).toBe(false)
  })

  test('dirty when creating and name is non-empty, clean on existing collection', () => {
    expect(SchemaDirty.check({ ...baseInput(), name: 'posts' })).toBe(true)
    expect(SchemaDirty.check({ ...baseInput(), isNew: false, name: 'ignored' })).toBe(false)
  })

  test('dirty when an unnamed blank field is added to fields', () => {
    const withBlank = [...initialParsed.fields, SchemaDraft.blankField()]
    expect(SchemaDirty.check({ ...baseInput(), fields: withBlank })).toBe(true)
  })

  test('dirty when text, auth, or JSON validity changes', () => {
    expect(SchemaDirty.check({ ...baseInput(), text: '{"type":"object"}' })).toBe(true)
    expect(SchemaDirty.check({ ...baseInput(), auth: true })).toBe(true)
    expect(SchemaDirty.check({ ...baseInput(), parsedOk: false })).toBe(true)
  })
})
