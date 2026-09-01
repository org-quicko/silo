import { SchemaType } from '../../schema/schema-type'

/**
 * Which schema properties are eligible to be an extra table column, and the
 * default selection before the reader picks their own (handoff 1e "Default
 * column selection"). The primary label and `updated_at` are not part of
 * this list — every table always shows them — so this only ever describes
 * the columns in between.
 *
 * Long text, objects, arrays of objects and media past the first are still
 * choosable from the Columns picker, but never selected automatically: a
 * schema growing by one such field must not silently make an already-busy
 * table unreadable.
 */
export class Columns {
  static readonly DefaultCount = 3
  static readonly MaxSelected = 6

  /** Every property besides `exclude` (the primary and its subtitle field), in schema order. */
  static eligible(schema: any, exclude: readonly string[]): string[] {
    const props = schema?.properties ?? {}
    return Object.keys(props).filter((name) => !exclude.includes(name))
  }

  static defaults(schema: any, exclude: readonly string[]): string[] {
    const props = schema?.properties ?? {}
    return Object.keys(props)
      .filter((name) => !exclude.includes(name))
      .filter((name) => Columns.isAutoSafe(props[name]))
      .slice(0, Columns.DefaultCount)
  }

  private static isAutoSafe(prop: any): boolean {
    if (!prop) return false
    const type = SchemaType.of(prop)
    if (type === 'object') return false
    if (type === 'array') return SchemaType.of(prop.items) !== 'object'
    return true
  }

  /**
   * Reads the `cols` URL param against the current schema — `null` when absent
   * or naming nothing usable, so the caller falls back to `defaults`.
   *
   * Deduplicated because the parameter is hand-editable: a repeated name would
   * otherwise render the same column twice under the same React key.
   */
  static parse(raw: string | null, schema: any, exclude: readonly string[]): string[] | null {
    if (!raw) return null
    const props = schema?.properties ?? {}
    const picked = [...new Set(raw.split(',').map((s) => s.trim()))].filter(
      (name) => name && props[name] && !exclude.includes(name),
    )
    return picked.length > 0 ? picked.slice(0, Columns.MaxSelected) : null
  }

  /** `null` for the default selection, so the common URL stays clean — mirrors `Routes.encodeQuery`'s rule for `sort`. */
  static stringify(names: readonly string[], schema: any, exclude: readonly string[]): string | null {
    const isDefault = JSON.stringify(names) === JSON.stringify(Columns.defaults(schema, exclude))
    return isDefault || names.length === 0 ? null : names.join(',')
  }
}
