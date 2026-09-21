/** What the visual builder can represent a property as. */
export type SchemaFieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'enum'
  | 'ref'
  | 'ref-array'
  | 'media'
  | 'any'

/**
 * The validation keywords the visual builder draws a control for, as the text
 * that was typed into it.
 *
 * The numbers stay text because a keystroke rebuilds the whole document:
 * parsing `0.` to a number and rendering it back would delete the dot the
 * author is still typing, and `-` would never survive long enough to become
 * `-1`. `SchemaConstraints` converts on the way out, where a half-typed value
 * is simply a keyword not written yet.
 */
export interface SchemaFieldConstraints {
  /** A JSON Schema `format`: it validates the value *and* picks the entry
   *  form's control, which is why only formats with both are offered. */
  format: string
  minLength: string
  maxLength: string
  pattern: string
  minimum: string
  maximum: string
  multipleOf: string
  minItems: string
  maxItems: string
  uniqueItems: boolean
}

/** One property of a collection schema, as the visual builder edits it. */
export interface SchemaField {
  name: string
  kind: SchemaFieldKind
  required: boolean
  description: string
  /** What the field constrains beyond its type. Only the group the kind
   *  carries is written back; see `SchemaConstraints`. */
  constraints: SchemaFieldConstraints
  /** `$ref` URL: `silo://collections/<name>` or an https one. */
  refTarget: string
  enumValues: string[]
  /**
   * Whether the property was declared `["<kind>", "null"]`.
   *
   * Carried separately from `raw` because a save rewrites `type` from `kind`,
   * so this is the one part of the declared type a spread of `raw` cannot put
   * back. Every field imported from Strapi is nullable.
   */
  nullable: boolean
  /** The original property JSON, so unknown keywords survive a round trip. */
  raw: any
  /** An advanced subtree the visual builder leaves intact. */
  construct?: 'oneOf' | 'anyOf' | 'allOf' | 'type union'
}

/** What each kind is called in the UI. */
export const SchemaFieldLabels: Record<SchemaFieldKind, string> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  enum: 'enum',
  ref: 'reference',
  'ref-array': 'reference list',
  media: 'media',
  any: 'any',
}
