import { describe, expect, test } from 'bun:test'
import { SchemaFieldSummary } from './schema-field-summary'
import type { SchemaField } from './schema-field'

const field = (patch: Partial<SchemaField>): SchemaField =>
  ({ name: 'status', kind: 'string', required: false, description: '', enumValues: [], refTarget: '', construct: '', ...patch }) as SchemaField

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
})

function describeEnum(values: string[]): string {
  return SchemaFieldSummary.describe(field({ kind: 'enum', enumValues: values }))
}
