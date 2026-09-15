import { ClaimSegment } from '@silo/shared/claim-segment'
import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { KeyPlan, type AdvancedPlan, type AdvancedRow, type PresetPlan } from './key-plan'
import type { KeyScope } from './key-scope'

/** The roles worth trying to recognise, narrowest first, so a claim set that
 *  matches two is reported as the smaller one. */
const ROLES: readonly ClaimPreset[] = ['read', 'write', 'manage']

/**
 * Reads a claim list **back** into the state a tab can edit.
 *
 * The inverse of `KeyPlan`, and the thing that makes tabs safe. Without it,
 * switching from Custom to Advanced would silently drop whatever the controls
 * could not say — which is exactly the failure the review panel exists to
 * catch, arriving through the one door the review cannot watch.
 *
 * Every method returns `null` rather than a best effort. A partial read is
 * worse than no read: it puts a claim list in front of someone that is not the
 * one they wrote, in a form that looks authoritative.
 *
 * A **prefix pattern** (D64) is refused by both, deliberately, which is what
 * keeps patterns to the Custom tab. Neither guided control can express one:
 * a scope row offers the projects that exist, and a pattern's whole point is
 * that it also covers the ones that do not yet. Offering `acme*` in a dropdown
 * of real project names would make a grant over a future namespace look like a
 * grant over a thing you can see.
 */
export class KeyPlanReader {
  /** The role and scopes that produce exactly `claims`, or null. */
  static preset(claims: readonly string[]): PresetPlan | null {
    if (claims.length === 1 && claims[0] === Claims.Root) return { role: 'root', scopes: [] }
    if (claims.some(KeyPlanReader.usesPattern)) return null

    const scopes = KeyPlanReader.wholeScopes(claims)
    if (scopes === null) return null

    for (const role of ROLES) {
      const candidate = { role, scopes }
      if (KeyPlanReader.same(KeyPlan.fromPreset(candidate), claims)) return candidate
    }
    return null
  }

  /** The rows and toggles that produce exactly `claims`, or null. */
  static advanced(claims: readonly string[]): AdvancedPlan | null {
    if (claims.includes(Claims.Root)) return null
    if (claims.some(KeyPlanReader.usesPattern)) return null

    const fixed: Claim[] = []
    const collections: { scope: KeyScope; name: string; permission: CollectionPermission }[] = []
    for (const claim of claims) {
      let parsed
      try {
        parsed = Claims.parse(claim)
      } catch {
        return null
      }
      if (parsed.kind === 'fixed') {
        fixed.push(claim as Claim)
        continue
      }
      // A hook claim authorises being *reached*, not reaching, so no key
      // control produces one. It stays a Custom-tab claim by design.
      if (parsed.kind !== 'collection') return null
      collections.push({
        scope: { project: parsed.project!, env: parsed.env! },
        name: parsed.name!,
        permission: parsed.permission!,
      })
    }

    // Whatever a transfer choice drags in behind it is re-added on compose, so
    // it must not also surface as a scope row — a phantom `*/*/*` row nobody
    // ticked reads as a mistake in the review.
    const replace = KeyPlanReader.impliesReplace(fixed, claims)
    const implied = new Set<string>(KeyPlan.transferRequirements(fixed, replace))
    const rows = KeyPlanReader.rows(
      collections.filter((held) => !implied.has(Claims.collection(
        held.scope.project, held.scope.env, held.name, held.permission,
      ))),
    )

    const plan: AdvancedPlan = { rows, fixed, transferReplace: replace }
    return KeyPlanReader.same(KeyPlan.fromAdvanced(plan), claims) ? plan : null
  }

  /**
   * Collection claims grouped into the fewest rows that reproduce them.
   *
   * Grouped by scope **and** permission set, so `posts` and `pages` sharing a
   * grant become one row while a third collection with one extra permission
   * becomes its own. The `*` collection is split off into a row of its own
   * because "every collection" is a choice the picker spells differently from
   * a list of names.
   */
  private static rows(
    held: readonly { scope: KeyScope; name: string; permission: CollectionPermission }[],
  ): AdvancedRow[] {
    const byTarget = new Map<string, { scope: KeyScope; name: string; permissions: Set<string> }>()
    for (const claim of held) {
      const target = `${claim.scope.project}/${claim.scope.env}/${claim.name}`
      const group = byTarget.get(target)
      if (group) group.permissions.add(claim.permission)
      else {
        byTarget.set(target, {
          scope: claim.scope,
          name: claim.name,
          permissions: new Set([claim.permission as string]),
        })
      }
    }

    const rows = new Map<string, AdvancedRow>()
    for (const group of byTarget.values()) {
      const permissions = [...group.permissions].sort() as CollectionPermission[]
      const everyCollection = group.name === Claims.Root
      const signature = `${group.scope.project}/${group.scope.env}|${everyCollection}|${permissions.join(',')}`

      const row = rows.get(signature)
      if (row) row.collections.push(group.name)
      else {
        rows.set(signature, {
          scope: group.scope,
          collections: everyCollection ? [] : [group.name],
          narrowed: !everyCollection,
          permissions,
        })
      }
    }
    return [...rows.values()]
  }

  /** The scopes a preset would have targeted: every `project/env` holding a
   *  claim over the `*` collection, and nothing narrower. */
  private static wholeScopes(claims: readonly string[]): KeyScope[] | null {
    const scopes: KeyScope[] = []
    const seen = new Set<string>()
    for (const claim of claims) {
      let parsed
      try {
        parsed = Claims.parse(claim)
      } catch {
        return null
      }
      if (parsed.kind === 'fixed') continue
      // A preset grants over whole scopes only, so a named collection or a hook
      // means this list was never a preset.
      if (parsed.kind !== 'collection' || parsed.name !== Claims.Root) return null

      const target = `${parsed.project}/${parsed.env}`
      if (seen.has(target)) continue
      seen.add(target)
      scopes.push({ project: parsed.project!, env: parsed.env! })
    }
    return scopes.length > 0 ? scopes : null
  }

  /** Whether the replace toggle was on, read from the instance-wide delete
   *  authority `mode=replace` is the only reason to hold. */
  private static impliesReplace(fixed: readonly Claim[], claims: readonly string[]): boolean {
    const writing = fixed.includes(Claims.TransferImport) || fixed.includes(Claims.TransferCopy)
    if (!writing) return false
    return Claims.TransferReplacePermissions.every((permission) =>
      claims.includes(Claims.collection(Claims.Root, Claims.Root, Claims.Root, permission)),
    )
  }

  /** Whether any of a claim's scope segments is a prefix pattern. */
  static usesPattern(claim: string): boolean {
    let parsed
    try {
      parsed = Claims.parse(claim)
    } catch {
      return false
    }
    if (parsed.kind !== 'collection' && parsed.kind !== 'hook') return false
    return [parsed.project!, parsed.env!, parsed.name!].some(ClaimSegment.isPattern)
  }

  /** Both sides normalized, so ordering and duplicates cannot decide a fit. */
  private static same(produced: readonly string[], wanted: readonly string[]): boolean {
    const left = Claims.normalize([...produced])
    const right = Claims.normalize([...wanted])
    return left.length === right.length && left.every((claim, index) => claim === right[index])
  }
}
