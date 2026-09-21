/**
 * The mono line beside a field's label in the entry form: what the field is,
 * then everything it will accept.
 *
 * It names every constraint the schema editor can set, so the form states a
 * rule before a save comes back refusing the value for it. The order is the
 * order somebody reads them in — the type, what shape the value takes, how big
 * it may be, and whether it can be left out.
 */
export class FieldHint {
  static of(schema: any, required: boolean): string {
    if (!schema) return ''
    const parts: string[] = [
      FieldHint.typeOf(schema),
      schema.format && `format ${schema.format}`,
      schema.pattern && `pattern ${schema.pattern}`,
      FieldHint.number(schema.minLength, 'min'),
      FieldHint.number(schema.maxLength, 'max'),
      FieldHint.number(schema.minimum, 'min'),
      FieldHint.number(schema.maximum, 'max'),
      FieldHint.number(schema.multipleOf, 'step'),
      FieldHint.number(schema.minItems, 'min', 'items'),
      FieldHint.number(schema.maxItems, 'max', 'items'),
      schema.uniqueItems === true && 'no duplicates',
      required && 'required',
    ].filter(Boolean) as string[]
    return parts.join(' · ')
  }

  /** What the value is, with a list saying what is in it. */
  private static typeOf(schema: any): string {
    if (schema.enum) return 'enum'
    const declared = Array.isArray(schema.type) ? schema.type.join('|') : schema.type
    if (declared !== 'array') return declared || ''

    const items = schema.items
    if (typeof items?.$ref === 'string' || items?.['x-silo-unresolved-ref']) return 'array<reference>'
    return items?.type ? `array<${items.type}>` : 'array'
  }

  /** `min 3`, or nothing when the keyword is absent. Typed rather than truthy,
   *  because `0` is a bound somebody set and `minimum: 0` is a common one. The
   *  unit is singular where the count it measures is one. */
  private static number(value: unknown, label: string, unit = ''): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return ''
    if (!unit) return `${label} ${value}`
    return `${label} ${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`
  }
}
