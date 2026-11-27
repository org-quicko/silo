import { MediaField } from '@silo/shared/media-field'
import { SchemaDeref } from '../../schema/schema-deref'
import { SchemaType } from '../../schema/schema-type'

export interface FormCompatibilityResult {
  ok: boolean
  error: string | null
}

/**
 * Checks whether parsed entry data can safely render in RJSF Form mode without
 * triggering widget crashes (such as object values in `MediaWidget` or
 * `TagsWidget`) or structural mismatches that Form controls cannot represent.
 */
export class FormCompatibility {
  static check(data: unknown, formSchema: any, uiSchema: any): FormCompatibilityResult {
    return FormCompatibility.visit(data, formSchema, uiSchema, formSchema, [])
  }

  private static visit(
    value: unknown,
    schema: any,
    ui: any,
    rootSchema: any,
    path: readonly (string | number)[],
  ): FormCompatibilityResult {
    if (value === undefined || value === null) return { ok: true, error: null }
    if (!schema || typeof schema !== 'object') return { ok: true, error: null }
    if (ui?.['ui:field'] === 'json') return { ok: true, error: null }

    let resolved = schema
    if (typeof resolved.$ref === 'string') {
      const target = resolved.$ref.startsWith('#') ? SchemaDeref.local(resolved.$ref, rootSchema) : null
      if (!target || typeof target !== 'object') return { ok: true, error: null }
      resolved = target
    }

    const type = SchemaType.of(resolved)
    const label = path.length > 0 ? path.join('.') : 'entry'

    if (
      ui?.['ui:widget'] === 'media' ||
      MediaField.is(resolved) ||
      resolved['x-silo-media'] === true
    ) {
      if (typeof value !== 'string') {
        return {
          ok: false,
          error: `Field "${label}" must be a media URL string or null to switch to Form mode.`,
        }
      }
      return { ok: true, error: null }
    }

    if (ui?.['ui:widget'] === 'tags') {
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: `Field "${label}" must be an array of strings to switch to Form mode.`,
        }
      }
      for (let index = 0; index < value.length; index++) {
        const item = value[index]
        if (item !== null && item !== undefined && typeof item === 'object') {
          return {
            ok: false,
            error: `Field "${label}[${index}]" contains an object or array that cannot be edited in the tags control; fix it in JSON first.`,
          }
        }
      }
      return { ok: true, error: null }
    }

    if (type === 'object' && resolved.properties && typeof resolved.properties === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return {
          ok: false,
          error: `Field "${label}" must be a JSON object to switch to Form mode.`,
        }
      }
      const record = value as Record<string, unknown>
      for (const [key, propSchema] of Object.entries(resolved.properties)) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue
        const childResult = FormCompatibility.visit(
          record[key],
          propSchema,
          ui?.[key],
          rootSchema,
          [...path, key],
        )
        if (!childResult.ok) return childResult
      }
      return { ok: true, error: null }
    }

    if (type === 'array') {
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: `Field "${label}" must be a JSON array to switch to Form mode.`,
        }
      }
      if (resolved.items && typeof resolved.items === 'object' && !Array.isArray(resolved.items)) {
        for (let index = 0; index < value.length; index++) {
          const itemResult = FormCompatibility.visit(
            value[index],
            resolved.items,
            ui?.items,
            rootSchema,
            [...path, index],
          )
          if (!itemResult.ok) return itemResult
        }
      }
      return { ok: true, error: null }
    }

    if (
      (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean') &&
      typeof value === 'object'
    ) {
      return {
        ok: false,
        error: `Field "${label}" contains an object or array that cannot be rendered in its Form input; fix it in JSON first.`,
      }
    }

    return { ok: true, error: null }
  }
}
