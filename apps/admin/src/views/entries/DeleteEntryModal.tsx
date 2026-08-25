import { Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { ModalSubject } from '../../components/modal/ModalSubject'
import { Formatters } from '../../utils/formatters'
import type { Entry } from '../../api/types/entry'

/** The delete-confirmation modal for one row, out of `Entries.tsx` for the same reason `RowMenu` already is. */
export function DeleteEntryModal({
  entry,
  collectionName,
  label,
  sub,
  onCancel,
  onConfirm,
}: {
  entry: Entry
  collectionName: string
  label: string
  /** The subtitle field's name, when the schema has one — shown beside the id. */
  sub: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal onClose={onCancel}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Trash2 size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Delete this entry?</h3>
          <ModalBody>
            You're about to delete <b>“{label}”</b> from <b>{collectionName}</b>. The row is removed immediately and
            can't be recovered.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>
      <ModalSubject
        mark={collectionName.charAt(0).toUpperCase()}
        title={label}
        subtitle={
          <>
            {sub && entry.data?.[sub] ? String(entry.data[sub]) + ' · ' : ''}
            {Formatters.shortId(entry.id)}
          </>
        }
      />
      <ModalActions>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete entry
        </Button>
      </ModalActions>
    </Modal>
  )
}
