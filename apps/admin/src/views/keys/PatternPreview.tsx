import { AlertTriangle } from 'lucide-react'
import { ClaimPatterns, type ClaimPattern } from './claim-patterns'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  claims: readonly string[]
  catalog: ScopeCatalog
}

const NOUN: Record<ClaimPattern['position'], string> = {
  project: 'project',
  environment: 'environment',
  collection: 'collection',
}

/**
 * What each prefix pattern in the claim list reaches today.
 *
 * A pattern is the one claim shape whose meaning is not readable from the
 * claim. `*` announces itself and a literal names one thing, but `acme*` looks
 * like the two projects you can see and means every project ever named that
 * way, including ones somebody creates next year. Showing the current members
 * beside that sentence is the difference between a grant someone weighed and a
 * grant someone skimmed.
 *
 * Collections have no listing here on purpose: a collection name is only
 * meaningful inside one project and environment, so "the collections this
 * matches" has no single answer to give.
 */
export function PatternPreview({ claims, catalog }: Props) {
  const patterns = ClaimPatterns.of(claims)
  if (patterns.length === 0) return null

  const candidatesFor = (pattern: ClaimPattern): string[] | null => {
    if (pattern.position === 'project') return catalog.projects
    if (pattern.position === 'environment') return catalog.knownEnvironments
    return null
  }

  return (
    <div className={styles.patterns}>
      <div className={styles.patternsHead}>
        <AlertTriangle size={13} />
        <b>
          {patterns.length} name {patterns.length === 1 ? 'pattern' : 'patterns'}
        </b>
      </div>

      {patterns.map((pattern) => {
        const candidates = candidatesFor(pattern)
        const matching = candidates ? ClaimPatterns.matching(pattern, candidates) : null

        return (
          <div className={styles.patternRow} key={`${pattern.position}:${pattern.segment}`}>
            <code>{pattern.segment}</code>
            <div>
              <span>
                Every {NOUN[pattern.position]} whose name starts with <b>{pattern.prefix}</b>,
                including ones created later.
              </span>
              {matching !== null && (
                <span className={styles.patternMatches}>
                  {matching.length === 0
                    ? 'Nothing matches it yet.'
                    : `Matches now: ${matching.join(', ')}`}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
