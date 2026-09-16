import type { SchemaFieldConstraints, SchemaFieldKind } from './schema-field'

/** The family of validation keywords a kind carries. */
export type SchemaConstraintGroup = 'text' | 'range' | 'items'

/**
 * The validation keywords the visual builder reads and writes, and which kinds
 * carry them.
 *
 * Every keyword here earns its place twice: the server asserts it, and the
 * entry form already draws it. A `format` picks RJSF's control outright, a
 * range becomes the number input's `min`/`max`/`step`, and `maxItems` is what
 * stops the Add button. A keyword only one of the two would honour stays in
 * Code view, where it is still saved and still enforced.
 *
 * The set is written as a whole on every save, so a kind change cannot leave a
 * keyword from the kind before it behind — a string that became a boolean would
 * otherwise keep a `maxLength` the builder no longer shows, and Code view would
 * disagree with the row above it.
 */
export class SchemaConstraints {
  /** Every keyword this class owns, dropped together before the kind's own are
   *  written back. */
  static readonly Keywords: readonly string[] = [
    'format',
    'minLength',
    'maxLength',
    'pattern',
    'minimum',
    'maximum',
    'multipleOf',
    'minItems',
    'maxItems',
    'uniqueItems',
  ]

  /**
   * The formats offered, each one a control RJSF has and `ajv-formats` asserts
   * on both sides.
   *
   * `color` and `data-url` are left out for the second half: RJSF's own
   * validator registers them, silo's server does not, so a value the form
   * accepted would be stored unchecked by the authority that matters.
   */
  static readonly Formats: readonly { value: string; label: string }[] = [
    { value: 'email', label: 'Email' },
    { value: 'uri', label: 'URL' },
    { value: 'date', label: 'Date' },
    { value: 'date-time', label: 'Date and time' },
    { value: 'time', label: 'Time' },
    { value: 'uuid', label: 'UUID' },
  ]

  /** A field that constrains nothing beyond its type. */
  static empty(): SchemaFieldConstraints {
    return {
      format: '',
      minLength: '',
      maxLength: '',
      pattern: '',
      minimum: '',
      maximum: '',
      multipleOf: '',
      minItems: '',
      maxItems: '',
      uniqueItems: false,
    }
  }

  /** Which keywords a kind carries, or null where none apply. A media string
   *  is deliberately none: its value is a `silo://` reference silo writes. */
  static groupFor(kind: SchemaFieldKind): SchemaConstraintGroup | null {
    if (kind === 'string') return 'text'
    if (kind === 'number' || kind === 'integer') return 'range'
    if (kind === 'array' || kind === 'ref-array') return 'items'
    return null
  }

  /** What a property already declares, whatever its kind — the editor shows
   *  only the group the kind carries, and `apply` writes only that group. */
  static of(property: any): SchemaFieldConstraints {
    return {
      format: typeof property?.format === 'string' ? property.format : '',
      minLength: SchemaConstraints.typed(property?.minLength),
      maxLength: SchemaConstraints.typed(property?.maxLength),
      pattern: typeof property?.pattern === 'string' ? property.pattern : '',
      minimum: SchemaConstraints.typed(property?.minimum),
      maximum: SchemaConstraints.typed(property?.maximum),
      multipleOf: SchemaConstraints.typed(property?.multipleOf),
      minItems: SchemaConstraints.typed(property?.minItems),
      maxItems: SchemaConstraints.typed(property?.maxItems),
      uniqueItems: property?.uniqueItems === true,
    }
  }

  /** Rewrites the property's constraints in place: every owned keyword off,
   *  then back the ones the kind carries and the author filled in. */
  static apply(property: any, kind: SchemaFieldKind, constraints: SchemaFieldConstraints): void {
    for (const keyword of SchemaConstraints.Keywords) delete property[keyword]

    switch (SchemaConstraints.groupFor(kind)) {
      case 'text':
        if (constraints.format) property.format = constraints.format
        SchemaConstraints.put(property, 'minLength', constraints.minLength)
        SchemaConstraints.put(property, 'maxLength', constraints.maxLength)
        if (constraints.pattern) property.pattern = constraints.pattern
        return
      case 'range':
        SchemaConstraints.put(property, 'minimum', constraints.minimum)
        SchemaConstraints.put(property, 'maximum', constraints.maximum)
        SchemaConstraints.put(property, 'multipleOf', constraints.multipleOf)
        return
      case 'items':
        SchemaConstraints.put(property, 'minItems', constraints.minItems)
        SchemaConstraints.put(property, 'maxItems', constraints.maxItems)
        if (constraints.uniqueItems) property.uniqueItems = true
        return
      default:
        return
    }
  }

  /** A declared number as the text an input holds, or nothing when the keyword
   *  is absent or carries something that is not a number. */
  private static typed(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  }

  /** The typed text as a number, or no keyword at all. Text that is not a
   *  number yet (`-`, `0.`) writes nothing, so the constraint appears when the
   *  author finishes rather than as whatever the half of it parsed to. */
  private static put(property: any, keyword: string, typed: string): void {
    const trimmed = typed.trim()
    if (!trimmed) return
    const value = Number(trimmed)
    if (Number.isFinite(value)) property[keyword] = value
  }
}
