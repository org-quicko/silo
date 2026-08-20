import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import type { KeyReach } from './key-reach'

export interface NewKeyPlanInput {
  reach: KeyReach
  /** The project segment when `reach` names one; ignored otherwise. */
  project: string
  /** The env segment when `reach` names one; ignored otherwise. */
  env: string
  role: ClaimPreset
  /** Named collections to narrow to. Empty means every collection in reach. */
  collections: string[]
  /** Instance capabilities picked in Advanced (media, key management, transfer). */
  capabilities: Claim[]
  /** Whether the transfer capabilities should also cover `mode=replace`. */
  transferReplace: boolean
}

/**
 * Turns what the form says into the claim set it means.
 *
 * The whole point of keeping this out of the view is that "what this key can
 * do" has to be computed identically for three different consumers — the
 * request body, the delegation check that decides which controls are live, and
 * the review the user reads before pressing Create. When those three were
 * derived separately the page could offer an option it would then refuse.
 */
export class NewKeyPlan {
  /** `project` / `env` with each segment wildcarded per the chosen reach. */
  static scope(input: NewKeyPlanInput): { project: string; env: string } {
    const project = input.reach === 'env' || input.reach === 'project' ? input.project : Claims.Root
    const env = input.reach === 'env' || input.reach === 'env-all-projects' ? input.env : Claims.Root
    return { project, env }
  }

  /**
   * Whether both segments the chosen reach names have actually been picked.
   *
   * They can be blank for a beat on first paint — the project list and the
   * env list behind it are two round trips — and a blank segment would compose
   * `collections://*:schema:read`, which `Claims.normalize` rejects. The form
   * describes no collection claims until the reach is answerable.
   */
  static complete(input: NewKeyPlanInput): boolean {
    const { project, env } = NewKeyPlan.scope(input)
    return project.length > 0 && env.length > 0
  }

  /** The `project/env/collection` targets the role's permissions expand over. */
  static targets(input: NewKeyPlanInput): string[] {
    if (!NewKeyPlan.complete(input)) return []
    const { project, env } = NewKeyPlan.scope(input)
    const names = NewKeyPlan.canNarrow(input) && input.collections.length > 0
      ? input.collections
      : [Claims.Root]
    // Always three segments. A bare name would mean `*` / `*` / `<name>` —
    // that collection name in every project and environment — which is never
    // what this form means.
    return names.map((name) => `${project}/${env}/${name}`)
  }

  /**
   * Narrowing to named collections only makes sense when the reach names one
   * concrete environment: a collection list is drawn from a single scope's
   * contents, and the same name in another scope is a different collection.
   */
  static canNarrow(input: NewKeyPlanInput): boolean {
    return input.reach === 'env' && input.role !== 'root'
  }

  /**
   * Collection permissions a chosen transfer capability exercises, at
   * `*` / `*` / `*`.
   *
   * D21: a `transfer:*` claim is a gate on the mechanism, not a grant of
   * authority — the route additionally requires the caller to already hold, at
   * instance scope, everything the archive touches. Minting `transfer:import`
   * on its own therefore produces a key that 403s on every import, which is
   * exactly the half-working credential this page used to hand out with a
   * sentence of help text as the only warning. Composing the requirement in
   * from `Claims.Transfer*Permissions` means the form cannot disagree with the
   * guard.
   */
  static transferRequirements(capabilities: Claim[], replace: boolean): Claim[] {
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
   * Every claim the form is currently asking for, normalized and sorted.
   *
   * The role contributes only its *collection* permissions; the media claims
   * `Claims.fromPreset` bundles alongside them are seeded into `capabilities`
   * by the view instead, so they appear as real toggles in Advanced rather
   * than arriving invisibly with the preset. The preset stays the single
   * definition of what each role means either way — the view reads it from
   * `Claims.presetFixedClaims`.
   */
  static compose(input: NewKeyPlanInput): Claim[] {
    if (input.role === 'root') return [Claims.Root]
    const permissions = Claims.presetCollectionPermissions(input.role)
    const claims: Claim[] = []
    for (const target of NewKeyPlan.targets(input)) {
      const [project, env, name] = target.split('/')
      for (const permission of permissions) {
        claims.push(Claims.collection(project, env, name, permission))
      }
    }
    return Claims.normalize([
      ...claims,
      ...input.capabilities,
      ...NewKeyPlan.transferRequirements(input.capabilities, input.transferReplace),
    ])
  }

  /** The claims a reach/role pair would ask for, ignoring everything else. */
  static probe(input: NewKeyPlanInput, patch: Partial<NewKeyPlanInput>): Claim[] {
    return NewKeyPlan.compose({ ...input, ...patch })
  }

  /** `acme / prod`, `acme / every environment`, … for headings and summaries. */
  static describeScope(input: NewKeyPlanInput): string {
    const { project, env } = NewKeyPlan.scope(input)
    const name = (value: string, wildcard: string) =>
      value === Claims.Root ? wildcard : value || '…'
    return `${name(project, 'every project')} / ${name(env, 'every environment')}`
  }
}
