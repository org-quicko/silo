import { Trash2 } from 'lucide-react'
import type { TrashItem } from '../../api/types/trash-item'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { ModalSubject } from '../../components/modal/ModalSubject'
import { TrashLabels } from './trash-labels'
import { TrashKindIcon } from './TrashKindIcon'

/**
 * Asks once more before one trash item goes for good, since nothing can bring
 * it back after this. A plain confirm, like an entry delete: typing a word back
 * is kept for emptying the whole trash.
 */
export function PurgeTrashItemDialog({
  item,
  onCancel,
  onConfirm,
}: {
  item: TrashItem
  onCancel: () => void
  onConfirm: () => void
}) {
  const container = item.kind !== 'entry' && item.kind !== 'media'
  const details = [TrashLabels.origin(item).join(' / '), TrashLabels.contents(item)].filter(Boolean)

  return (
    <Modal onClose={onCancel}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Trash2 size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Delete permanently?</h3>
          <ModalBody>
            This deletes <b>“{item.subject_name}”</b>
            {container ? ' and everything in it' : ''} for good. You cannot restore it.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalSubject
        mark={<TrashKindIcon kind={item.kind} size={13} />}
        title={item.subject_name}
        subtitle={details.join(' · ')}
      />
      <ModalActions>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete permanently
        </Button>
      </ModalActions>
    </Modal>
  )
}
