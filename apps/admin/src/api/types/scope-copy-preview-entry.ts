/** One action in a page of scope-copy preview details. */
export interface ScopeCopyPreviewEntry {
  collection: string
  id?: string
  action: 'added' | 'updated' | 'deleted' | 'skipped'
}
