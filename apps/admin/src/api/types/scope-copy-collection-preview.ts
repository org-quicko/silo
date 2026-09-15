/** A collection's schema outcome and planned entry totals in a dry-run. */
export interface ScopeCopyCollectionPreview {
  collection: string
  schema: 'create' | 'update' | 'unchanged'
  added: number
  updated: number
  deleted: number
  skipped: number
}
