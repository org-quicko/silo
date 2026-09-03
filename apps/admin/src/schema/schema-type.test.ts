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

  describe('isNullable', () => {
    test('is true only for a union carrying null', () => {
      expect(SchemaType.isNullable({ type: ['integer', 'null'] })).toBeTrue()
      expect(SchemaType.isNullable({ type: ['null'] })).toBeTrue()
      expect(SchemaType.isNullable({ type: 'integer' })).toBeFalse()
      expect(SchemaType.isNullable({ type: ['string', 'number'] })).toBeFalse()
      expect(SchemaType.isNullable({})).toBeFalse()
    })
  })

  describe('isUntyped', () => {
    test('is true when no type is declared, which a JSON column is', () => {
      expect(SchemaType.isUntyped({})).toBeTrue()
      expect(SchemaType.isUntyped({ description: 'anything' })).toBeTrue()
      expect(SchemaType.isUntyped(undefined)).toBeTrue()
    })

    test('is false whenever the keyword is there, in either form', () => {
      expect(SchemaType.isUntyped({ type: 'string' })).toBeFalse()
      expect(SchemaType.isUntyped({ type: ['string', 'null'] })).toBeFalse()
      expect(SchemaType.isUntyped({ type: ['null'] })).toBeFalse()
    })
  })

  describe('isUnresolved', () => {
    test('is true for an array form naming other than one real type', () => {
      expect(SchemaType.isUnresolved({ type: ['string', 'number'] })).toBeTrue()
      expect(SchemaType.isUnresolved({ type: ['null'] })).toBeTrue()
    })

    test('is false for a plain type, a nullable one, and no type at all', () => {
      expect(SchemaType.isUnresolved({ type: 'string' })).toBeFalse()
      expect(SchemaType.isUnresolved({ type: ['integer', 'null'] })).toBeFalse()
      expect(SchemaType.isUnresolved({})).toBeFalse()
    })

    test('with `of` and `isUntyped`, every shape has exactly one answer', () => {
      const shapes = [{ type: 'string' }, { type: ['integer', 'null'] }, {}, { type: ['a', 'b'] }]

      for (const shape of shapes) {
        const answers = [
          SchemaType.of(shape) !== null,
          SchemaType.isUntyped(shape),
          SchemaType.isUnresolved(shape),
        ]
        expect(answers.filter(Boolean)).toHaveLength(1)
      }
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
