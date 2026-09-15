import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalError } from '../../components/modal/ModalError'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { MediaPath } from './media-path'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  busy: boolean
  /** Why the last save was refused, shown under the field. */
  error: string
  onSave: (to: string) => void
  onClose: () => void
}

/** Renames a folder in place (D66): the field is the name, and the parent it
 *  keeps is what `onSave` is handed back as a whole path. Moving it elsewhere
 *  is the Move action.
 *
 *  Touches no entry and moves no blob — folders are catalog metadata, and
 *  assets are referenced by id, so this is a field rewrite on every affected
 *  record and nothing more.
 *
 *  `busy` disables Save for the request's duration, the same as every other
 *  dialog in this flow — `onSave` is async, and a double click would send a
 *  second `PATCH` for a `from` the first already renamed. */
export function RenameFolderDialog({ path, busy, error, onSave, onClose }: Props) {
  const current = MediaPath.name(path)
  const [name, setName] = useState(current)
  const trimmed = name.trim()
  const canSave = trimmed !== '' && trimmed !== current && !busy

  const submit = () => {
    if (canSave) onSave(MediaPath.child(MediaPath.parent(path), trimmed))
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="ok">
          <Pencil size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Rename folder</h3>
          <ModalBody>Files inside reference nothing about this path, so no entry changes.</ModalBody>
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
          <span>Folder name</span>
          <input autoFocus value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
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
