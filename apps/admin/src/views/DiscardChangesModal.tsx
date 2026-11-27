import { AlertTriangle } from 'lucide-react'
import { Button } from '../components/buttons/Button'
import { Modal } from '../components/modal/Modal'
import { ModalActions } from '../components/modal/ModalActions'
import { ModalBody } from '../components/modal/ModalBody'
import { ModalCopy } from '../components/modal/ModalCopy'
import { ModalHeader } from '../components/modal/ModalHeader'
import { ModalIcon } from '../components/modal/ModalIcon'

interface Props {
  onKeepEditing: () => void
  onDiscard: () => void
}

/** Confirmation modal shown before discarding unsaved edits on navigation or Escape. */
export function DiscardChangesModal({ onKeepEditing, onDiscard }: Props) {
  return (
    <Modal onClose={onKeepEditing}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <AlertTriangle size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Discard unsaved changes?</h3>
          <ModalBody>
            You have unsaved changes. If you leave now, your edits will be lost.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalActions>
        <Button type="button" variant="secondary" onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button type="button" variant="danger" onClick={onDiscard}>
          Discard
        </Button>
      </ModalActions>
    </Modal>
  )
}
