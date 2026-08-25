import { Trash2 } from 'lucide-react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'

interface Props {
  asset: MediaAsset
  onConfirm: () => void
  onClose: () => void
}

export function DeleteAssetDialog({ asset, onConfirm, onClose }: Props) {
  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Trash2 size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Delete file?</h3>
          <ModalBody>
            Delete <strong>{asset.filename}</strong> permanently? If any entry still
            references it, the delete will be refused rather than breaking that entry.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete file
        </Button>
      </ModalActions>
    </Modal>
  )
}
