import { Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import type { DeleteSubject } from './use-media-delete-flow'
import { MediaPath } from './media-path'

interface Props {
  subject: DeleteSubject
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * The first and, when nothing selected is in use, only dialog in the delete
 * flow. A second one (`AssetInUseDialog`) replaces it if the server refuses
 * anything.
 *
 * One dialog for every kind of subject `useMediaDeleteFlow` can start with —
 * a list of files (a single-file trash click is a list of one), a folder,
 * recursive, or a selection spanning both — rather than a dialog pair per
 * kind (D49).
 */
export function DeleteAssetDialog({ subject, busy, onConfirm, onClose }: Props) {
  const count =
    subject.kind === 'assets'
      ? subject.assets.length
      : subject.kind === 'mixed'
        ? subject.assets.length + subject.folderPaths.length
        : null

  const title =
    subject.kind === 'folder'
      ? `Delete folder "${MediaPath.name(subject.path)}"?`
      : count === 1
        ? 'Delete file?'
        : `Delete ${count} items?`

  const target =
    subject.kind === 'folder'
      ? null
      : subject.kind === 'assets' && count === 1
        ? <strong>{subject.assets[0].filename}</strong>
        : `these ${count} items`

  const confirmLabel = busy
    ? 'Deleting…'
    : subject.kind === 'folder'
      ? 'Delete folder'
      : count === 1
        ? 'Delete file'
        : `Delete ${count} items`

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Trash2 size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>{title}</h3>
          <ModalBody>
            {subject.kind === 'folder' ? (
              'Delete this folder and everything inside it, permanently. If anything inside is still referenced by an entry, you will be asked before forcing the delete.'
            ) : subject.kind === 'mixed' ? (
              <>
                Delete {target} permanently — folders are removed with everything inside them. If
                anything is still referenced by an entry, you will be asked before forcing the
                delete.
              </>
            ) : (
              <>
                Delete {target} permanently. If any is still referenced by an entry, you will be
                asked before forcing the delete.
              </>
            )}
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </ModalActions>
    </Modal>
  )
}
