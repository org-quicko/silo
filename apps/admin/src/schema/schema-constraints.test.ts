import { describe, expect, test } from 'bun:test'
import { SchemaConstraints } from './schema-constraints'
import type { SchemaFieldKind } from './schema-field'

/** Read a property's constraints, change nothing, write them back onto a copy
 *  of it: exactly what one visual-mode save does to a field. */
const save = (kind: SchemaFieldKind, property: Record<string, unknown>) => {
  const written = { ...property }
  SchemaConstraints.apply(written, kind, SchemaConstraints.of(property))
  return written
}

describe('SchemaConstraints', () => {
  describe('of', () => {
    test('reads each keyword as the text its control holds', () => {
      const constraints = SchemaConstraints.of({
        type: 'string',
        format: 'email',
        minLength: 3,
        maxLength: 80,
        pattern: '^[a-z]+$',
      })

      expect(constraints.format).toBe('email')
      expect(constraints.minLength).toBe('3')
      expect(constraints.maxLength).toBe('80')
      expect(constraints.pattern).toBe('^[a-z]+$')
    })

    test('an absent keyword is empty, not zero', () => {
      const constraints = SchemaConstraints.of({ type: 'integer' })

      expect(constraints.minimum).toBe('')
      expect(constraints.maximum).toBe('')
      expect(constraints.uniqueItems).toBeFalse()
    })

    test('a keyword carrying something other than a number reads as empty', () => {
      expect(SchemaConstraints.of({ minLength: '3' }).minLength).toBe('')
      expect(SchemaConstraints.of({ minimum: null }).minimum).toBe('')
    })
  })

  describe('apply', () => {
    // The round trip runs on every keystroke and a populated collection's
    // schema is frozen (D69), so a save that rewrote a keyword it did not
    // change would be refused as if a field had been retyped.
    test('returns an untouched property unchanged', () => {
      const property = {
        type: 'string',
        format: 'uri',
        minLength: 1,
        maxLength: 2048,
        pattern: '^https?://',
      }

      expect(save('string', property)).toEqual(property)
    })

    test('keeps a range and a step on a number', () => {
      const property = { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.01 }

      expect(save('number', property)).toEqual(property)
    })

    test('keeps item bounds and uniqueness on a list', () => {
      const property = { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true }

      expect(save('array', property)).toEqual(property)
    })

    test('keeps item bounds on a reference list, which is an array too', () => {
      const property = { type: 'array', items: { $ref: 'silo://collections/tags' }, maxItems: 3 }

      expect(save('ref-array', property)).toEqual(property)
    })

    // Otherwise Code view disagrees with the row above it: the builder shows no
    // length on a boolean, and the document still declares one.
    test('drops the keywords the new kind cannot carry', () => {
      const property = { type: 'string', minLength: 3, maxLength: 80, pattern: '^a' }

      expect(save('boolean', property)).toEqual({ type: 'string' })
    })

    test('a numeric range does not survive a switch to text', () => {
      expect(save('string', { type: 'number', minimum: 1 })).toEqual({ type: 'number' })
    })

    // A media value is a `silo://` reference silo writes and reads back as a
    // URL, so nothing an author types about its text applies to it.
    test('a media field carries no text constraints', () => {
      expect(save('media', { type: 'string', 'x-silo-type': 'media', format: 'uri' })).toEqual({
        type: 'string',
        'x-silo-type': 'media',
      })
    })

    test('writes nothing for a keyword left blank', () => {
      const property: Record<string, unknown> = { type: 'string' }
      SchemaConstraints.apply(property, 'string', SchemaConstraints.empty())

      expect(property).toEqual({ type: 'string' })
    })

    // The document is rebuilt on every keystroke, so the moment `-` or `0.` is
    // not a number yet is a moment the author is still mid-value.
    test('half-typed text writes no keyword at all', () => {
      const property: Record<string, unknown> = { type: 'integer' }
      SchemaConstraints.apply(property, 'integer', { ...SchemaConstraints.empty(), minimum: '-' })

      expect(property).toEqual({ type: 'integer' })
    })

    test('writes a typed number as a number, not as its text', () => {
      const property: Record<string, unknown> = { type: 'number' }
      SchemaConstraints.apply(property, 'number', { ...SchemaConstraints.empty(), multipleOf: '0.01' })

      expect(property).toEqual({ type: 'number', multipleOf: 0.01 })
    })

    test('uniqueItems goes off rather than to false, so nothing is added', () => {
      const property: Record<string, unknown> = { type: 'array', uniqueItems: true }
      SchemaConstraints.apply(property, 'array', SchemaConstraints.empty())

      expect(property).toEqual({ type: 'array' })
    })
  })

  describe('groupFor', () => {
    test('names the family each kind carries', () => {
      expect(SchemaConstraints.groupFor('string')).toBe('text')
      expect(SchemaConstraints.groupFor('number')).toBe('range')
      expect(SchemaConstraints.groupFor('integer')).toBe('range')
      expect(SchemaConstraints.groupFor('array')).toBe('items')
      expect(SchemaConstraints.groupFor('ref-array')).toBe('items')
    })

    test('a kind with nothing to constrain has no group', () => {
      for (const kind of ['boolean', 'object', 'enum', 'ref', 'media', 'any'] as SchemaFieldKind[]) {
        expect(SchemaConstraints.groupFor(kind)).toBeNull()
      }
    })
  })

  describe('Formats', () => {
    // A format the admin's validator knows and the server's does not would let
    // the form accept a value the authority stores unchecked.
    test('offers only formats ajv-formats asserts on both sides', () => {
      const offered = SchemaConstraints.Formats.map((format) => format.value)

      expect(offered).toEqual(['email', 'uri', 'date', 'date-time', 'time', 'uuid'])
      expect(offered).not.toContain('color')
      expect(offered).not.toContain('data-url')
    })
  })
})
