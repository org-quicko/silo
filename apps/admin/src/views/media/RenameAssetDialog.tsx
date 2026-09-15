import { Pencil } from 'lucide-react'
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
import styles from './MediaLibrary.module.css'

interface Props {
  asset: MediaAsset
  busy: boolean
  /** Why the last save was refused, shown under the field. The server checks
   *  the extension against what the library accepts, so a valid-looking name
   *  can still come back refused. */
  error: string
  onSave: (filename: string) => void
  onClose: () => void
}

/** Renames a file and nothing else (D66). Where it lives is the Move action's
 *  question now, so this dialog has one field.
 *
 *  `busy` disables Save for the request's duration, the same as every other
 *  dialog in this flow — `onSave` is async, and a double click would send a
 *  second `PATCH` before the first one lands. */
export function RenameAssetDialog({ asset, busy, error, onSave, onClose }: Props) {
  const [filename, setFilename] = useState(asset.filename)
  const trimmed = filename.trim()
  const canSave = trimmed !== '' && trimmed !== asset.filename && !busy

  const submit = () => {
    if (canSave) onSave(trimmed)
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="ok">
          <Pencil size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Rename file</h3>
          <ModalBody>Entries reference this file by id, so its name appears in no entry.</ModalBody>
        </ModalCopy>
      </ModalHeader>

      <form
        className={styles.editFields}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label>
          <span>File name</span>
          <input
            autoFocus
            value={filename}
            disabled={busy}
            onChange={(event) => setFilename(event.target.value)}
          />
        </label>
        {error && <ModalError>{error}</ModalError>}
      </form>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={submit}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
