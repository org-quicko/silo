import type { JsonDiagnostic } from '../../components/json/json-syntax'

export type EntryJsonValidationKind =
  | 'valid'
  | 'syntax'
  | 'document'
  | 'schema'
  | 'schema_compile'

export interface EntryJsonValidationResult {
  ok: boolean
  kind: EntryJsonValidationKind
  data: Record<string, any> | null
  diagnostics: JsonDiagnostic[]
  error: string | null
  /** True when text cannot produce a safe, reserved-key-free plain entry object. */
  unrepresentable: boolean
  /** True when strict validation flagged genuinely undeclared object keys. */
  hasUnknownProperties: boolean
  /** Remote or missing `$ref` targets left unchecked locally. */
  uncheckedRefs: string[]
}
