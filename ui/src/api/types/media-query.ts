/** The search a media listing runs (D23). */
export interface MediaQuery {
  q?: string
  folder?: string
  recursive?: boolean
  type?: string
  tag?: string
  limit?: number
  offset?: number
  sort?: string
}
