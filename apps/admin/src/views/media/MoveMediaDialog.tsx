import { Folder, FolderInput, FileText, Image as ImageIcon } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { MediaPath } from './media-path'
import type { MoveSubject } from './use-media-move-flow'
import styles from './MediaLibrary.module.css'

interface Props {
  subject: MoveSubject
  targetFolder: string
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

export function MoveMediaDialog({ subject, targetFolder, busy, onConfirm, onClose }: Props) {
  const { assets, folderPaths } = subject
  const totalCount = assets.length + folderPaths.length
  const targetLabel = targetFolder === '' ? 'All files (root)' : targetFolder

  const title =
    totalCount === 1
      ? assets.length === 1
        ? `Move "${assets[0].filename}"`
        : `Move folder "${MediaPath.name(folderPaths[0])}"`
      : `Move ${totalCount} items`

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="accent">
          <FolderInput size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>{title}</h3>
          <ModalBody>
            Are you sure you want to move {totalCount === 1 ? 'this item' : `these ${totalCount} items`} to{' '}
            <strong>{targetLabel}</strong>?
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.moveItemList}>
        {folderPaths.map((f) => (
          <div key={f} className={styles.moveItemRow}>
            <Folder size={14} className={styles.moveItemFolderIcon} />
            <span className={styles.moveItemName} title={f}>
              {MediaPath.name(f)}
            </span>
            <span className={styles.moveItemType}>folder</span>
          </div>
        ))}
        {assets.map((a) => (
          <div key={a.id} className={styles.moveItemRow}>
            {a.content_type.startsWith('image/') ? (
              <ImageIcon size={14} className={styles.moveItemFileIcon} />
            ) : (
              <FileText size={14} className={styles.moveItemFileIcon} />
            )}
            <span className={styles.moveItemName} title={a.filename}>
              {a.filename}
            </span>
            <span className={styles.moveItemType}>file</span>
          </div>
        ))}
      </div>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
