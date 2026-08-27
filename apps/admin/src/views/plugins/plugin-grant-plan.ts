import { Claims } from '@silo/shared/claims'
import { HookNames } from '@silo/shared/hook-names'
import type { ParsedClaim } from '@silo/shared/parsed-claim'
import type { PluginView } from '../../api/types/plugin-view'
import { ClaimWords } from '../../claims/claim-words'

/**
 * How much of one requested claim the plugin holds.
 *
 * Three values and not two, because narrowing is the normal answer to a
 * wildcard request and a boolean has to call it "no". A plugin asking for
 * `collections:*&#47;*&#47;*:entries:create` and granted `default&#47;prod` has been
 * answered — reporting that as ungranted would make a form say "this plugin can
 * do nothing" immediately after approving it, which is what it did.
 */
export type PluginClaimStatus = 'granted' | 'narrowed' | 'none'

/** One requested claim, as the grant form has to present it. */
export interface PluginClaimRow {
  claim: string
  /** What it means, or `null` when nothing has words for it — in which case
   *  the raw string is what gets shown. */
  phrase: string | null
  /** How much of it the plugin holds, from either grant path. */
  held: PluginClaimStatus
  /** The claims actually held under this request, when they are narrower than
   *  it. Empty otherwise — including when the request is held in full, where
   *  the request itself is the answer. */
  actual: string[]
  /** Why this claim can never be granted to a plugin, or `''`. */
  forbidden: string
  /** Whether the current key could delegate it. */
  delegable: boolean
  /** Whether being delivered this hook lets the plugin change or stop a write.
   *  `false` for every non-hook claim. */
  intervening: boolean

  /** Whether the package says it cannot work without this claim (D36). */
  required: boolean

  /**
   * Why the package says it wants it, in the author's words, or `null`.
   *
   * The one thing on this screen that is not silo talking. An operator weighing
   * `collections:*&#47;*&#47;*:entries:delete` can read what silo thinks the claim
   * *means* from `phrase`; only the author can say what this plugin wants it
   * **for**, and that is the half that decides.
   */
  reason: string | null
}

/** Narrowing a wildcard the manifest asked for. `''` in either segment leaves
 *  the plugin's own wildcard alone. */
export interface PluginGrantScope {
  project: string
  env: string
}

/**
 * What a grant form is choosing, and what it would send.
 *
 * Pure, so the rules a grant screen has to get right are testable without a
 * DOM: which claims may be offered at all, what narrowing a wildcard produces,
 * and what the resulting claim list is. The component above it only renders.
 */
export class PluginGrantPlan {
  /**
   * Why a claim may never be granted to a plugin, or `''` (D34, extended by
   * D37).
   *
   * Mirrored from the server rather than trusted to it, for the reason
   * `RouteAuth` states about affordances: a checkbox the API will refuse is
   * worse than no checkbox. The server still refuses — this only stops the
   * operator finding out by being told no.
   */
  static forbidden(claim: string): string {
    if (claim === Claims.Root) {
      return 'A plugin runs code, so root would include the authority to widen its own grant.'
    }
    if ((Claims.PluginForbiddenClaims as readonly string[]).includes(claim)) {
      return claim.startsWith('plugins:')
        ? 'A plugin holding this could widen its own grant.'
        : 'A plugin holding this could mint or plant a credential its grant does not bound.'
    }
    return ''
  }

  /**
   * One row per claim the manifest asked for.
   *
   * Required first and optional after, rather than in the order the server
   * normalized them (D36). The order is the decision: everything required is what
   * "approve the default" approves, so a screen that interleaved the two would
   * make the default a thing you have to reconstruct by reading every row.
   */
  static rows(plugin: PluginView, ownClaims: readonly string[]): PluginClaimRow[] {
    const required = new Set(plugin.required)
    const ordered = [
      ...plugin.requested.filter((claim) => required.has(claim)),
      ...plugin.requested.filter((claim) => !required.has(claim)),
    ]

    return ordered.map((claim) => {
      const parsed = PluginGrantPlan.parse(claim)
      const under = PluginGrantPlan.under(claim, plugin.effective)
      const granted = PluginGrantPlan.holds(plugin.effective, parsed)
      return {
        claim,
        phrase: ClaimWords.phrase(claim),
        held: granted ? 'granted' : under.length > 0 ? 'narrowed' : 'none',
        actual: granted ? [] : under,
        forbidden: PluginGrantPlan.forbidden(claim),
        delegable: parsed ? Claims.canDelegate(ownClaims, [parsed]) : false,
        intervening: !!parsed?.hook && HookNames.isIntervening(parsed.hook),
        required: required.has(claim),
        reason: plugin.reasons[claim] ?? null,
      }
    })
  }

