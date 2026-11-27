import type { ValidationDetail } from '@silo/shared/validation-detail'
import { ConflictError } from '../../api/api-error'
import type { Entry } from '../../api/types/entry'
import { EntryJsonDocument } from './entry-json-document'
import type { EntryJsonValidationResult } from './entry-json-validator'
import { FormCompatibility } from './form-compatibility'

export type EntryEditorMode = 'form' | 'json'

export interface EntryBaselineSnapshot {
  data: Record<string, any>
  rev: number | null
  serverJson: string | null
}

export type ModeSwitchResult =
  | { ok: true; action: 'noop' }
  | { ok: true; action: 'toJson' }
  | { ok: true; action: 'toForm'; data: Record<string, any> }
  | { ok: false; target: 'mediaUpload' | 'jsonField' | 'jsonEditor'; error: string }

/**
 * Tracks the atomic `(data, rev)` baseline for `EntryForm`, detects stale
 * revisions when SWR refreshes behind a dirty draft, validates mode switches,
 * configures RJSF default behavior, and checks JSON/form dirty state without
 * clobbering explicit `null` values or reordering false positives.
 */
export class EntryBaseline {
  static create(entry: Entry | null): EntryBaselineSnapshot {
    if (!entry) {
      return { data: {}, rev: null, serverJson: null }
    }
    return {
      data: entry.data ?? {},
      rev: entry.rev,
      serverJson: JSON.stringify(entry.data ?? {}),
    }
  }

  /**
   * Populates schema defaults only for untouched brand-new entries. Existing
   * entries and forms returning from edited JSON keep `{}` intact instead of
   * synthesizing `default` or `const` defaults into empty objects.
   */
  static defaultFormStateBehavior(hasEntry: boolean, hasEditedJson: boolean) {
    const skip = hasEntry || hasEditedJson
    return {
      arrayMinItems: { populate: 'never' as const },
      emptyObjectFields: (skip ? 'skipDefaults' : 'populateAllDefaults') as
        | 'skipDefaults'
        | 'populateAllDefaults',
      constAsDefaults: (skip ? 'never' : 'always') as 'never' | 'always',
    }
  }

  static planModeSwitch(options: {
    from: EntryEditorMode
    to: EntryEditorMode
    mediaUploading?: boolean
    invalidJsonFieldCount: number
    jsonText: string
    validation?: EntryJsonValidationResult
    canSave?: boolean
    formSchema?: any
    uiSchema?: any
  }): ModeSwitchResult {
    if (options.from === options.to) return { ok: true, action: 'noop' }
    if (options.to === 'json') {
      if (options.mediaUploading) {
        return {
          ok: false,
          target: 'mediaUpload',
          error: 'Wait for the media upload to finish before saving.',
        }
      }
      if (options.invalidJsonFieldCount > 0) {
        return {
          ok: false,
          target: 'jsonField',
          error: 'Fix invalid JSON fields before switching to JSON mode.',
        }
      }
      return { ok: true, action: 'toJson' }
    }

    if (options.validation) {
      if (
        options.validation.kind === 'syntax' ||
        options.validation.kind === 'document' ||
        options.validation.data === null
      ) {
        return {
          ok: false,
          target: 'jsonEditor',
          error: options.validation.error || 'Invalid JSON',
        }
      }

      if (options.canSave !== false) {
        if (options.validation.hasUnknownProperties) {
          return {
            ok: false,
            target: 'jsonEditor',
            error: 'Remove unknown fields not declared in the schema before switching to Form mode.',
          }
        }
        if (options.formSchema && options.uiSchema) {
          const compatibility = FormCompatibility.check(
            options.validation.data,
            options.formSchema,
            options.uiSchema,
          )
          if (!compatibility.ok) {
            return {
              ok: false,
              target: 'jsonEditor',
              error: compatibility.error || 'Value cannot be edited in Form mode.',
            }
          }
        }
      }

      return { ok: true, action: 'toForm', data: options.validation.data }
    }

    const parsed = EntryJsonDocument.parse(options.jsonText)
    if (!parsed.ok) {
      return { ok: false, target: 'jsonEditor', error: parsed.error }
    }
    return { ok: true, action: 'toForm', data: parsed.data }
  }

  /**
   * Key-order-insensitive JSON equality that omits `undefined` object
   * properties (matching `JSON.stringify` semantics) while strictly
   * distinguishing explicit `null` values from omitted keys.
   */
  static isDataEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
      return false
    }

    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false
      }
      for (let index = 0; index < left.length; index++) {
        const leftItem = left[index] === undefined ? null : left[index]
        const rightItem = right[index] === undefined ? null : right[index]
        if (!EntryBaseline.isDataEqual(leftItem, rightItem)) return false
      }
      return true
    }

    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined)
    const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightRecord, key) || rightRecord[key] === undefined) {
        return false
      }
      if (!EntryBaseline.isDataEqual(leftRecord[key], rightRecord[key])) return false
    }
    return true
  }

  static isDirty(options: {
    formData: unknown
    baselineData: unknown
    mode: EntryEditorMode
    invalidJsonFieldCount: number
    jsonError?: string | null
    jsonUnrepresentable?: boolean
  }): boolean {
    if (options.invalidJsonFieldCount > 0) return true
    const unrepresentable =
      options.jsonUnrepresentable !== undefined
        ? options.jsonUnrepresentable
        : options.mode === 'json' && options.jsonError !== null && options.jsonError !== undefined
    if (options.mode === 'json' && unrepresentable) return true
    return !EntryBaseline.isDataEqual(options.formData, options.baselineData)
  }

  static shouldAdoptServerEntry(options: {
    entry: Entry | null
    dirty: boolean
    mediaUploading?: boolean
    baselineRev: number | null
    lastServerJson: string | null
  }): boolean {
    if (!options.entry || options.dirty || options.mediaUploading) return false
    if (options.baselineRev !== options.entry.rev) return true
    return JSON.stringify(options.entry.data ?? {}) !== options.lastServerJson
  }

  static isStale(entry: Entry | null, baselineRev: number | null): boolean {
    return Boolean(entry && baselineRev !== null && entry.rev > baselineRev)
  }

  static isConflictError(caught: unknown): boolean {
    if (caught instanceof ConflictError) return true
    return (
      typeof caught === 'object' &&
      caught !== null &&
      'status' in caught &&
      (caught as { status?: unknown }).status === 409
    )
  }

  /** Converts server `ValidationDetail` pointers into RJSF `extraErrors`. */
  static toExtraErrors(details?: ValidationDetail[]): Record<string, unknown> {
    const root: Record<string, any> = {}
    for (const detail of details || []) {
      const parts = detail.path.split('/').filter(Boolean)
      let node = root
      if (parts.length === 0) {
        node.__errors = [...(node.__errors || []), detail.message]
        continue
      }
      for (let index = 0; index < parts.length; index++) {
        const key = parts[index]
        node[key] = node[key] || {}
        node = node[key]
      }
      node.__errors = [...(node.__errors || []), detail.message]
    }
    return root
  }

  static formatValidationDetails(details?: ValidationDetail[]): string {
    if (!details || details.length === 0) return 'Validation failed.'
    return details.map((detail) => `${detail.path || '/'}: ${detail.message}`).join(' · ')
  }
}
