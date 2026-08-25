import { JsonPath } from '@silo/shared/json-path'

/**
 * A D29 path as a column heading. `$.data.views` is exact and belongs in a
 * URL; on a button it is noise, so the root is dropped and the field is what
 * the reader sees. The full path stays available as a tooltip, because the
 * short form is ambiguous for nested fields and the exact one always resolves
 * the ambiguity.
 */
export class PathLabel {
  private static readonly DataDot = `$.${JsonPath.DataField}.`
  private static readonly DataBracket = `$.${JsonPath.DataField}[`

  static of(path: string): string {
    // Matched against `$.data.` and `$.data[` rather than `$.data`, or a field
    // named `database` would be shortened to `base`.
    if (path.startsWith(PathLabel.DataDot)) return path.slice(PathLabel.DataDot.length)
    if (path.startsWith(PathLabel.DataBracket)) return path.slice(PathLabel.DataBracket.length - 1)
    if (path.startsWith('$.')) return path.slice(2)
    return path
  }
}
