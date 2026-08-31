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
  /** A single-file trash click is a list of one — one dialog either way. */
  assets: MediaAsset[]
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

/** The first and, when nothing selected is in use, only dialog in the delete
 *  flow. A second one (`AssetInUseDialog`) replaces it if the server refuses
 *  any of the ids. */
export function DeleteAssetDialog({ assets, busy, onConfirm, onClose }: Props) {
  const count = assets.length
  const subject = count === 1 ? <strong>{assets[0].filename}</strong> : `these ${count} files`

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Trash2 size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>{count === 1 ? 'Delete file?' : `Delete ${count} files?`}</h3>
          <ModalBody>
            Delete {subject} permanently. If any is still referenced by an entry, you will
            be asked before forcing the delete.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {busy ? 'Deleting…' : count === 1 ? 'Delete file' : `Delete ${count} files`}
        </Button>
      </ModalActions>
    </Modal>
  )
}
