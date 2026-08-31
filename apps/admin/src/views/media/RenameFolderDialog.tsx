import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  busy: boolean
  onSave: (to: string) => void
  onClose: () => void
}

/** Renames or moves a folder (D49). Touches no entry and moves no blob —
 *  folders are catalog metadata, and assets are referenced by id, so this
 *  is a field rewrite on every affected record and nothing more.
 *
 *  `busy` disables Save for the request's duration, the same as every other
 *  dialog in this flow — `onSave` is async, and a double click would send a
 *  second `PATCH` for a `from` the first already renamed. */
export function RenameFolderDialog({ path, busy, onSave, onClose }: Props) {
  const [to, setTo] = useState(path)

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="ok">
          <Pencil size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Rename or move folder</h3>
          <ModalBody>
            Files inside reference nothing about this path, so moving it changes no entry.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.editFields}>
        <label>
          <span>New path</span>
          <input value={to} disabled={busy} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => onSave(to)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
