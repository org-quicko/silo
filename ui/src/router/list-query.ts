export interface ListQuery {
  q: string
  sort: string
  desc: boolean
  page: number
}

export const DEFAULT_LIST_QUERY: ListQuery = { q: '', sort: '$updated_at', desc: true, page: 1 }
