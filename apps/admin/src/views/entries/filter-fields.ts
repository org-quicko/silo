import { JsonPath } from '@silo/shared/json-path'
import type { FilterValueType } from '../../query/filter-model'
import { SchemaType } from '../../schema/schema-type'

/** One thing a filter row can address, ready for a menu. */
export interface FilterField {
  path: string
  label: string
  type: FilterValueType
  /** From the property's JSON Schema `enum`, when `type` is `'enum'`. */
  values?: string[]
  /** An array property: only membership (`includes`) is offered — see `FilterOpsByType`. */
  isArray?: boolean
}

/** One op a menu can offer for a row, with the type-appropriate label. */
export interface FilterOpOption {
  op: string
  label: string
}

/**
 * Ops narrowed by JSON Schema type (handoff 1d). These are labels over the
 * ops `@silo/shared` already declares — no op here is new, and `between` is
 * not one of them: it is two `Filter` leaves (`gte` + `lte`) that
 * `FilterModel` compiles as a pair and reads back as a pair, entirely on the
 * client, because the AST has no "range" leaf and needs none.
 *
 * `array` fields are deliberately down-scoped to `includes` only. `excludes`
 * would need `not(eq(...))` and `is empty` would need `not(exists(...))` —
 * `FilterModel`'s rows are flat leaves with no `not`, and `neq` on a `[*]`
 * path does not mean what "excludes" implies (§5.3: it means *at least one*
 * element differs, not *no* element matches). Offering a label the AST can't
 * back correctly would be worse than offering fewer labels.
 */
export const FilterOpsByType: Record<FilterValueType, readonly FilterOpOption[]> = {
  string: [
    { op: 'eq', label: 'is' },
    { op: 'neq', label: 'is not' },
    { op: 'contains', label: 'contains' },
    { op: 'exists', label: 'is present' },
  ],
  enum: [
    { op: 'eq', label: 'is' },
    { op: 'neq', label: 'is not' },
    { op: 'in', label: 'is one of' },
  ],
  number: [
    { op: 'eq', label: '=' },
    { op: 'neq', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
  ],
  boolean: [
    { op: 'eq', label: 'is' },
    { op: 'exists', label: 'is present' },
  ],
  'date-time': [
    { op: 'lt', label: 'before' },
    { op: 'gt', label: 'after' },
    { op: 'between', label: 'between' },
  ],
}

const ArrayFieldOps: readonly FilterOpOption[] = [{ op: 'eq', label: 'includes' }]

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
    { path: JsonPath.CreatedAt, label: 'created', type: 'date-time' },
    { path: JsonPath.UpdatedAt, label: 'updated', type: 'date-time' },
  ]

  static of(schema: any): FilterField[] {
    const props = schema?.properties
    const fields = props
      ? Object.keys(props).map((name) => FilterFields.field(name, props[name]))
      : []
    return [...fields, ...FilterFields.Envelope]
  }

  /** The ops a row's field type should offer, in menu order. */
  static ops(field: Pick<FilterField, 'type' | 'isArray'>): readonly FilterOpOption[] {
    return field.isArray ? ArrayFieldOps : FilterOpsByType[field.type]
  }

  /**
   * The value type a row should compare with, from the property's JSON Schema
   * type/format. Read through `SchemaType`, because a nullable number is
   * `["integer", "null"]` and offering it the string ops would send `"290"` for
   * a field holding `290` — a filter that draws fine and matches nothing.
   */
  static valueType(property: any): FilterValueType {
    if (FilterFields.choices(property)) return 'enum'
    const type = SchemaType.of(property)
    if (type === 'string' && property?.format === 'date-time') return 'date-time'
    if (SchemaType.isNumeric(property)) return 'number'
    if (type === 'boolean') return 'boolean'
    return 'string'
  }

  private static field(name: string, property: any): FilterField {
    const base = JsonPath.dataField(name)
    // An array is addressed through its elements: `eq($.data.tags[*], "go")`
    // asks whether any tag is "go", while a path to the array itself compares
    // against the whole list and matches nothing (D29 — values are scalars).
    if (SchemaType.of(property) === 'array') {
      const itemType = FilterFields.valueType(property?.items)
      return { path: `${base}[*]`, label: `${name} (any)`, type: itemType, isArray: true }
    }
    const type = FilterFields.valueType(property)
    return { path: base, label: name, type, values: FilterFields.choices(property) }
  }

  /**
   * The values an enum offers a filter, or `undefined` when it is not one this
   * can draw a list for.
   *
   * `null` is dropped rather than disqualifying: a nullable enum carries it as
   * a member, and there is no `eq` against nothing to offer anyway. Without
   * this every imported Strapi enumeration fell back to a free-text box.
   */
  private static choices(property: any): string[] | undefined {
    const declared = property?.enum
    if (!Array.isArray(declared)) return undefined
    const named = declared.filter((value: unknown) => value !== null)
    return named.length > 0 && named.every((value: unknown) => typeof value === 'string')
      ? (named as string[])
      : undefined
  }
}
