import { ClaimSegment } from '@silo/shared/claim-segment'
import { Claims } from '@silo/shared/claims'

/**
 * One project/environment pair a key's collection claims target, with either
 * segment allowed to be the wildcard.
 *
 * This replaces the four-option `KeyReach` the form used to carry. The claim
 * grammar wildcards each segment independently (D19), so the four reaches were
 * only ever the four combinations of two binary choices — and naming them
 * meant a key could target one scope and no more. A *list* of these says
 * everything the old type said and also says "acme/prod and beta/prod", which
 * previously took two keys or a hand-written claim list.
 */
export interface KeyScope {
  /** A project id, or `*` for every project. */
  project: string
  /** An environment id, or `*` for every environment. */
  env: string
}

/** Reading, comparing and describing one scope row. */
export class KeyScopes {
  static readonly Any = Claims.Root

  static isAny(segment: string): boolean {
    return segment === KeyScopes.Any
  }

  /** Whether both segments have been answered. They are blank for a beat on
   *  first paint, and a blank segment composes a claim `normalize` rejects. */
  static complete(scope: KeyScope): boolean {
    return scope.project.length > 0 && scope.env.length > 0
  }

  /** `acme/prod`, the form a claim target is spelled in. */
  static target(scope: KeyScope, collection: string): string {
    return `${scope.project}/${scope.env}/${collection}`
  }

  /** `acme / prod`, `every project / prod`, for headings and summaries. */
  static describe(scope: KeyScope): string {
    const name = (value: string, plural: string) => {
      if (KeyScopes.isAny(value)) return plural
      // A prefix (D64) is spelled out for the reason `ClaimGroups` spells it
      // out: `acme*` in a heading reads as one project and means a namespace.
      if (ClaimSegment.isPattern(value)) return `${plural} starting ${ClaimSegment.prefixOf(value)}`
      return value || '…'
    }
    return `${name(scope.project, 'every project')} / ${name(scope.env, 'every environment')}`
  }

  static same(left: KeyScope, right: KeyScope): boolean {
    return left.project === right.project && left.env === right.env
  }

  /** Deduplicated, in the order they were added. Two rows naming the same scope
   *  would double every claim they produce and read as a mistake in the
   *  review, which is the one place the list has to be trustworthy. */
  static unique(scopes: readonly KeyScope[]): KeyScope[] {
    const seen: KeyScope[] = []
    for (const scope of scopes) {
      if (!seen.some((held) => KeyScopes.same(held, scope))) seen.push(scope)
    }
    return seen
  }
}
