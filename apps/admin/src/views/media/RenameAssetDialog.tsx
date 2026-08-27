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
  onSave: (filename: string, folder: string) => void
  onClose: () => void
}

export function RenameAssetDialog({ asset, onSave, onClose }: Props) {
  const [filename, setFilename] = useState(asset.filename)
  const [folder, setFolder] = useState(asset.folder)

  return (
    <Modal onClose={onClose}>
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
          <input value={filename} onChange={(event) => setFilename(event.target.value)} />
        </label>
        <label>
          <span>Folder</span>
          <input
            value={folder}
            placeholder="/ (library root)"
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
      </div>

      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onSave(filename, folder)}>
          Save
        </Button>
      </ModalActions>
    </Modal>
  )
}
