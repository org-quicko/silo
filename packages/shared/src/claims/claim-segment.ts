/**
 * One scope segment of a claim, and every question anything asks about one.
 *
 * A segment is a **wildcard** (`*`), a **literal** id, or a **prefix pattern**
 * (`acme*`, D64). Matching them is done in six places: `ParsedClaim` (the
 * authority), the search access plan, the SQLite search predicate, the scan
 * searcher, the project visibility filter, and the admin's plugin-grant
 * narrowing. While a segment was only ever `*` or a literal, six copies of
 * `held === "*" || held === value` were each trivially right; with patterns the
 * rule stops being trivial, and six independently-written answers to a
 * non-trivial authorization question is six chances for one of them to be wrong
 * in the permissive direction. The codebase already refuses a second claim
 * *parser*; a second claim *matcher* is the same hazard one layer down.
 *
 * **Only a trailing `*` is a pattern**, and it needs at least three literal
 * characters in front of it. Two reasons, both about what can be reasoned
 * about. `covers` has to answer whether one grant contains another, which for
 * prefixes is a prefix test and for general globs is regex language
 * containment — decidable, but an authorizer nobody can read is worse than a
 * missing feature. And a one-character prefix is `*` wearing a disguise: it
 * reads as narrow on the page and grants nearly everything.
 */
export class ClaimSegment {
  static readonly Wildcard = "*";

  /** The shortest prefix a pattern may carry. See the class note. */
  static readonly MinimumPrefix = 3;

  static isWildcard(segment: string): boolean {
    return segment === ClaimSegment.Wildcard;
  }

  /** Whether the segment is a prefix pattern rather than `*` or a literal. */
  static isPattern(segment: string): boolean {
    return segment.length > 1 && segment.endsWith(ClaimSegment.Wildcard);
  }

  /** The literal part of a pattern: `acme*` → `acme`. */
  static prefixOf(segment: string): string {
    return segment.slice(0, -1);
  }

  /** Whether a held segment admits a concrete name. */
  static matches(held: string, value: string): boolean {
    if (ClaimSegment.isWildcard(held)) return true;
    if (ClaimSegment.isPattern(held)) return value.startsWith(ClaimSegment.prefixOf(held));
    return held === value;
  }

  /**
   * Whether a held segment covers a required one, where the requirement may
   * itself be wider than a name.
   *
   * Distinct from {@link matches} because delegation asks a different question:
   * `matches` compares a grant against a concrete thing, this compares a grant
   * against another grant. A held segment covers a required one exactly when
   * every name the requirement admits is a name the grant admits:
   *
   * - `*` covers everything, and nothing but `*` covers `*` — a named or
   *   patterned segment must never widen to a wildcard.
   * - `ac*` covers `acme`, and covers `acme*` because every name starting with
   *   `acme` starts with `ac`. It does **not** cover `a*`, which admits `ax`.
   * - a literal covers only itself.
   */
  static covers(held: string, required: string): boolean {
    if (ClaimSegment.isWildcard(held)) return true;
    if (ClaimSegment.isWildcard(required)) return false;

    if (ClaimSegment.isPattern(held)) {
      const prefix = ClaimSegment.prefixOf(held);
      // True for a literal requirement and for a narrower pattern alike: a
      // pattern's reach is bounded below by its own prefix, so a prefix that
      // starts with ours can admit nothing we do not.
      const floor = ClaimSegment.isPattern(required)
        ? ClaimSegment.prefixOf(required)
        : required;
      return floor.startsWith(prefix);
    }

    return held === required;
  }

  /**
   * A held segment narrowed by the concrete value a route asked about, or
   * `null` when the two cannot both be satisfied.
   *
   * Both directions matter for search: without the narrowing, a wider claim
   * would search outside the collection the caller named; without the
   * rejection, a claim for another project would widen a scoped search back
   * out.
   */
  static narrow(held: string, asked: string | undefined): string | null {
    if (asked === undefined) return held;
    if (ClaimSegment.isWildcard(held) || ClaimSegment.isPattern(held)) {
      return ClaimSegment.matches(held, asked) ? asked : null;
    }
    return held === asked ? held : null;
  }

  /**
   * The SQL that tests `column` against a held segment, or `null` when the
   * segment constrains nothing and the caller should emit no clause at all.
   *
   * Built here rather than at the query site so the search index cannot answer
   * a matching question differently from `ParsedClaim`. A plan that reads one
   * row too many is an authorization bug that no 403 will ever reveal.
   *
   * A pattern uses `GLOB`, not `LIKE`. `LIKE` is case-insensitive for ASCII by
   * default, which would quietly widen every pattern, and its `_` wildcard is a
   * character ids are allowed to contain — so it would need escaping to stay
   * correct. `GLOB` is case-sensitive and its metacharacters (`*`, `?`, `[`)
   * cannot appear in a validated prefix at all.
   */
  static sql(column: string, held: string): { clause: string; args: string[] } | null {
    if (ClaimSegment.isWildcard(held)) return null;
    if (ClaimSegment.isPattern(held)) {
      return { clause: `${column} GLOB ?`, args: [`${ClaimSegment.prefixOf(held)}*`] };
    }
    return { clause: `${column} = ?`, args: [held] };
  }
}
