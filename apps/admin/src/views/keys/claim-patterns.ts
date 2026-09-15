import { ClaimSegment } from '@silo/shared/claim-segment'
import { Claims } from '@silo/shared/claims'

/** Which of the three scope segments a pattern was written in. */
export type PatternPosition = 'project' | 'environment' | 'collection'

/** One prefix pattern found in a claim list, and where it was written. */
export interface ClaimPattern {
  position: PatternPosition
  /** The segment as written: `acme*`. */
  segment: string
  /** Its literal part: `acme`. */
  prefix: string
}

/**
 * The prefix patterns a claim list uses (D64).
 *
 * Collected so the editor can say what each one reaches **right now** beside
 * the sentence saying it also reaches whatever is created later. A pattern is
 * the one claim shape whose meaning is not fully readable from the claim: `*`
 * announces itself, a literal names one thing, and `acme*` looks like the two
 * projects on screen while meaning every project ever named that way.
 */
export class ClaimPatterns {
  static of(claims: readonly string[]): ClaimPattern[] {
    const found = new Map<string, ClaimPattern>()

    for (const claim of claims) {
      let parsed
      try {
        parsed = Claims.parse(claim)
      } catch {
        continue
      }
      if (parsed.kind !== 'collection' && parsed.kind !== 'hook') continue

      const segments: [PatternPosition, string][] = [
        ['project', parsed.project!],
        ['environment', parsed.env!],
        ['collection', parsed.name!],
      ]
      for (const [position, segment] of segments) {
        if (!ClaimSegment.isPattern(segment)) continue
        found.set(`${position}:${segment}`, {
          position,
          segment,
          prefix: ClaimSegment.prefixOf(segment),
        })
      }
    }

    return [...found.values()]
  }

  /** The names in `candidates` a pattern admits today. */
  static matching(pattern: ClaimPattern, candidates: readonly string[]): string[] {
    return candidates.filter((name) => ClaimSegment.matches(pattern.segment, name)).sort()
  }
}
