import { Trash2 } from 'lucide-react'
import type { Entry } from '../../api/types/entry'
import type { SessionInfo } from '../../api/types/session-info'
import { Button } from '../../components/buttons/Button'
import { CopyIconButton } from '../../components/buttons/CopyIconButton'
import { Formatters } from '../../utils/formatters'
import { TrashCopy } from '../trash/trash-copy'
import styles from './EntryForm.module.css'

interface Props {
  entry: Entry | null
  baselineRev: number | null
  collectionName: string
  session: SessionInfo | null
  dirty: boolean
  saving: boolean
  saveDisabled?: boolean
  canSave: boolean
  canDelete: boolean
  onSave: () => void
  onDiscard: () => void
  onDelete: () => void
}

/** Right-hand metadata and action rail for `EntryForm`. */
export function EntrySystemRail({
  entry,
  baselineRev,
  collectionName,
  session,
  dirty,
  saving,
  saveDisabled = false,
  canSave,
  canDelete,
  onSave,
  onDiscard,
  onDelete,
}: Props) {
  const displayedRev = baselineRev ?? entry?.rev

  return (
    <div className={styles.rail}>
      {entry ? (
        <div className={styles.group}>
          <span className={styles.label}>SYSTEM</span>
          <SystemRow name="id" value={entry.id} copy={entry.id} copyLabel="Copy entry id" />
          <SystemRow
            name="created"
            value={Formatters.fullDateTime(entry.created_at)}
            copy={entry.created_at}
            copyLabel="Copy created timestamp"
            hint={entry.created_at}
          />
          <SystemRow
            name="updated"
            value={Formatters.fullDateTime(entry.updated_at)}
            copy={entry.updated_at}
            copyLabel="Copy updated timestamp"
            hint={`${entry.updated_at} (${Formatters.relativeTime(entry.updated_at)})`}
          />
          <SystemRow
            name="revision"
            value={`v${displayedRev}`}
            copy={String(displayedRev)}
            copyLabel="Copy revision number"
          />
        </div>
      ) : (
        <div className={styles.group}>
          <span className={styles.label}>NEW ENTRY</span>
          <p className={`${styles.caption} ${styles.captionLeft}`}>
            Fields are generated from the <b>{collectionName}</b> schema. silo validates on save; the id,
            revision, and timestamps are assigned automatically.
          </p>
        </div>
      )}

      <div className={styles.divider} />
      <div className={styles.actions}>
        {dirty && (
          <span className={styles.unsaved}>
            <span className={styles.unsavedDot} /> Unsaved changes
          </span>
        )}
        {canSave && (
          <Button type="button" variant="primary" onClick={onSave} disabled={saving || saveDisabled}>
            {saving ? 'Saving…' : 'Save entry'}
          </Button>
        )}
        <Button type="button" variant="secondary" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        {entry && canDelete && (
          <>
            <Button type="button" variant="dangerGhost" disabled={saving} onClick={onDelete}>
              <Trash2 size={14} /> Delete entry
            </Button>
            <span className={styles.caption}>
              Deleting removes the row and bumps the collection revision.{' '}
              {TrashCopy.reassurance(session)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function SystemRow({
  name,
  value,
  copy,
  copyLabel,
  hint,
}: {
  name: string
  value: string
  copy: string
  copyLabel: string
  hint?: string
}) {
  return (
    <div className={styles.row}>
      <span className={styles.key}>{name}</span>
      <span className={styles.valueGroup}>
        <span className={styles.value} title={hint}>
          {value}
        </span>
        <CopyIconButton text={copy} label={copyLabel} />
      </span>
    </div>
  )
}
