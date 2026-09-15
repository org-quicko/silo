import { Claims } from '@silo/shared/claims'
import { HookNames } from '@silo/shared/hook-names'
import { ClaimWords } from '../../claims/claim-words'

/** One line of the reference: a claim, or the template a claim is spelled from. */
export interface ClaimReferenceEntry {
  /** The exact string, or a template with `<>` placeholders for its segments. */
  spelling: string
  /** What holding it permits, in the reader's words. */
  meaning: string
  /** Set when the entry is a literal claim that can be inserted as it stands. */
  literal?: boolean
  warn?: boolean
}

export interface ClaimReferenceSection {
  title: string
  /** One line under the heading. */
  note: string
  entries: ClaimReferenceEntry[]
}

/**
 * Every claim silo knows, as a reference for the Custom tab.
 *
 * **Derived, never listed.** The permissions come from `ClaimWords`, the fixed
 * claims from its catalogue, the hooks from `HookNames`, and the retired ones
 * from the vocabulary itself — so a claim added to `ClaimVocabulary` and given
 * words appears here without anyone remembering to add it. A hand-written
 * reference is a second vocabulary, and a second vocabulary is one that is
 * wrong for a release or two before anyone notices.
 */
export class ClaimReferenceEntries {
  static build(): ClaimReferenceSection[] {
    return [
      {
        title: 'Everything',
        note: 'One claim that covers every other claim on this page.',
        entries: [
          { spelling: Claims.Root, meaning: 'everything, everywhere', literal: true, warn: true },
        ],
      },
      {
        title: 'Collections',
        note: 'collections:<project>/<environment>/<collection>:<permission>. Any segment may be * for all, or a name prefix of three or more characters ending in * (acme*).',
        entries: ClaimWords.permissionOrder.map((permission) => ({
          spelling: `collections:<project>/<env>/<collection>:${permission}`,
          meaning: ClaimWords.permissions[permission],
          warn: ClaimWords.destructive.has(permission),
        })),
      },
      ...ClaimReferenceEntries.fixedSections(),
      {
        title: 'Hooks',
        note: 'hooks:<project>/<environment>/<collection>:<hook>. A plugin authority: a key holding one gains nothing.',
        entries: ClaimWords.hookOrder.map((hook) => ({
          spelling: `hooks:<project>/<env>/<collection>:${hook}`,
          meaning: ClaimWords.hooks[hook],
          warn: HookNames.isIntervening(hook),
        })),
      },
      {
        title: 'Retired',
        note: 'Still accepted so an older key still loads, and dropped on save. It grants nothing.',
        entries: Object.keys(Claims.RetiredClaims).map((claim) => ({
          spelling: claim,
          meaning: 'retired, grants nothing',
        })),
      },
    ]
  }

  /** The unscoped claims, in the families `ClaimWords` already groups them by,
   *  so the reference and the review name the same sections. */
  private static fixedSections(): ClaimReferenceSection[] {
    const catalogue = ClaimWords.catalogue()
    return ClaimWords.families(catalogue).map((prefix) => ({
      title: ClaimWords.familyTitle(prefix),
      note: 'Instance-wide. No scope narrows it.',
      entries: catalogue
        .filter((claim) => claim.startsWith(prefix))
        .map((claim) => ({
          spelling: claim,
          meaning: ClaimWords.fixed[claim],
          literal: true,
          warn: ClaimWords.destructive.has(claim),
        })),
    }))
  }
}
