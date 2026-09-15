import type { ScopeCopyCollectionPreview } from './scope-copy-collection-preview'
import type { ScopeCopyPreviewEntry } from './scope-copy-preview-entry'

/** The bounded collection and entry detail a scope-copy dry-run returns. */
export interface ScopeCopyPreview {
  collections: ScopeCopyCollectionPreview[]
  entries: ScopeCopyPreviewEntry[]
  total: number
  offset: number
  limit: number
}
