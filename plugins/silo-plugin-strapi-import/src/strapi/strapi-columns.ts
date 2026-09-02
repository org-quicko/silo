/** One column of a Strapi table, as `strapi_database_schema` records it. */
export interface StrapiColumn {
  name: string
  /** Knex's type name — `string`, `integer`, `json`, `increments`, … */
  type: string
  /**
   * The values a Strapi `enumeration` attribute confines this column to,
   * confirmed against the rows by `StrapiEnums`.
   *
   * Not part of the physical column, which is a plain `varchar`: this is the
   * one thing a table cannot say about itself, and it only reaches here for a
   * content type — a component's schema is not in the export.
   */
  values?: readonly string[]
}

/**
 * Strapi column types → the JSON Schema silo validates against (D3).
 *
 * Its own artifact because it is the one place the two type systems meet, and
 * because getting it wrong is invisible: a `numeric_code` typed as a string
 * imports, validates, and then sorts as text.
 */
export class StrapiColumns {
  /**
   * Columns silo never sees.
   *
   * `id` goes because silo mints its own (D2) and a plugin may not set an
   * envelope field. It is not carried under another name either: a Strapi id in a
   * silo entry is a field nothing on either side resolves. The rest are Strapi's
   * own bookkeeping.
   */
  static readonly Ignored: readonly string[] = [
    'id',
    'created_by_id',
    'updated_by_id',
    'locale',
  ]

  /** What one column becomes in a JSON Schema, or `null` for one to skip. */
  static schemaFor(column: StrapiColumn): Record<string, unknown> | null {
    if (StrapiColumns.Ignored.includes(column.name)) return null

    // `null` is a member of the enumeration, not merely of the type: an
    // unfilled enumeration column is NULL, and `enum` without it would refuse
    // rows this export holds. Silo's schema editor reads the pair back the
    // same way, so switching the field to a plain string and back keeps it.
    if (column.values) return { type: ['string', 'null'], enum: [...column.values, null] }

    switch (column.type) {
      case 'integer':
      case 'bigInteger':
      case 'increments':
        return { type: ['integer', 'null'] }
      case 'decimal':
      case 'double':
      case 'float':
        return { type: ['number', 'null'] }
      case 'boolean':
        return { type: ['boolean', 'null'] }
      case 'datetime':
      case 'date':
      case 'timestamp':
        // Not `format: "date-time"`: Strapi stores these as epoch milliseconds in
        // SQLite, and this importer converts them, but a column that turns out to
        // hold something else would then fail validation on the way in rather
        // than arriving as the string it is.
        return { type: ['string', 'null'] }
      case 'json':
        // No `type` at all. A JSON column holds whatever the author put there,
        // and the honest schema for that is "anything" — narrowing it to `object`
        // would refuse the arrays that are just as common.
        return {}
      default:
        return { type: ['string', 'null'] }
    }
  }

  /**
   * The value as it should be written, given the column's type.
   *
   * Nullable everywhere, because every column in a Strapi component table is —
   * a field left blank in the admin is a `NULL`, and refusing those would refuse
   * most real content.
   */
  static valueFor(column: StrapiColumn, raw: unknown): unknown {
    if (raw === null || raw === undefined) return null

    switch (column.type) {
      case 'boolean':
        return Boolean(raw)
      case 'datetime':
      case 'date':
      case 'timestamp':
        return StrapiColumns.timestamp(raw)
      case 'json':
        return typeof raw === 'string' ? StrapiColumns.parse(raw) : raw
      default:
        return raw
    }
  }

  /** Strapi's SQLite driver stores datetimes as epoch milliseconds; older rows
   *  and other drivers store a string. Both reach ISO-8601, or stay as they
   *  are. */
  private static timestamp(raw: unknown): unknown {
    if (typeof raw !== 'number') return raw
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? raw : date.toISOString()
  }

  /** A malformed JSON column arrives as the text it is rather than failing the
   *  import: the row is still worth having, and the string says what was in
   *  there. */
  private static parse(raw: string): unknown {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
}
