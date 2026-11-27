import type { RenameResult } from '../../../api/types/scope-record'

/**
 * Pure eligibility rules for two-step renames (`RenameForm` / `SchemaEditor`).
 *
 * Ensures an in-flight schema edit disables or discards any pending dry-run
 * preview rather than letting a stale confirmation dialog commit over dirty
 * changes.
 */
export class RenameEligibility {
  static shouldDiscardOpenPreview(options: {
    allowed: boolean
    busy: boolean
    hasPreview: boolean
  }): boolean {
    return !options.allowed && !options.busy && options.hasPreview
  }

  static isDialogVisible(options: {
    allowed: boolean
    busy: boolean
    hasPreview: boolean
  }): boolean {
    return options.hasPreview && (options.allowed || options.busy)
  }

  static canBeginCommit(options: {
    pending: string
    allowed: boolean
    canCommit?: () => boolean
  }): boolean {
    if (!options.pending || !options.allowed) return false
    return options.canCommit ? options.canCommit() : true
  }

  static async fetchPreviewIfAllowed(options: {
    isAllowed: () => boolean
    dryRun: () => Promise<RenameResult>
  }): Promise<RenameResult | null> {
    if (!options.isAllowed()) return null
    const result = await options.dryRun()
    if (!options.isAllowed()) return null
    return result
  }

  static async commitIfEligible(options: {
    pending: string
    isAllowed: () => boolean
    canCommit?: () => boolean
    execute: () => Promise<void>
  }): Promise<'committed' | 'ineligible'> {
    if (
      !RenameEligibility.canBeginCommit({
        pending: options.pending,
        allowed: options.isAllowed(),
        canCommit: options.canCommit,
      })
    ) {
      return 'ineligible'
    }
    await options.execute()
    return 'committed'
  }
}
