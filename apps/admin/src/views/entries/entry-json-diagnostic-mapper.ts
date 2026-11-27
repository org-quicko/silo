import type { ErrorObject } from 'ajv'
import { JsonLocation } from '../../components/json/json-location'
import type { JsonDiagnostic } from '../../components/json/json-syntax'

/**
 * Merges authored and strict Ajv errors (suppressing false `unevaluatedProperties`
 * errors when a failing `oneOf`/`anyOf` branch already declares the property) and
 * maps each Ajv error to an exact `JsonLocation` diagnostic.
 */
export class EntryJsonDiagnosticMapper {
  static mergeErrors(
    originalErrors: readonly ErrorObject[],
    strictErrors: readonly ErrorObject[],
  ): ErrorObject[] {
    const failedUnionParents = new Map<string, Record<string, unknown>[]>()
    for (const err of originalErrors) {
      if ((err.keyword === 'oneOf' || err.keyword === 'anyOf') && err.parentSchema) {
        const list = failedUnionParents.get(err.instancePath) ?? []
        list.push(err.parentSchema as Record<string, unknown>)
        failedUnionParents.set(err.instancePath, list)
      }
    }

    const merged: ErrorObject[] = [...originalErrors]
    const seen = new Set(originalErrors.map((err) => EntryJsonDiagnosticMapper.errorKey(err)))

    for (const err of strictErrors) {
      if (err.keyword !== 'additionalProperties' && err.keyword !== 'unevaluatedProperties') {
        continue
      }
      if (err.keyword === 'unevaluatedProperties') {
        const propName = EntryJsonDiagnosticMapper.unknownPropertyName(err)
        const unionSchemas = failedUnionParents.get(err.instancePath)
        if (
          propName !== null &&
          unionSchemas &&
          unionSchemas.some((schema) =>
            EntryJsonDiagnosticMapper.unionDeclaresProperty(schema, propName, new Set()),
          )
        ) {
          continue
        }
      }
      const key = EntryJsonDiagnosticMapper.errorKey(err)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(err)
      }
    }
    return merged
  }

  static mapAll(
    errors: readonly ErrorObject[],
    location: JsonLocation,
  ): { diagnostics: JsonDiagnostic[]; hasUnknownProperties: boolean } {
    let hasUnknownProperties = false
    const seen = new Set<string>()
    const diagnostics: JsonDiagnostic[] = []

    for (const err of errors) {
      const mapped = EntryJsonDiagnosticMapper.mapOne(err, location)
      if (mapped.unknownProperty) hasUnknownProperties = true
      const dedupeKey = `${mapped.diagnostic.from}:${mapped.diagnostic.to}:${mapped.diagnostic.message}`
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        diagnostics.push(mapped.diagnostic)
      }
    }

    diagnostics.sort((left, right) => left.from - right.from || left.to - right.to)
    return { diagnostics, hasUnknownProperties }
  }

  private static mapOne(
    err: ErrorObject,
    location: JsonLocation,
  ): { diagnostic: JsonDiagnostic; unknownProperty: boolean } {
    const params = (err.params ?? {}) as Record<string, unknown>
    const pathPrefix = err.instancePath ? `${err.instancePath}: ` : ''

    if (err.keyword === 'additionalProperties' || err.keyword === 'unevaluatedProperties') {
      const unknownName = EntryJsonDiagnosticMapper.unknownPropertyName(err)
      if (unknownName !== null) {
        const targetPointer = `${err.instancePath}/${JsonLocation.escapeSegment(unknownName)}`
        const message = `${pathPrefix}Unknown field "${unknownName}" is not allowed by this schema`
        return {
          diagnostic: location.diagnosticForKey(targetPointer, message),
          unknownProperty: true,
        }
      }
      return {
        diagnostic: location.diagnosticForObjectAnchor(
          err.instancePath,
          `${pathPrefix}Unknown fields are not allowed by this schema`,
        ),
        unknownProperty: true,
      }
    }

    if (typeof err.propertyName === 'string') {
      const targetPointer = `${err.instancePath}/${JsonLocation.escapeSegment(err.propertyName)}`
      return {
        diagnostic: location.diagnosticForKey(
          targetPointer,
          `${pathPrefix}Property name ${JSON.stringify(err.propertyName)} ${err.message || 'is invalid'}`,
        ),
        unknownProperty: false,
      }
    }

    if (
      err.keyword === 'propertyNames' &&
      Object.prototype.hasOwnProperty.call(params, 'propertyName')
    ) {
      const badName = String(params.propertyName)
      const targetPointer = `${err.instancePath}/${JsonLocation.escapeSegment(badName)}`
      return {
        diagnostic: location.diagnosticForKey(
          targetPointer,
          `${pathPrefix}Property name "${badName}" does not match schema constraints`,
        ),
        unknownProperty: false,
      }
    }

    if (err.keyword === 'required') {
      const missingName = Object.prototype.hasOwnProperty.call(params, 'missingProperty')
        ? String(params.missingProperty)
        : null
      const message =
        missingName !== null
          ? `${pathPrefix}Missing required field "${missingName}"`
          : `${pathPrefix}${err.message || 'Missing required field'}`
      return {
        diagnostic: location.diagnosticForObjectAnchor(err.instancePath, message),
        unknownProperty: false,
      }
    }

    const message = EntryJsonDiagnosticMapper.formatAjvMessage(err, pathPrefix)
    return {
      diagnostic: location.diagnosticForValue(err.instancePath, message),
      unknownProperty: false,
    }
  }

  private static unknownPropertyName(err: ErrorObject): string | null {
    const params = (err.params ?? {}) as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(params, 'additionalProperty')) {
      return String(params.additionalProperty)
    }
    if (Object.prototype.hasOwnProperty.call(params, 'unevaluatedProperty')) {
      return String(params.unevaluatedProperty)
    }
    return null
  }

  private static unionDeclaresProperty(
    node: unknown,
    propName: string,
    visited: Set<unknown>,
  ): boolean {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    if (visited.has(node)) return false
    visited.add(node)

    const record = node as Record<string, unknown>
    if (
      record.properties &&
      typeof record.properties === 'object' &&
      !Array.isArray(record.properties) &&
      Object.prototype.hasOwnProperty.call(record.properties, propName)
    ) {
      return true
    }

    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      if (Array.isArray(record[key])) {
        if (
          record[key].some((branch) =>
            EntryJsonDiagnosticMapper.unionDeclaresProperty(branch, propName, visited),
          )
        ) {
          return true
        }
      }
    }
    return false
  }

  private static errorKey(err: ErrorObject): string {
    const params = (err.params ?? {}) as Record<string, unknown>
    const prop =
      err.propertyName ??
      params.additionalProperty ??
      params.unevaluatedProperty ??
      params.missingProperty ??
      params.propertyName ??
      ''
    return `${err.instancePath}:${err.keyword}:${String(prop)}`
  }

  private static formatAjvMessage(err: ErrorObject, pathPrefix: string): string {
    const params = (err.params ?? {}) as Record<string, unknown>
    if (err.keyword === 'enum' && Array.isArray(params.allowedValues)) {
      const choices = params.allowedValues.map((value) => JSON.stringify(value)).join(', ')
      return `${pathPrefix}must be one of: ${choices}`
    }
    if (err.keyword === 'const' && Object.prototype.hasOwnProperty.call(params, 'allowedValue')) {
      return `${pathPrefix}must equal ${JSON.stringify(params.allowedValue)}`
    }
    if (err.keyword === 'format' && typeof params.format === 'string') {
      return `${pathPrefix}must match format "${params.format}"`
    }
    return `${pathPrefix}${err.message || 'Schema validation failed'}`
  }
}
