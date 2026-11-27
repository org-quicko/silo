import type { SchemaField } from '../../schema/schema-field'

export interface SchemaDirtyCheck {
  isNew: boolean
  name: string
  text: string
  initialText: string
  fields: readonly SchemaField[]
  initialFields: readonly SchemaField[]
  auth: boolean
  initialAuth: boolean
  parsedOk: boolean
}

/**
 * Determines whether a collection schema editor has unsaved changes across
 * collection name (when creating), field list (including unnamed draft rows),
 * JSON text, read-access flag, and invalid JSON syntax.
 */
export class SchemaDirty {
  static check(input: SchemaDirtyCheck): boolean {
    if (input.isNew && input.name !== '') return true
    if (!input.parsedOk) return true
    if (input.auth !== input.initialAuth) return true
    if (input.text !== input.initialText) return true
    if (input.fields.length !== input.initialFields.length) return true
    return JSON.stringify(input.fields) !== JSON.stringify(input.initialFields)
  }
}
