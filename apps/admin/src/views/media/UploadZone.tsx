import { UploadCloud } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import styles from './MediaLibrary.module.css'

interface Props {
  /** Named in the prompt so a drop's destination is never a surprise. */
  folder: string
  uploading: boolean
  /** Handed the whole drop, not its file list: a dropped folder is only
   *  readable from the `DataTransfer`, and only inside the handler. */
  onDrop: (transfer: DataTransfer) => void
  onBrowse: () => void
}

/** The drag-and-drop target above the grid. */
export function UploadZone({ folder, uploading, onDrop: onTransfer, onBrowse }: Props) {
  const [dragActive, setDragActive] = useState(false)

  const onDrag = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(event.type === 'dragenter' || event.type === 'dragover')
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    if (event.dataTransfer.files?.length) onTransfer(event.dataTransfer)
  }

  return (
    <div
      className={`${styles.uploadZone} ${dragActive ? styles.dragActive : ''}`}
      onDragEnter={onDrag}
      onDragOver={onDrag}
      onDragLeave={onDrag}
      onDrop={onDrop}
      onClick={onBrowse}
    >
      <UploadCloud size={32} className={styles.uploadIcon} />
      <div className={styles.uploadText}>
        {uploading ? (
          <span>Uploading files…</span>
        ) : (
          <span>
            Drag &amp; drop files or folders here, or <strong>browse</strong>
            {folder ? ` into ${folder}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
