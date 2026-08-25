import { Claims } from '@silo/shared/claims'
import { HookNames } from '@silo/shared/hook-names'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import type { HookName } from '@silo/shared/hook-name'
import type { ParsedClaim } from '@silo/shared/parsed-claim'
import type { ClaimGroup } from './claim-group'
import { ClaimWords } from './claim-words'

/**
 * Renders a claim set as the handful of sentences it actually means.
 *
 * A flat wall of `collections:acme/prod/posts:entries:update` strings is
 * technically complete and practically unreadable — the reason to show a
 * summary before minting a credential or approving a plugin is that someone can
 * catch a mistake in it, and nobody proofreads forty monospace strings. The raw
 * list is still one disclosure away for anyone who wants to check the exact
 * grammar.
 *
 * **Nothing held may go unrendered.** Every claim is either spoken for by a
 * group or printed raw under "Also"; see `unrecognised`, and D40 in the
 * changelog for the shipped bug that rule exists to make impossible.
 */
export class ClaimGroups {
  private static segment(value: string, plural: string): string {
    return value === Claims.Root ? plural : value
  }

  /** `acme / prod · posts`, the target a scoped claim names. */
  private static target(parsed: ParsedClaim): string {
    const scope = `${ClaimGroups.segment(parsed.project!, 'every project')} / ${ClaimGroups.segment(parsed.env!, 'every environment')}`
    return `${scope} · ${parsed.name === Claims.Root ? 'all collections' : parsed.name}`
  }

  static build(claims: readonly string[]): ClaimGroup[] {
    if (claims.includes(Claims.Root)) {
      return [{
        title: 'Everything',
        lines: ['Full access to every project, environment, collection and key on this instance.'],
        warn: true,
      }]
    }

    const spoken = new Set<string>()
    const groups = [
      // Hook delivery leads. A plugin handed `entry.beforeValidate` over a
      // collection rewrites everything written to it, which no `entries:*`
      // permission grants — so it must never be read as a footnote to the
      // collection group above it.
      ...ClaimGroups.hookGroups(claims, spoken),
      ...ClaimGroups.collectionGroups(claims, spoken),
      ...ClaimGroups.fixedGroups(claims, spoken),
    ]

    const unnamed = ClaimGroups.unrecognised(claims, spoken)
    if (unnamed.length > 0) groups.push({ title: 'Also', lines: unnamed, warn: true })

    return groups
  }

  /**
   * One group per collection a hook is delivered for.
   *
   * Titled apart from the collection group for the same target rather than
   * merged into it: the two are different authorities, and the wider-looking one
   * is not the one with more words in it.
   */
  private static hookGroups(claims: readonly string[], spoken: Set<string>): ClaimGroup[] {
    const byTarget = ClaimGroups.byTarget<HookName>(claims, spoken, 'hook', (parsed) => parsed.hook!)
    return [...byTarget].map(([target, hooks]) => ({
      title: `${target} · hooks`,
      lines: ClaimWords.hookOrder.filter((hook) => hooks.includes(hook)).map((hook) => ClaimWords.hooks[hook]),
      warn: hooks.some((hook) => HookNames.isIntervening(hook)),
    }))
  }

  private static collectionGroups(claims: readonly string[], spoken: Set<string>): ClaimGroup[] {
    const byTarget = ClaimGroups.byTarget<CollectionPermission>(
      claims,
      spoken,
      'collection',
      (parsed) => parsed.permission!,
    )
    return [...byTarget].map(([title, permissions]) => ({
      title,
      lines: ClaimWords.permissionOrder
        .filter((permission) => permissions.includes(permission))
        .map((permission) => ClaimWords.permissions[permission]),
      warn: permissions.some((permission) => ClaimWords.destructive.has(permission)),
    }))
  }

  private static fixedGroups(claims: readonly string[], spoken: Set<string>): ClaimGroup[] {
    const catalogue = ClaimWords.catalogue()

    const groups: ClaimGroup[] = []
    for (const prefix of ClaimWords.families(catalogue)) {
      const title = ClaimWords.familyTitle(prefix)
      const held = catalogue.filter((claim) => claim.startsWith(prefix) && claims.includes(claim))
      if (held.length === 0) continue
      for (const claim of held) spoken.add(claim)
      groups.push({
        title,
        lines: held.map((claim) => ClaimWords.fixed[claim]),
        warn: held.some((claim) => ClaimWords.destructive.has(claim)),
      })
    }
    return groups
  }

  /** Groups one scoped kind by the target it names, marking each claim it
   *  consumes so nothing can be counted twice or lost. */
  private static byTarget<T>(
    claims: readonly string[],
    spoken: Set<string>,
    kind: 'collection' | 'hook',
    take: (parsed: ParsedClaim) => T,
  ): Map<string, T[]> {
    const byTarget = new Map<string, T[]>()
    for (const claim of claims) {
      let parsed
      try {
        parsed = Claims.parse(claim)
      } catch {
        continue
      }
      if (parsed.kind !== kind) continue
      const target = ClaimGroups.target(parsed)
      const held = byTarget.get(target) ?? []
      held.push(take(parsed))
      byTarget.set(target, held)
      spoken.add(claim)
    }
    return byTarget
  }

  /**
   * Anything held that no group above spoke for, shown raw rather than dropped.
   *
   * The summary exists so someone can catch a mistake before granting authority,
   * which makes silently omitting a claim the one failure it cannot afford — and
   * it was doing exactly that. An earlier version asked only whether an
   * unrecognised claim *parsed as fixed*, which caught the next fixed claim and
   * nothing else: when D34 added a whole new claim **kind**, every
   * `hooks:…` claim fell through both the collection branch and this one and
   * rendered as nothing at all. Measured, not inferred — two hook claims, one of
   * them instance-wide `entry.afterWrite`, summarised as "read entries".
   *
   * So the question is now the only one that generalises: was this claim
   * rendered? Flagged as a warning, because an unrecognised authority is
   * precisely the one a reader should look twice at.
   */
  private static unrecognised(claims: readonly string[], spoken: Set<string>): string[] {
    return claims.filter((claim) => !spoken.has(claim)).sort()
  }
}
