/** The search a media listing runs (D23). */
export interface MediaQuery {
  q?: string
  folder?: string
  recursive?: boolean
  type?: string
  /** Exact file extension, no dot, e.g. "png" (D55). */
  ext?: string
  tag?: string
  /** Inclusive ISO-8601 bounds on `updated_at` (D55). */
  modifiedAfter?: string
  modifiedBefore?: string
  limit?: number
  offset?: number
  sort?: string
}
