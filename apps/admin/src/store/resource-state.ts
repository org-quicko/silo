/**
 * What the store knows about one cache key: the server's last answer, whether
 * a request for it is in flight, and how the last one failed.
 *
 * A failed reload keeps the value it had — `value` is `null` only while nothing
 * has ever loaded — so a view stays readable with the error reported beside it
 * rather than emptying itself over a dropped connection.
 */
export interface ResourceState<T> {
  value: T | null
  loading: boolean
  error: string | null
  /** `Date.now()` of the last successful load; `0` when there has been none. */
  loadedAt: number
}
