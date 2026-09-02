/**
 * The collection schema as the *form* has to see it.
 *
 * One property shape never reached the form at all: the one that declares
 * nothing. `{}` is the honest schema for a value that may be anything — it is
 * what a Strapi `json` column imports as, and what the schema editor's `any`
 * kind saves — and RJSF returns `null` for a schema with no keywords, before
 * `ui:field` is even read. So the field was not rendered, not editable, and not
 * visible as missing either: an entry whose only property was a JSON column
 * opened as a blank page.
 *
 * Rather than teach the form a second way to spell "raw JSON", this writes the
 * meaning down in the vocabulary it already reads. `buildUiSchema` routes
 * `x-silo-ui.widget: "json"` to the JSON field, and stamping it here makes the
 * schema non-empty in the same stroke, so the property survives to be rendered
 * by it.
 */
export class FormSchema {
  /** Silo's UI hint keyword, which the schema is free to carry already. */
  private static readonly UiKeyword = 'x-silo-ui'

  /**
   * Keywords the form can draw a control from. A property carrying none of
   * them constrains nothing, which is a real state and not a malformed one.
   */
  private static readonly Controls = [
    'type',
    'enum',
    'const',
    '$ref',
    'oneOf',
    'anyOf',
    'allOf',
    'properties',
    'items',
  ]

  /** The schema with every "anything goes" property marked for the JSON field,
   *  at any depth — a JSON column inside a component is as common as one at the
   *  top. */
  static forEntry(schema: any): any {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema

    const out: any = { ...schema }
    if (schema.properties && typeof schema.properties === 'object') {
      out.properties = FormSchema.each(schema.properties)
    }
    if (schema.$defs && typeof schema.$defs === 'object') {
      out.$defs = FormSchema.each(schema.$defs)
    }
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      out.items = FormSchema.property(schema.items)
    }
    return out
  }

  private static each(node: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(node).map(([name, property]) => [name, FormSchema.property(property)]),
    )
  }

  private static property(property: any): any {
    if (!property || typeof property !== 'object' || Array.isArray(property)) return property
    if (!FormSchema.isAny(property)) return FormSchema.forEntry(property)
    return {
      ...property,
      [FormSchema.UiKeyword]: { ...(property[FormSchema.UiKeyword] || {}), widget: 'json' },
    }
  }

  private static isAny(property: any): boolean {
    return !FormSchema.Controls.some((keyword) => keyword in property)
  }
}
