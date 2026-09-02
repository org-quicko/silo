import { Formatters } from '../../utils/formatters'
import { SchemaType } from '../../schema/schema-type'
import { ValueTitle } from '../../utils/value-title'
import type { Entry } from '../../api/types/entry'
import { CellFormat } from './cell-format'

/** Which schema properties stand in for an entry in the table's first column. */
export interface PrimaryColumns {
  /** The heading column — a title, a name, or the first property there is. */
  primary: string | null
  /** A second line under it, when the schema has an obvious one. */
  sub: string | null
}

/**
 * How an entry is named in a list, from whatever its schema offers.
 *
 * Both halves of that answer have to cope with a property that is not a name.
 * A collection imported from Strapi routinely has exactly one, and it is a list
 * of components or a JSON column — so `String(value)`, which is what this used
 * to do, titled the entry `[object Object],[object Object],[object Object]`.
 * The rule here is `CellValue`'s: a composite value is summarised or counted,
 * never dumped.
 */
export class EntryLabels {
  static schemaColumns(schema: any): string[] {
    return schema?.properties ? Object.keys(schema.properties) : []
  }

  /**
   * Prefers a property that can carry a name. `Columns` already keeps objects
   * and lists of them out of the *default* columns for the same reason; the
   * heading column had no such rule, so a schema that happens to declare its
   * list first was titled by it while a perfectly good `version` beside it went
   * to the columns picker.
   */
  static pickPrimary(columns: string[], schema?: any): PrimaryColumns {
    const properties = schema?.properties ?? {}
    const primary =
      columns.find((column) => column === 'title') ||
      columns.find((column) => column === 'name') ||
      columns.find((column) => EntryLabels.isNameable(properties[column])) ||
      columns[0] ||
      null
    return { primary, sub: columns.find((column) => column === 'slug') || null }
  }

  /** The primary column's value, falling back to a shortened id. */
  static of(entry: Entry, primary: string | null, schema?: any): string {
    if (!primary) return Formatters.shortId(entry.id)
    const property = schema?.properties?.[primary]
    return EntryLabels.render(property, entry.data?.[primary]) ?? Formatters.shortId(entry.id)
  }

  /**
   * Whether a property is the kind of thing an entry can be called by. A schema
   * that declares no type says nothing about its values, so it is not one; a
   * media reference is a `silo://` id, which names a file rather than the entry
   * holding it.
   */
  private static isNameable(property: any): boolean {
    if (CellFormat.isMediaField(property)) return false
    const type = SchemaType.of(property)
    return type === 'string' || type === 'number' || type === 'integer'
  }

  /** One value as a title, or `null` when it has nothing to say. */
  private static render(property: any, value: unknown): string | null {
    if (Array.isArray(value)) return EntryLabels.list(property?.items, value)

    const named = ValueTitle.of(property, undefined, value)
    if (named) return named
    // An object whose fields are all empty or composite — the same count
    // `CellValue` shows for one, rather than a shortened id that says even less.
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value as object).length
      return `{ ${keys} key${keys === 1 ? '' : 's'} }`
    }
    return null
  }

  /**
   * A list of scalars reads as itself; a list of objects reads as its length.
   * Naming it after its first item would be the guess `CellValue` refuses to
   * make in a cell, and for the same reason: the second item is as much the
   * entry as the first.
   */
  private static list(items: any, values: unknown[]): string | null {
    if (values.length === 0) return null
    if (values.some((value) => value !== null && typeof value === 'object')) {
      return `${values.length} item${values.length === 1 ? '' : 's'}`
    }
    const named = values
      .map((value) => ValueTitle.of(items, undefined, value))
      .filter((label): label is string => label !== null)
    return named.length > 0 ? named.join(', ') : null
  }
}
