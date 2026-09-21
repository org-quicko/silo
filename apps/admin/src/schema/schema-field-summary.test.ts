import { describe, expect, test } from 'bun:test'
import { SchemaConstraints } from './schema-constraints'
import { SchemaFieldSummary } from './schema-field-summary'
import type { SchemaField, SchemaFieldConstraints } from './schema-field'

const field = (patch: Partial<SchemaField>): SchemaField =>
  ({
    name: 'status',
    kind: 'string',
    required: false,
    description: '',
    enumValues: [],
    refTarget: '',
    constraints: SchemaConstraints.empty(),
    construct: '',
    ...patch,
  }) as SchemaField

describe('SchemaFieldSummary.describe', () => {
  test('a short enum is its values', () => {
    expect(describeEnum(['draft', 'live'])).toBe('Enum · draft, live')
  })

  test('at the listing limit it is still just the values', () => {
    expect(describeEnum(['a', 'b', 'c', 'd'])).toBe('Enum · a, b, c, d')
  })

  // The row is one line and clips, so the count has to come before the values:
  // it is the part that survives the ellipsis.
  test('past the limit it leads with how many there are', () => {
    expect(describeEnum(['a', 'b', 'c', 'd', 'e'])).toBe('Enum · 5 values · a, b, c, d, e')
  })

  test('an enum with no values yet falls back to the kind', () => {
    expect(describeEnum([])).toBe('enum')
  })

  describe('constraints', () => {
    test('both bounds read as a range, one bound names which it is', () => {
      expect(describeText({ minLength: '3', maxLength: '80' })).toBe('string · 3–80 chars')
      expect(describeText({ minLength: '3' })).toBe('string · min 3 chars')
      expect(describeText({ maxLength: '80' })).toBe('string · max 80 chars')
    })

    test('a unit is singular where the count it measures is one', () => {
      expect(describeText({ minLength: '1' })).toBe('string · min 1 char')
    })

    test('a format and a pattern are named beside the length', () => {
      expect(describeText({ format: 'email' })).toBe('string · email')
      expect(describeText({ pattern: '^[a-z]+$', maxLength: '40' })).toBe(
        'string · max 40 chars · pattern',
      )
    })

    test('a number states its range and its step', () => {
      const summary = SchemaFieldSummary.describe(
        field({
          kind: 'number',
          constraints: { ...SchemaConstraints.empty(), minimum: '0', maximum: '5', multipleOf: '0.5' },
        }),
      )

      expect(summary).toBe('number · 0–5 · step 0.5')
    })

    test('a list states its item bounds and whether duplicates are allowed', () => {
      const summary = SchemaFieldSummary.describe(
        field({
          kind: 'array',
          constraints: { ...SchemaConstraints.empty(), minItems: '1', uniqueItems: true },
        }),
      )

      expect(summary).toBe('array · min 1 item · no duplicates')
    })

    // The two answer different questions, and the row clips rather than
    // choosing: what the field is for, then what it will accept.
    test('a description keeps its place and the constraints follow it', () => {
      expect(
        SchemaFieldSummary.describe(
          field({
            description: 'URL-safe name',
            constraints: { ...SchemaConstraints.empty(), maxLength: '120' },
          }),
        ),
      ).toBe('URL-safe name · max 120 chars')
    })

    test('a kind that constrains nothing is unchanged', () => {
      expect(SchemaFieldSummary.describe(field({ kind: 'boolean' }))).toBe('boolean')
    })

    // The builder never writes a construct's subtree back, so its constraints
    // are a reading rather than something an author set here.
    test('a construct still says where it is edited', () => {
      expect(SchemaFieldSummary.describe(field({ construct: 'oneOf' }))).toBe(
        'oneOf · edit in Code view',
      )
    })
  })
})

function describeEnum(values: string[]): string {
  return SchemaFieldSummary.describe(field({ kind: 'enum', enumValues: values }))
}

function describeText(patch: Partial<SchemaFieldConstraints>): string {
  return SchemaFieldSummary.describe(
    field({ constraints: { ...SchemaConstraints.empty(), ...patch } }),
  )
}
