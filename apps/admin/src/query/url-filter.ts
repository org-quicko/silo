import type { Filter } from '@silo/shared/filter'

/** A filter read out of the URL: one of the two, never both. */
export interface ParsedFilter {
  filter: Filter | null
  error: string | null
}

/**
 * The Query AST's round trip through the address bar.
 *
 * It travels as raw JSON text and is parsed here, at the view, rather than in
 * the router — because the answer to "this text is not a filter" has to be
 * *shown*, and a router that silently returned `null` would leave the page
 * listing everything under a URL that says it is filtered.
 */
export class UrlFilter {
  static parse(raw: string | null): ParsedFilter {
    if (!raw) return { filter: null, error: null }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.op !== 'string') {
        return { filter: null, error: 'The filter in this link is not a filter expression.' }
      }
      return { filter: parsed as Filter, error: null }
    } catch {
      return { filter: null, error: 'The filter in this link could not be read.' }
    }
  }

  /** `null` for an absent filter, so the URL simply omits the parameter. */
  static stringify(filter: Filter | null): string | null {
    return filter ? JSON.stringify(filter) : null
  }
}
