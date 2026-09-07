import { useState, type DragEvent } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './ArchiveDropzone.module.css'

/**
 * Where an import starts: drop an archive here, or pick one.
 *
 * It says "drop", so it accepts a drop — the file picker alone behind copy
 * promising a drag target is the kind of small lie that teaches people to stop
 * reading the screen. Choosing or dropping only *reads* the archive; the dry
 * run below decides whether anything is written.
 */
export function ArchiveDropzone({
  file,
  onPick,
  onClear,
  fileInput,
  onInputChange,
}: {
  file: File | null
  onPick: (file: File) => void
  onClear: () => void
  fileInput: React.RefObject<HTMLInputElement | null>
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [over, setOver] = useState(false)

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) onPick(dropped)
  }

  return (
    <div
      className={`${styles.zone} ${over ? styles.over : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <span className={styles.icon}>
        <Upload size={17} />
      </span>
      <div className={styles.body}>
        <b>{file ? 'Archive ready' : 'Drop a .tar.gz archive'}</b>
        <p>
          Nothing is applied on drop. Silo reads the archive and shows you exactly what would
          change first.
        </p>
        <div className={styles.actions}>
          {file ? (
            <>
              <span className={styles.file}>{file.name}</span>
              <Button variant="secondary" size="sm" onClick={onClear}>
                <X size={13} /> Clear
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Choose archive…
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".gz,.tgz,.tar.gz"
        className={styles.hiddenInput}
        onChange={onInputChange}
      />
    </div>
  )
}
