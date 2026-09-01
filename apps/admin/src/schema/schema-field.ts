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

/** One property of a collection schema, as the visual builder edits it. */
export interface SchemaField {
  name: string
  kind: SchemaFieldKind
  required: boolean
  description: string
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
}
