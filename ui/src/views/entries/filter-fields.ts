import { JsonPath } from '@silo/shared/json-path'
import type { FilterValueType } from '../../query/filter-model'

/** One thing a filter row can address, ready for a menu. */
export interface FilterField {
  path: string
  label: string
  type: FilterValueType
}

/**
 * What the builder offers to filter on: the envelope, then the collection's
 * own fields. Paths are built with `JsonPath.dataField`, never by hand, so a
 * field named `my title` or `data` is quoted the way the server's parser
 * expects rather than the way string concatenation would guess.
 */
export class FilterFields {
  static readonly Envelope: readonly FilterField[] = [
    { path: JsonPath.Id, label: 'id', type: 'string' },
    { path: JsonPath.Rev, label: 'rev', type: 'number' },
    { path: JsonPath.CreatedAt, label: 'created', type: 'string' },
    { path: JsonPath.UpdatedAt, label: 'updated', type: 'string' },
  ]

  static of(schema: any): FilterField[] {
    const props = schema?.properties
    const fields = props
      ? Object.keys(props).map((name) => FilterFields.field(name, props[name]))
      : []
    return [...fields, ...FilterFields.Envelope]
  }

  /** The value type a row should compare with, from the property's JSON Schema type. */
  static valueType(type: unknown): FilterValueType {
    if (type === 'number' || type === 'integer') return 'number'
    if (type === 'boolean') return 'boolean'
    return 'string'
  }

  private static field(name: string, property: any): FilterField {
    const base = JsonPath.dataField(name)
    // An array is addressed through its elements: `eq($.data.tags[*], "go")`
    // asks whether any tag is "go", while a path to the array itself compares
    // against the whole list and matches nothing (D29 — values are scalars).
    if (property?.type === 'array') {
      return { path: `${base}[*]`, label: `${name} (any)`, type: FilterFields.valueType(property?.items?.type) }
    }
    return { path: base, label: name, type: FilterFields.valueType(property?.type) }
  }
}
