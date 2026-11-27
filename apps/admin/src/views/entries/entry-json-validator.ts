import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { ReservedFieldNames } from '@silo/shared/reserved-field-names'
import { SiloRef } from '@silo/shared/silo-ref'
import { JsonLocation } from '../../components/json/json-location'
import { JsonSyntax, type JsonDiagnostic } from '../../components/json/json-syntax'
import { MediaValue } from '../../forms/widgets/media-value'
import { EntryJsonDiagnosticMapper } from './entry-json-diagnostic-mapper'
import { EntryJsonDocument } from './entry-json-document'
import { EntryJsonSchema, type SchemaDialect } from './entry-json-schema'
import type { EntryJsonValidationResult } from './entry-json-validation-result'

export type {
  EntryJsonValidationKind,
  EntryJsonValidationResult,
} from './entry-json-validation-result'

/**
 * Validates raw entry JSON text against syntax, numeric safety, Silo's
 * reserved-field contract, and a strict client-side compilation of the
 * collection's schema (normalizing media URLs like the server write path).
 */
export class EntryJsonValidator {
  private readonly originalValidate: ValidateFunction | null = null
  private readonly strictValidate: ValidateFunction | null = null
  private readonly compileError: string | null = null
  private readonly uncheckedRefs: string[]

  constructor(collectionName: string, rawSchema: unknown) {
    const prepared = EntryJsonSchema.prepare(collectionName, rawSchema)
    this.uncheckedRefs = prepared.uncheckedRefs

    if (prepared.dialect === 'unsupported') {
      this.compileError =
        'Unsupported JSON Schema dialect; client-side JSON validation cannot run for this collection.'
      return
    }

    try {
      this.originalValidate = EntryJsonValidator.compile(
        prepared.dialect,
        prepared.rootUrl,
        prepared.originalRoot,
        prepared.originalBundled,
      )
      this.strictValidate = EntryJsonValidator.compile(
        prepared.dialect,
        prepared.rootUrl,
        prepared.strictRoot,
        prepared.strictBundled,
      )
    } catch (caught) {
      this.compileError =
        caught instanceof Error && caught.message
          ? `Schema validation unavailable: ${caught.message}`
          : 'Schema validation unavailable.'
    }
  }

  validate(text: string): EntryJsonValidationResult {
    const syntaxDiagnostic = JsonSyntax.diagnose(text, { allowEmpty: false })
    if (syntaxDiagnostic) {
      return {
        ok: false,
        kind: 'syntax',
        data: null,
        diagnostics: [syntaxDiagnostic],
        error: syntaxDiagnostic.message,
        unrepresentable: true,
        hasUnknownProperties: false,
        uncheckedRefs: this.uncheckedRefs,
      }
    }

    const unsafeNumbers = JsonLocation.findUnsafeNumbers(text)
    if (unsafeNumbers.length > 0) {
      return {
        ok: false,
        kind: 'document',
        data: null,
        diagnostics: unsafeNumbers,
        error: unsafeNumbers[0].message,
        unrepresentable: true,
        hasUnknownProperties: false,
        uncheckedRefs: this.uncheckedRefs,
      }
    }

    const document = EntryJsonDocument.parse(text)
    if (!document.ok) {
      const diagnostics = EntryJsonValidator.diagnoseDocumentError(text, document.error)
      return {
        ok: false,
        kind: 'document',
        data: null,
        diagnostics,
        error: document.error,
        unrepresentable: true,
        hasUnknownProperties: false,
        uncheckedRefs: this.uncheckedRefs,
      }
    }

    if (this.compileError || !this.originalValidate || !this.strictValidate) {
      return {
        ok: false,
        kind: 'schema_compile',
        data: document.data,
        diagnostics: [],
        error: this.compileError || 'Schema validation unavailable.',
        unrepresentable: false,
        hasUnknownProperties: false,
        uncheckedRefs: this.uncheckedRefs,
      }
    }

    // Mirror the server write path (`MediaRefs.canonicalize`) so absolute media
    // URLs returned on read satisfy `silo://media/` patterns without rewriting
    // the user's visible editor text.
    const candidate = MediaValue.canonicalize(document.data)
    const originalOk = Boolean(this.originalValidate(candidate))
    const originalErrors = [...(this.originalValidate.errors ?? [])]
    const strictOk = Boolean(this.strictValidate(candidate))
    const strictErrors = [...(this.strictValidate.errors ?? [])]

    let activeErrors: ErrorObject[]
    if (!originalOk && strictOk) {
      activeErrors = originalErrors
    } else if (!originalOk && !strictOk) {
      activeErrors = EntryJsonDiagnosticMapper.mergeErrors(originalErrors, strictErrors)
    } else if (!strictOk) {
      activeErrors = strictErrors
    } else {
      return {
        ok: true,
        kind: 'valid',
        data: document.data,
        diagnostics: [],
        error: null,
        unrepresentable: false,
        hasUnknownProperties: false,
        uncheckedRefs: this.uncheckedRefs,
      }
    }

    const location = JsonLocation.index(text)
    const mapped = EntryJsonDiagnosticMapper.mapAll(activeErrors, location)
    const summaryError =
      mapped.diagnostics.length > 0
        ? mapped.diagnostics[0].message
        : 'Entry does not match collection schema.'

    return {
      ok: false,
      kind: 'schema',
      data: document.data,
      diagnostics: mapped.diagnostics,
      error: summaryError,
      unrepresentable: false,
      hasUnknownProperties: mapped.hasUnknownProperties,
      uncheckedRefs: this.uncheckedRefs,
    }
  }

  private static compile(
    dialect: Exclude<SchemaDialect, 'unsupported'>,
    rootUrl: string,
    root: Record<string, unknown>,
    bundled: Map<string, Record<string, unknown>>,
  ): ValidateFunction {
    const AjvConstructor = dialect === '2020-12' ? Ajv2020 : Ajv
    const ajv = new AjvConstructor({
      allErrors: true,
      strict: false,
      verbose: true,
      ownProperties: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
    })
    addFormats(ajv)

    for (const [name, schema] of bundled.entries()) {
      ajv.addSchema(schema, SiloRef.url(name))
    }
    ajv.addSchema(root, rootUrl)

    const validate = ajv.getSchema(rootUrl)
    if (!validate) {
      throw new Error(`Failed to compile schema for ${rootUrl}`)
    }
    if ((validate as { $async?: boolean }).$async) {
      throw new Error('Async JSON Schema ($async) is not supported for client validation.')
    }
    return validate
  }

  private static diagnoseDocumentError(text: string, message: string): JsonDiagnostic[] {
    const location = JsonLocation.index(text)
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const reserved = ReservedFieldNames.presentIn(parsed)
        if (reserved.length > 0) {
          return reserved
            .map((key) =>
              location.diagnosticForKey(`/${JsonLocation.escapeSegment(key)}`, message),
            )
            .sort((left, right) => left.from - right.from || left.to - right.to)
        }
      }
    } catch {
      /* syntax error already handled above */
    }
    return [location.diagnosticForObjectAnchor('', message)]
  }
}
