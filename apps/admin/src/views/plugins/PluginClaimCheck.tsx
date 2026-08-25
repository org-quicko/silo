import { AlertTriangle, Ban } from 'lucide-react'
import type { PluginClaimRow } from './plugin-grant-plan'
import styles from './PluginDetail.module.css'

/**
 * One claim the manifest asked for, as a decision.
 *
 * The claim string is shown as well as its meaning, because approving is the
 * one moment the exact grammar matters — a wildcard segment is the difference
 * between one collection and the instance, and no paraphrase carries that
 * reliably.
 */
export function PluginClaimCheck({
  row,
  checked,
  disabled,
  onChange,
}: {
  row: PluginClaimRow
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const blocked = row.forbidden || (row.delegable ? '' : 'The key you are signed in with cannot delegate this claim.')

  return (
    <label className={`${styles.claimRow} ${blocked ? styles.claimBlocked : ''}`}>
      <input
        type="checkbox"
        checked={checked && !blocked}
        disabled={disabled || !!blocked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.claimBody}>
        <code className={styles.claimText}>{row.claim}</code>
        <span className={styles.claimPhrase}>
          {row.phrase ?? 'silo has no description for this claim.'}
          {row.intervening && (
            <span className={styles.claimFlag} title="This hook runs before the write and can change or stop it.">
              <AlertTriangle size={11} /> can change or stop a write
            </span>
          )}
        </span>
        {row.actual.length > 0 && (
          <span className={styles.claimNarrowed}>
            narrowed to {row.actual.map((claim) => <code key={claim}>{claim}</code>)}
          </span>
        )}
        {blocked && (
          <span className={styles.claimBlockedWhy}>
            <Ban size={11} /> {blocked}
          </span>
        )}
      </span>
    </label>
  )
}
