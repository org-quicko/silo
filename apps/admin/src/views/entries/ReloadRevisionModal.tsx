import { AlertTriangle } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'

interface Props {
  latestRev: number
  baselineRev: number
  onCancel: () => void
  onConfirm: () => void
}

/** Confirms replacing an unsaved entry draft with a newer server revision. */
export function ReloadRevisionModal({ latestRev, baselineRev, onCancel, onConfirm }: Props) {
  return (
    <Modal onClose={onCancel}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <AlertTriangle size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Reload revision v{latestRev}?</h3>
          <ModalBody>
            Reloading replaces your unsaved changes to revision <b>v{baselineRev}</b> with the latest data from
            revision <b>v{latestRev}</b>.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Keep editing
        </Button>
        <Button type="button" variant="danger" onClick={onConfirm}>
          Reload latest
        </Button>
      </ModalActions>
    </Modal>
  )
}
