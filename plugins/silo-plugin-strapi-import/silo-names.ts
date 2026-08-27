import type { StrapiList } from './strapi-inventory'

/**
 * Names silo will accept, and the one this importer proposes for a Strapi list.
 *
 * Both halves live together because the second is only useful if it satisfies
 * the first: a suggestion an operator has to fix before the plan will run is
 * worse than no suggestion. The rule itself is silo's — `Scope.IdPattern` — and
 * is restated here rather than imported, because a plugin depends on silo's HTTP
 * surface and not on its source.
 */
export class SiloNames {
  /** `Scope.IdPattern`. Checked here so a plan is refused by the plugin naming
   *  the field, rather than by the first write. */
  static readonly Pattern = /^[a-z][a-z0-9_-]{0,63}$/
  static readonly MaxLength = 64

  /** What a *suggestion* may not contain. Never applied to what an operator
   *  typed: that is `Pattern`'s to accept or refuse whole. */
  private static readonly Disallowed = /[^a-z0-9_-]+/g

  /**
   * The proposed collection name for one list: the source's own uid, carried
   * whole rather than shortened to its last segment.
   *
   * The component's uid and not the content type's, because `org-quicko.bank`
   * inside `Org-quicko-bank` is the thing being imported and the wrapper single
   * type is Strapi's way of holding a table rather than part of what it holds.
   *
   * Whole, because the namespace is the half that makes the name a name.
   * `org-quicko.bank` shortened to `bank` proposes the one collection every other
   * import will also want, in an instance where collections are flat and Strapi's
   * are not — and Strapi namespaces components precisely because two of them are
   * called the same short word.
   */
  static forList(list: StrapiList): string {
    const source = list.component ?? list.contentType
    // `api::` is Strapi's plumbing rather than part of the name. A component's
    // namespace is the opposite of that, and is kept.
    const segments = source.replace(/^[A-Za-z0-9_-]+::/, '').split('.')

    const parts: string[] = []
    for (const segment of segments) {
      // A repeat is dropped: `api::article.article` names one thing twice and
      // would read `article-article`, while `api::blog.article` is two names and
      // keeps both.
      const part = SiloNames.slug(segment)
      if (part.length > 0 && part !== parts[parts.length - 1]) parts.push(part)
    }

    // Capped here as well as in `fit`: `forList` is a proposal on its own, and a
    // proposal silo would refuse is not one.
    const name = SiloNames.trim(parts.join('-').slice(0, SiloNames.MaxLength))
    return name || 'imported'
  }

  /** `name`, or the next spelling of it nothing has taken. */
  static unique(name: string, taken: Set<string>): string {
    let candidate = SiloNames.fit(name, 0)
    let suffix = 2
    while (taken.has(candidate)) candidate = SiloNames.fit(name, suffix++)
    taken.add(candidate)
    return candidate
  }

  /** `raw` if silo would accept it as an id, or a refusal naming the field. */
  static check(raw: unknown, what: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${what} must be a non-empty string`)
    }
    const value = raw.trim()
    if (!SiloNames.Pattern.test(value)) {
      throw new Error(
        `${what} "${value}" is not a usable name — silo wants a lowercase letter first, then ` +
          `letters, digits, "_" or "-", up to ${SiloNames.MaxLength} characters`,
      )
    }
    return value
  }

  /** One uid segment as a name silo would accept a part of. */
  private static slug(segment: string): string {
    return segment.toLowerCase().replace(SiloNames.Disallowed, '-').replace(/^-+|-+$/g, '')
  }

  /** `name` with a disambiguating suffix, trimmed so the two together are still
   *  a length silo accepts. The configured prefix and the uid are both the
   *  operator's, and neither knows about the other. */
  private static fit(name: string, suffix: number): string {
    const tail = suffix === 0 ? '' : `_${suffix}`
    return SiloNames.trim(name.slice(0, SiloNames.MaxLength - tail.length)) + tail
  }

  /** Leading, because silo wants a letter first; trailing, because a slice can
   *  land mid-separator. */
  private static trim(name: string): string {
    return name.replace(/^[^a-z]+/, '').replace(/[-_]+$/, '')
  }
}
