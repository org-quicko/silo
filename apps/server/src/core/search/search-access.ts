import type { SearchTarget } from "./search-target";

/**
 * What a request is allowed to search, compiled from claims **before** the
 * query runs (D30).
 *
 * The engine receives this and never a claim string: the claim grammar belongs
 * to `@silo/shared`, and an adapter that parsed it would become a second
 * enforcement point that can disagree with the first. Targets are also the
 * only shape that can carry the anonymous case, where readability comes from a
 * schema's `x-silo-auth` rather than from any claim.
 *
 * An empty target list denies everything. That is the correct reading of "this
 * key holds no entry-read claim", and it makes the deny path the default
 * rather than something a caller must remember to write.
 */
export interface SearchAccess {
  targets: SearchTarget[];
}
