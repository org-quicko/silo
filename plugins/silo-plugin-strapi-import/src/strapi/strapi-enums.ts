import type { StrapiDatabase } from './strapi-database'

/**
 * Strapi's `enumeration` attribute, as a set of values silo can hold an author
 * to.
 *
 * The declaration alone is not enough to write one down. Strapi enforces an
 * enumeration on write and never on the rows already stored, so removing a value
 * from a content type leaves every row that held it exactly where it was — and a
 * schema silo validates against would then refuse an entry this export
 * demonstrably contains. Importing must not turn a stored value into an
 * unimportable one, so the declaration is confirmed against the column before it
 * is carried, and a column the data disagrees with arrives as the plain string
 * it already was.
 *
 * Only a *content type's* columns can be read this way. A component's own schema
 * lives in the project's `src/components/*.json` and never travels in a database
 * export, so an enumeration inside a component is not knowable from here — see
 * `StrapiShapes`.
 */
export class StrapiEnums {
  /**
   * The values this column may hold, or `null` when the declaration is not one
   * or the rows do not fit inside it.
   */
  static confirmed(
    source: StrapiDatabase,
    table: string,
    column: string,
    declared: unknown,
  ): readonly string[] | null {
    if (!Array.isArray(declared) || declared.length === 0) return null
    if (!declared.every((value) => typeof value === 'string')) return null

    const allowed = new Set<string>(declared)
    for (const stored of StrapiEnums.stored(source, table, column)) {
      if (!allowed.has(stored)) return null
    }
    return declared
  }

  /** Every non-null value the column actually holds. Both document versions, so
   *  a value only a draft carries still counts. */
  private static stored(source: StrapiDatabase, table: string, column: string): string[] {
    return source
      .rows<{ value: unknown }>(
        `SELECT DISTINCT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`,
      )
      .map((row) => String(row.value))
  }
}
