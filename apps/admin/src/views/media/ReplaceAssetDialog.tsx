import { Replace } from 'lucide-react'
import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalError } from '../../components/modal/ModalError'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { MediaExtension } from './media-extension'
import styles from './MediaLibrary.module.css'

interface Props {
  asset: MediaAsset
  /** How many entries reference it, once the flow has read them. `null` while
   *  that is still in flight. */
  usageCount: number | null
  /** Why Replace cannot be offered, or null when it can (D67). The server
   *  refuses it either way; this is what keeps the button from promising
   *  otherwise. */
  unavailable: string | null
  loading: boolean
  busy: boolean
  error: string
  onReplace: (file: File) => void
  onClose: () => void
}

/**
 * Swaps the file behind an asset (D67). One dialog: a replace is not refused
 * for being referenced the way a delete is, so there is no second one.
 *
 * The picked file is held here rather than submitted straight from the input,
 * because the reader should see what they chose before an action with no undo
 * takes it.
 */
export function ReplaceAssetDialog({
  asset,
  usageCount,
  unavailable,
  loading,
  busy,
  error,
  onReplace,
  onClose,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const extension = MediaExtension.of(asset.filename)
  const canReplace = file !== null && !busy && !loading && !unavailable

  const submit = () => {
    if (canReplace && file) onReplace(file)
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="accent">
          <Replace size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Replace file</h3>
          <ModalBody>
            The id, name and link stay the same. Only the file changes, and there is no undo.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.editFields}>
        <div className={styles.replaceFacts}>
          <span className={styles.replaceName}>{asset.filename}</span>
          {usageCount !== null && usageCount > 0 && (
            <span className={styles.replaceUsage}>
              Used by {usageCount} {usageCount === 1 ? 'entry' : 'entries'}. All of them will show the
              new file.
            </span>
          )}
        </div>

        <input
          type="file"
          accept={extension ? `.${extension}` : undefined}
          disabled={busy || loading || unavailable !== null}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {extension && <span className={styles.replaceHint}>Must be a .{extension} file.</span>}

        {unavailable && <ModalError>{unavailable}</ModalError>}
        {error && <ModalError>{error}</ModalError>}
      </div>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canReplace} onClick={submit}>
          {busy ? 'Replacing…' : 'Replace'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
