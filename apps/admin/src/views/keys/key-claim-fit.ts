import { Claims } from '@silo/shared/claims'
import type { AdvancedPlan, PresetPlan } from './key-plan'
import { KeyPlanReader } from './key-plan-reader'
import type { KeyMode } from './key-mode'

/** Which tabs can edit a claim list, and what they would open showing. */
export interface KeyClaimFitting {
  /** The widest tab that reproduces the list exactly. */
  mode: KeyMode
  preset: PresetPlan | null
  advanced: AdvancedPlan | null
  /** Claims no control can express, named so the refusal can say which. Empty
   *  when Advanced fits. */
  unrepresentable: string[]
}

/**
 * Which of the three tabs can hold a given claim list.
 *
 * Tabs are modes over one list, so switching to a narrower one has to be
 * refused rather than approximated — and an existing key has to open on a tab
 * that can actually show what it holds. Both questions are this one question,
 * asked in two places.
 */
export class KeyClaimFit {
  static of(claims: readonly string[]): KeyClaimFitting {
    const preset = KeyPlanReader.preset(claims)
    const advanced = preset ? null : KeyPlanReader.advanced(claims)

    if (preset) return { mode: 'presets', preset, advanced: null, unrepresentable: [] }
    if (advanced) return { mode: 'advanced', preset: null, advanced, unrepresentable: [] }
    return {
      mode: 'custom',
      preset: null,
      advanced: null,
      unrepresentable: KeyClaimFit.withoutControls(claims),
    }
  }

  /** Whether `mode` can edit this list without losing any of it. */
  static fits(claims: readonly string[], mode: KeyMode): boolean {
    if (mode === 'custom') return true
    if (mode === 'presets') return KeyPlanReader.preset(claims) !== null
    return KeyPlanReader.advanced(claims) !== null
  }

  /**
   * The claims that keep Advanced from fitting, for the sentence that explains
   * the refusal.
   *
   * Root is named too. It is representable — as the root preset — but a reader
   * told "Advanced cannot show these" and handed an empty list would reasonably
   * conclude the page is broken.
   */
  private static withoutControls(claims: readonly string[]): string[] {
    return claims.filter((claim) => {
      if (claim === Claims.Root) return true
      // A prefix pattern (D64) and a hook claim are the two shapes no control
      // produces, for opposite reasons: a hook is a plugin authority a key
      // gains nothing from, and a pattern covers scopes no picker can list.
      if (KeyPlanReader.usesPattern(claim)) return true
      try {
        return Claims.parse(claim).kind === 'hook'
      } catch {
        return true
      }
    })
  }
}
