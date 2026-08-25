/** A collection the `@`-mention popup can scope to, and why it matched. */
export interface ScopeMatch {
  name: string
  count: number | null
  /** The field name that matched, when the collection matched by a field rather than by its own name. */
  matchedField: string | null
}

/**
 * Ranks collections for the `@`-mention popup (handoff 1f): name matches
 * first, then collections with a matching *field* name — `orders —
 * customer_id` for a query of `customer`, so a search for a familiar field
 * can find the collection that has it even when its own name doesn't say so.
 * Within each group, recency of visit wins, then alphabetical.
 */
export class ScopeMatcher {
  static rank(
    query: string,
    collections: readonly { name: string; count: number | null; schema?: any }[],
    recentOrder: readonly string[],
  ): ScopeMatch[] {
    const q = query.trim().toLowerCase()
    const byName: ScopeMatch[] = []
    const byField: ScopeMatch[] = []

    for (const c of collections) {
      if (q === '' || c.name.toLowerCase().includes(q)) {
        byName.push({ name: c.name, count: c.count, matchedField: null })
        continue
      }
      const props: string[] = c.schema?.properties ? Object.keys(c.schema.properties) : []
      const field = props.find((p) => p.toLowerCase().includes(q))
      if (field) byField.push({ name: c.name, count: c.count, matchedField: field })
    }

    const rank = (name: string) => {
      const i = recentOrder.indexOf(name)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const byRecencyThenName = (a: ScopeMatch, b: ScopeMatch) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)

    byName.sort(byRecencyThenName)
    byField.sort(byRecencyThenName)
    return [...byName, ...byField]
  }
}
