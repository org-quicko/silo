import { Formatters } from '../../utils/formatters'
import type { Entry } from '../../api/types/entry'

/** Which schema properties stand in for an entry in the table's first column. */
export interface PrimaryColumns {
  /** The heading column — a title, a name, or the first property there is. */
  primary: string | null
  /** A second line under it, when the schema has an obvious one. */
  sub: string | null
}

/** How an entry is named in a list, from whatever its schema offers. */
export class EntryLabels {
  static schemaColumns(schema: any): string[] {
    return schema?.properties ? Object.keys(schema.properties) : []
  }

  static pickPrimary(columns: string[]): PrimaryColumns {
    const primary =
      columns.find((column) => column === 'title') ||
      columns.find((column) => column === 'name') ||
      columns[0] ||
      null
    return { primary, sub: columns.find((column) => column === 'slug') || null }
  }

  /** The primary column's value, falling back to a shortened id. */
  static of(entry: Entry, primary: string | null): string {
    if (!primary) return Formatters.shortId(entry.id)
    return String(entry.data?.[primary] ?? Formatters.shortId(entry.id))
  }
}