  /**
   * Narrow one claim's scope to a named project and environment.
   *
   * Only a segment the plugin left as `*` is replaced. Rewriting a segment the
   * manifest named would not be narrowing — it would be pointing the plugin at
   * a different collection than the one it asked for, which the server would
   * refuse and the operator never asked for.
   */
  static narrow(claim: string, scope: PluginGrantScope): string {
    const parsed = PluginGrantPlan.parse(claim)
    if (!parsed || (parsed.kind !== 'collection' && parsed.kind !== 'hook')) return claim

    const project = parsed.project === Claims.Root && scope.project ? scope.project : parsed.project!
    const env = parsed.env === Claims.Root && scope.env ? scope.env : parsed.env!

    return parsed.kind === 'collection'
      ? Claims.collection(project, env, parsed.name!, parsed.permission!)
      : Claims.hook(project, env, parsed.name!, parsed.hook!)
  }

  /** The claim list a selection would send, normalized the way the server
   *  stores it so the form and the record read alike. */
  static claims(chosen: readonly string[], scope: PluginGrantScope): string[] {
    return Claims.normalize(chosen.map((claim) => PluginGrantPlan.narrow(claim, scope)))
  }

  /** The rows to tick when a form opens: everything the plugin already holds,
   *  which for an unapproved one is nothing. */
  static heldRequested(plugin: PluginView): string[] {
    return plugin.requested.filter(
      (claim) =>
        PluginGrantPlan.holds(plugin.effective, PluginGrantPlan.parse(claim)) ||
        PluginGrantPlan.under(claim, plugin.effective).length > 0,
    )
  }

  /**
   * What a form should open ticked (D36).
   *
   * What the plugin already holds, if it holds anything — reopening a narrowed
   * grant must not silently propose widening it. Otherwise the **required** set,
   * which is what the API's own default grant approves: an unapproved plugin
   * opening with nothing ticked makes the common case "tick eight boxes", and
   * that is how an operator learns to press Select all.
   */
  static initialSelection(plugin: PluginView): string[] {
    const held = PluginGrantPlan.heldRequested(plugin)
    if (held.length > 0) return held
    return plugin.requested.filter((claim) => plugin.required.includes(claim))
  }

  /** How many of the requests have been answered at all — the number a listing
   *  shows. A narrowed request counts: it was decided. */
  static answered(plugin: PluginView): number {
    return PluginGrantPlan.heldRequested(plugin).length
  }

  /**
   * The scope a form should open at, read back off what is already granted.
   *
   * Without it, saving a narrowed grant and reloading the page would show the
   * selects back at "everywhere" beside claims that are not — so pressing save
   * again would silently widen the grant.
   */
  static initialScope(plugin: PluginView): PluginGrantScope {
    const scoped = plugin.effective
      .map((claim) => PluginGrantPlan.parse(claim))
      .filter((parsed) => parsed?.kind === 'collection' || parsed?.kind === 'hook')

    const one = (segment: 'project' | 'env'): string => {
      const values = new Set(scoped.map((parsed) => parsed![segment]))
      const only = values.size === 1 ? [...values][0] : undefined
      return only && only !== Claims.Root ? only : ''
    }

    const project = one('project')
    // The environment selector is meaningless without a project, and a claim
    // naming an env under every project is not something this form can express.
    return { project, env: project ? one('env') : '' }
  }

  /** The held claims that fall **under** one request — a narrower grant of the
   *  same shape. The comparison is the same `covers` the server applies, asked
   *  in the other direction. */
  private static under(claim: string, effective: readonly string[]): string[] {
    return effective.filter((held) => {
      const parsed = PluginGrantPlan.parse(held)
      return parsed !== null && parsed.raw !== claim && Claims.has([claim], parsed)
    })
  }

  private static holds(effective: readonly string[], claim: ParsedClaim | null): boolean {
    return claim !== null && Claims.has(effective, claim)
  }

  /** A claim the grammar refuses is not a claim; the row still renders, so the
   *  operator sees what the manifest actually asked for. */
  private static parse(claim: string): ParsedClaim | null {
    try {
      return Claims.parse(claim)
    } catch {
      return null
    }
  }
}
