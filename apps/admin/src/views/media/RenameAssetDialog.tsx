import { Pencil } from 'lucide-react'
import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import styles from './MediaLibrary.module.css'

interface Props {
  asset: MediaAsset
  busy: boolean
  onSave: (filename: string, folder: string) => void
  onClose: () => void
}

/** `busy` disables Save for the request's duration, the same as every other
 *  dialog in this flow — `onSave` is async, and a double click would send a
 *  second `PATCH` before the first one lands. */
export function RenameAssetDialog({ asset, busy, onSave, onClose }: Props) {
  const [filename, setFilename] = useState(asset.filename)
  const [folder, setFolder] = useState(asset.folder)

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="ok">
          <Pencil size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Rename or move</h3>
          <ModalBody>
            Entries reference this file by id, so neither its name nor its folder appears in
            any entry. Nothing you change here can break one.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.editFields}>
        <label>
          <span>File name</span>
          <input value={filename} disabled={busy} onChange={(event) => setFilename(event.target.value)} />
        </label>
        <label>
          <span>Folder</span>
          <input
            value={folder}
            placeholder="/ (library root)"
            disabled={busy}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
      </div>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => onSave(filename, folder)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
