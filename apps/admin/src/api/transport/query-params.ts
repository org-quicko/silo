/** Builds a query string, omitting anything the caller left undefined. */
export class QueryParams {
  private readonly params = new URLSearchParams()

  set(name: string, value: string | number | boolean | undefined | null): this {
    if (value === undefined || value === null || value === '') return this
    this.params.set(name, String(value))
    return this
  }

  /** For a value that is meaningful even when empty — `folder=""` is the
   *  library root, not "no folder filter". */
  setEvenIfEmpty(name: string, value: string | undefined): this {
    if (value === undefined) return this
    this.params.set(name, value)
    return this
  }

  json(name: string, value: unknown): this {
    if (value === undefined || value === null) return this
    this.params.set(name, JSON.stringify(value))
    return this
  }

  /** `"?a=1&b=2"`, or the empty string when nothing was set. */
  toString(): string {
    const query = this.params.toString()
    return query ? `?${query}` : ''
  }
}
