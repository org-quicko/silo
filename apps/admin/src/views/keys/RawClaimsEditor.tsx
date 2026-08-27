import { Undo2 } from 'lucide-react'
import type { Claim } from '@silo/shared/claim'
import { Button } from '../../components/buttons/Button'
import styles from './NewKey.module.css'

interface Props {
  text: string
  parsed: { claims: Claim[]; error: string }
  onChange: (text: string) => void
  onReturnToGuided: () => void
}

/**
 * The claim list, edited by hand.
 *
 * This is why the guided layer above is allowed to stay small: anything it
 * cannot express is still reachable, seeded with what the controls produced.
 */
export function RawClaimsEditor({ text, parsed, onChange, onReturnToGuided }: Props) {
  return (
    <div className={styles.rawPanel}>
      <div className={styles.rawHead}>
        <div>
          <b>Editing claims directly</b>
          <span>The guided controls above are paused while this is open.</span>
        </div>
        <Button variant="secondary" size="sm" onClick={onReturnToGuided}>
          <Undo2 size={13} /> Return to guided controls
        </Button>
      </div>

      <textarea
        className={`input mono ${styles.rawInput}`}
        spellCheck={false}
        rows={10}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />

      {parsed.error ? (
        <div className="field-error">{parsed.error}</div>
      ) : (
        <span className="field-hint">
          {parsed.claims.length} valid claim{parsed.claims.length === 1 ? '' : 's'}, one per
          line or comma-separated.
        </span>
      )}
    </div>
  )
}
