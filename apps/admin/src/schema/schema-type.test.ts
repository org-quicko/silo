import { describe, expect, test } from 'bun:test'
import { SchemaType } from './schema-type'

describe('SchemaType', () => {
  describe('of', () => {
    test('reads a plain type', () => {
      expect(SchemaType.of({ type: 'string' })).toBe('string')
    })

    test('reads a nullable type, which is how an import writes every column', () => {
      expect(SchemaType.of({ type: ['integer', 'null'] })).toBe('integer')
      expect(SchemaType.of({ type: ['null', 'string'] })).toBe('string')
    })

    test('returns null for a property that declares no type, or two of them', () => {
      expect(SchemaType.of({})).toBeNull()
      expect(SchemaType.of(undefined)).toBeNull()
      expect(SchemaType.of({ type: ['string', 'number'] })).toBeNull()
      expect(SchemaType.of({ type: ['null'] })).toBeNull()
    })
  })

  describe('isNumeric', () => {
    test('covers both number types, nullable or not', () => {
      expect(SchemaType.isNumeric({ type: 'number' })).toBeTrue()
      expect(SchemaType.isNumeric({ type: 'integer' })).toBeTrue()
      expect(SchemaType.isNumeric({ type: ['integer', 'null'] })).toBeTrue()
      expect(SchemaType.isNumeric({ type: ['number', 'null'] })).toBeTrue()
    })

    test('is false for everything else', () => {
      expect(SchemaType.isNumeric({ type: ['string', 'null'] })).toBeFalse()
      expect(SchemaType.isNumeric({ type: 'boolean' })).toBeFalse()
      expect(SchemaType.isNumeric({})).toBeFalse()
    })
  })
})
