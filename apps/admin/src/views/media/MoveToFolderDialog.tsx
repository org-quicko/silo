import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalError } from '../../components/modal/ModalError'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { FolderTreeRow } from './FolderTreeRow'
import { MediaFolderTree } from './media-folder-tree'
import { MediaPath } from './media-path'
import { validateMove, type MoveSubject } from './use-media-move-flow'
import styles from './MediaLibrary.module.css'

interface Props {
  subject: MoveSubject
  /** Where the items are now, so the tree opens with that branch in view. */
  currentFolder: string
  /** Every folder in the library, flat, as the server lists them. */
  folders: string[]
  busy: boolean
  /** Why the last move was refused, shown under the tree with the chosen
   *  destination still selected. */
  error: string
  onMove: (target: string) => void
  onClose: () => void
}

/** Where a move goes, browsed rather than typed (D66). A path field could
 *  name a folder that does not exist and could not say which ones refuse the
 *  items; the tree only offers what is there, and `validateMove` disables the
 *  rest with the reason on the row. */
export function MoveToFolderDialog({ subject, currentFolder, folders, busy, error, onMove, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(MediaFolderTree.ancestors(currentFolder)))

  const tree = MediaFolderTree.build(folders)
  const count = subject.assets.length + subject.folderPaths.length
  const title =
    count === 1
      ? subject.assets.length === 1
        ? `Move "${subject.assets[0].filename}"`
        : `Move folder "${MediaPath.name(subject.folderPaths[0])}"`
      : `Move ${count} items`

  const blockedReason = (path: string) => validateMove(subject, path).reason

  const toggle = (path: string) => {
    setExpanded((open) => {
      const next = new Set(open)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="accent">
          <FolderInput size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>{title}</h3>
          <ModalBody>Entries reference files by id, so a move changes no entry.</ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.tree}>
        <FolderTreeRow
          node={tree}
          depth={0}
          selected={selected}
          expanded={expanded}
          blockedReason={blockedReason}
          onSelect={setSelected}
          onToggle={toggle}
        />
      </div>

      <p className={styles.treeDestination}>
        {selected === null ? (
          'Pick a destination folder.'
        ) : (
          <>
            Moving to <strong>{selected || MediaFolderTree.RootName}</strong>
          </>
        )}
      </p>

      {error && <ModalError className={styles.dialogError}>{error}</ModalError>}

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || selected === null} onClick={() => onMove(selected ?? '')}>
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
