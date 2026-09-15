import { Minus, Plus } from 'lucide-react'
import { ClaimWords } from '../../claims/claim-words'
import styles from './KeyForm.module.css'

interface Props {
  added: string[]
  removed: string[]
}

/**
 * What saving an edit would add and take away.
 *
 * An edit is the only operation that changes what an already-distributed secret
 * can do, and the holder is told nothing — so the person making the change is
 * the only one who can catch a mistake in it. The review below still describes
 * the finished key; this says what *moved*, which a description of the result
 * cannot.
 */
export function KeyClaimDiff({ added, removed }: Props) {
  if (added.length === 0 && removed.length === 0) return null

  const rows = [
    ...removed.map((claim) => ({ claim, gone: true })),
    ...added.map((claim) => ({ claim, gone: false })),
  ]

  return (
    <section className={`card ${styles.diff}`}>
      <div className={styles.diffHead}>
        <b>Changes</b>
        <span>
          {removed.length} removed, {added.length} added
        </span>
      </div>
      <div className={styles.diffRows}>
        {rows.map(({ claim, gone }) => (
          <div className={`${styles.diffRow} ${gone ? styles.diffGone : ''}`} key={`${gone}-${claim}`}>
            {gone ? <Minus size={12} /> : <Plus size={12} />}
            <code>{claim}</code>
            <span>{ClaimWords.phrase(claim) ?? ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
