// ValueTitle labels a composite value by its first filled field — the entry
// form's collapsed array-item headers and the entries table's cells both need
// to name an object the user can't see the inside of. The alternatives say
// nothing: RJSF titles array items "<array title>-<index>" (`faqs-1`), and
// String(value) on an object is "[object Object]".
export class ValueTitle {
  private static readonly maxLength = 90

  // of returns the value's label, or null when there is nothing to show yet
  // (a freshly added array item, or a value whose fields are all empty or
  // non-scalar).
  static of(schema: any, uiSchema: any, value: any): string | null {
    const scalar = ValueTitle.render(value)
    if (scalar) return scalar
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    for (const key of ValueTitle.fieldOrder(schema, uiSchema, value)) {
      const label = ValueTitle.render(value[key])
      if (label) return label
    }
    return null
  }

  // fieldOrder mirrors the order the form renders fields in, so "the first
  // field" means the one the user sees first, not the one JSON.stringify hit
  // first. Ordering directives may name fields that don't exist (and `*`),
  // so they filter against the schema's own properties. A schema that declares
  // no properties (additionalProperties, an unresolved ref) falls back to the
  // value's own keys — otherwise every such item would title as "Untitled".
  private static fieldOrder(schema: any, uiSchema: any, value: any): string[] {
    const declared = Object.keys(schema?.properties || {})
    const props = declared.length > 0 ? declared : Object.keys(value)
    const order = uiSchema?.['ui:order'] ?? schema?.['x-silo-ui']?.order
    if (!Array.isArray(order)) return props
    const named = order.filter((k: unknown): k is string => typeof k === 'string' && props.includes(k))
    return [...named, ...props.filter((k) => !named.includes(k))]
  }

  // render accepts scalars only: an object or array in the first slot is not a
  // title, and stringifying one would fill the header with JSON.
  private static render(value: any): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed ? ValueTitle.truncate(trimmed) : null
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return null
  }

  private static truncate(text: string): string {
    return text.length > ValueTitle.maxLength ? `${text.slice(0, ValueTitle.maxLength - 1)}…` : text
  }
}
