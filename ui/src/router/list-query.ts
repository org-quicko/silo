import { JsonPath } from '@silo/shared/json-path'

export interface ListQuery {
  q: string
  /** An RFC 9535 path (D29), e.g. `$.updated_at` or `$.data.title`. */
  sort: string
  desc: boolean
  page: number
}

export const DEFAULT_LIST_QUERY: ListQuery = { q: '', sort: JsonPath.UpdatedAt, desc: true, page: 1 }
