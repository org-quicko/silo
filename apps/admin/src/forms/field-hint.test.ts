import { describe, expect, test } from 'bun:test'
import { FieldHint } from './field-hint'

describe('FieldHint.of', () => {
  test('a plain field is its type, and required when it is', () => {
    expect(FieldHint.of({ type: 'string' }, false)).toBe('string')
    expect(FieldHint.of({ type: 'string' }, true)).toBe('string · required')
  })

  test('a nullable union prints both, which is what the schema declares', () => {
    expect(FieldHint.of({ type: ['integer', 'null'] }, false)).toBe('integer|null')
  })

  test('a list says what is in it', () => {
    expect(FieldHint.of({ type: 'array' }, false)).toBe('array')
    expect(FieldHint.of({ type: 'array', items: { type: 'string' } }, false)).toBe('array<string>')
    expect(FieldHint.of({ type: 'array', items: { $ref: '#/$defs/tags' } }, false)).toBe(
      'array<reference>',
    )
  })

  test('an enum is an enum, whatever type it also declares', () => {
    expect(FieldHint.of({ type: 'string', enum: ['draft', 'live'] }, false)).toBe('enum')
  })

  // Every keyword the schema editor can set has to reach this line, or the form
  // states a rule only by refusing a value for it after the save.
  test('a constrained string names its format, pattern and length', () => {
    expect(
      FieldHint.of(
        { type: 'string', format: 'email', pattern: '^[a-z]+@', minLength: 3, maxLength: 80 },
        true,
      ),
    ).toBe('string · format email · pattern ^[a-z]+@ · min 3 · max 80 · required')
  })

  test('a constrained number names its range and step', () => {
    expect(FieldHint.of({ type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 }, false)).toBe(
      'number · min 0 · max 5 · step 0.5',
    )
  })

  test('a constrained list names its bounds and whether duplicates are allowed', () => {
    expect(
      FieldHint.of({ type: 'array', minItems: 1, maxItems: 5, uniqueItems: true }, false),
    ).toBe('array · min 1 item · max 5 items · no duplicates')
  })

  // `minimum: 0` is the commonest bound there is, and a truthy test drops it.
  test('a zero bound is a bound', () => {
    expect(FieldHint.of({ type: 'integer', minimum: 0 }, false)).toBe('integer · min 0')
  })

  test('no schema is no hint', () => {
    expect(FieldHint.of(null, true)).toBe('')
  })
})
