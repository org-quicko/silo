import { useState } from 'react'
import { Checkbox } from '../../components/controls/Checkbox'
import { DangerConfirm } from '../../components/modal/DangerConfirm'
import styles from './MediaLibrary.module.css'

interface Props {
  busy: boolean
  error: string
  onConfirm: (force: boolean) => void
  onClose: () => void
}

/**
 * Purge's one dialog (D49): `DangerConfirm`, reserved for actions with no
 * undo, with the force opt-in inside it rather than a follow-up "still in
 * use" dialog. Purge has no bounded subject to check availability against up
 * front the way `AssetInUseDialog` can — force is a choice made before the
 * attempt, not after a refusal.
 */
export function PurgeLibraryDialog({ busy, error, onConfirm, onClose }: Props) {
  const [force, setForce] = useState(false)

  return (
    <DangerConfirm
      title="Purge the media library"
      confirmWord="purge"
      confirmLabel="Purge library"
      busyLabel="Purging…"
      busy={busy}
      error={error}
      onConfirm={() => onConfirm(force)}
      onCancel={onClose}
    >
      <>
        Delete every file and folder in the library, permanently. There is no undo.
        <label className={styles.forceGate}>
          <Checkbox checked={force} onChange={setForce} disabled={busy} />
          Also force past files still referenced by an entry
        </label>
      </>
    </DangerConfirm>
  )
}
