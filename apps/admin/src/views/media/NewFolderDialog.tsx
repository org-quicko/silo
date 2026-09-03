import { FolderPlus } from 'lucide-react'
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
  /** Where the folder lands — the folder currently being browsed, or the
   *  library root when it's blank. */
  parent: string
  busy: boolean
  onCreate: (name: string) => void
  onClose: () => void
}

/** Replaces `window.prompt`, which this app's preview environments refuse to
 *  run — the folder name needs a real field either way, for the same reasons
 *  every other create/rename flow here uses a `Modal`. */
export function NewFolderDialog({ parent, busy, onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const trimmed = name.trim()

  const submit = () => {
    if (!trimmed || busy) return
    onCreate(trimmed)
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="accent">
          <FolderPlus size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>New folder</h3>
          <ModalBody>
            Created inside <strong>{parent || 'All files'}</strong>.
          </ModalBody>
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
          <input
            autoFocus
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Hero banners"
          />
        </label>
      </form>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!trimmed || busy} onClick={submit}>
          {busy ? 'Creating…' : 'Create folder'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
