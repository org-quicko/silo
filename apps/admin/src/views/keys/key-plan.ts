import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { KeyScopes, type KeyScope } from './key-scope'

/** A named role over one or more scopes — what the Presets tab says. */
export interface PresetPlan {
  role: ClaimPreset
  scopes: KeyScope[]
}

/** One scope's collection grant in the Advanced tab: which collections, and
 *  which of the nine permissions over them. */
export interface AdvancedRow {
  scope: KeyScope
  /** Named collections. Empty means every collection in the scope, including
   *  ones created later, which is a different key and so a deliberate choice. */
  collections: string[]
  /**
   * Whether the row is *narrowing* to named collections, as opposed to holding
   * none yet.
   *
   * Carried rather than derived from `collections.length`, because the moment
   * between choosing to narrow and picking the first collection is a real state
   * the form has to be in: derived, the picker would close again the instant it
   * was opened. It changes no claim — a narrowed row with nothing chosen composes
   * nothing, and `validate` refuses to submit one.
   */
  narrowed?: boolean
  permissions: CollectionPermission[]
}

/** Every leaf the Advanced tab can toggle. */
export interface AdvancedPlan {
  rows: AdvancedRow[]
  /** The unscoped instance claims: media, keys, transfer, plugins, audit. */
  fixed: Claim[]
  /** Whether the chosen transfer capabilities should also cover `mode=replace`. */
  transferReplace: boolean
}

/**
 * Turns what a tab says into the claim set it means.
 *
 * The reason this is not in the views is unchanged from the single-scope form
 * it replaces: "what this key can do" has to be computed identically for three
 * consumers — the request body, the delegation check that decides which
 * controls are live, and the review the user reads before saving. Derived
 * separately, the page can offer an option it will then refuse.
 */
export class KeyPlan {
  /** A role over its scopes, exactly as `Claims.fromPreset` defines it — the
   *  preset's own fixed claims included, since that is what a preset *is*. */
  static fromPreset(plan: PresetPlan): Claim[] {
    if (plan.role === 'root') return [Claims.Root]

    const targets = KeyScopes.unique(plan.scopes)
      .filter(KeyScopes.complete)
      .map((scope) => KeyScopes.target(scope, Claims.Root))
    if (targets.length === 0) return []
    return Claims.fromPreset(plan.role, targets)
  }

  /** Every leaf the Advanced tab has ticked, plus what a transfer choice drags
   *  in behind it. */
  static fromAdvanced(plan: AdvancedPlan): Claim[] {
    const claims: Claim[] = [...plan.fixed]

    for (const row of plan.rows) {
      if (!KeyScopes.complete(row.scope)) continue
      // A row mid-narrowing composes nothing rather than silently widening back
      // out to every collection, which is the opposite of what was asked for.
      if (row.narrowed && row.collections.length === 0) continue
      const names = row.collections.length > 0 ? row.collections : [Claims.Root]
      for (const name of names) {
        for (const permission of row.permissions) {
          claims.push(Claims.collection(row.scope.project, row.scope.env, name, permission))
        }
      }
    }

    return Claims.normalize([
      ...claims,
      ...KeyPlan.transferRequirements(plan.fixed, plan.transferReplace),
    ])
  }

  /**
   * Collection permissions a chosen transfer capability exercises, at
   * `*` / `*` / `*`.
   *
   * D21: a `transfer:*` claim is a gate on the mechanism, not a grant of
   * authority — the route additionally requires the caller to already hold, at
   * instance scope, everything the archive touches. Minting `transfer:import`
   * on its own therefore produces a key that 403s on every import. Composing
   * the requirement in from `Claims.Transfer*Permissions` means the form cannot
   * disagree with the guard.
   */
  static transferRequirements(capabilities: readonly Claim[], replace: boolean): Claim[] {
    const held = new Set(capabilities)
    const permissions: CollectionPermission[] = []
    if (held.has(Claims.TransferExport)) permissions.push(...Claims.TransferReadPermissions)
    if (held.has(Claims.TransferImport) || held.has(Claims.TransferCopy)) {
      permissions.push(...Claims.TransferWritePermissions)
      if (replace) permissions.push(...Claims.TransferReplacePermissions)
    }
    return permissions.map((permission) =>
      Claims.collection(Claims.Root, Claims.Root, Claims.Root, permission),
    )
  }

  /**
   * The distinct scopes a claim list names, for describing a list the controls
   * did not build. Root is left out: it reaches everything, which no scope row
   * can spell, so callers answer that case before asking.
   */
  static scopesOf(claims: readonly string[]): KeyScope[] {
    const scopes: KeyScope[] = []
    for (const claim of claims) {
      let parsed
      try {
        parsed = Claims.parse(claim)
      } catch {
        continue
      }
      if (parsed.kind !== 'collection' && parsed.kind !== 'hook') continue
      scopes.push({ project: parsed.project!, env: parsed.env! })
    }
    return KeyScopes.unique(scopes)
  }

  /** The scopes a claim list reaches, for the access pill and the heading.
   *  Root reaches everything, which no scope row can spell. */
  static describeScopes(scopes: readonly KeyScope[]): string {
    const unique = KeyScopes.unique(scopes)
    if (unique.length === 0) return 'nothing yet'
    if (unique.length === 1) return KeyScopes.describe(unique[0])
    return `${unique.length} scopes`
  }
}
