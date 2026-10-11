import { Check, Download, FileArchive, FileText } from 'lucide-react'
import { useState } from 'react'
import type { MediaArchive } from '../../api/types/media-archive'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { ByteSize } from '../../utils/byte-size'
import styles from './MediaDownload.module.css'

interface Props {
  archive: MediaArchive
  onDownload: (url: string) => void
  onClose: () => void
}

/** A download too large for one zip (D106): one button per part, and per
 *  file too large to zip. The reader starts each, so the browser never has
 *  to allow several downloads at once. */
export function DownloadArchiveDialog({ archive, onDownload, onClose }: Props) {
  const [started, setStarted] = useState<Set<string>>(new Set())
  const total = archive.parts.length

  const download = (url: string) => {
    onDownload(url)
    setStarted((previous) => new Set(previous).add(url))
  }

  const row = (key: string, icon: React.ReactNode, label: string, detail: string, url: string) => (
    <div key={key} className={styles.row}>
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.rowCopy}>
        <span className={styles.rowLabel} title={label}>
          {label}
        </span>
        <span className={styles.rowDetail}>{detail}</span>
      </span>
      <Button variant="secondary" size="sm" onClick={() => download(url)}>
        {started.has(url) ? <Check size={13} /> : <Download size={13} />} {started.has(url) ? 'Started' : 'Download'}
      </Button>
    </div>
  )

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalIcon tone="accent">
          <Download size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Download ready</h3>
          <ModalBody>
            {archive.files} {archive.files === 1 ? 'file' : 'files'}, {ByteSize.format(archive.bytes)}.
            {total > 1 && ` Split into ${total} zip files of up to 2 GB.`}
            {archive.separate.length > 0 && ' Files over 2 GB download on their own.'} Links expire in an hour.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.list}>
        {archive.parts.map((part) =>
          row(
            part.url,
            <FileArchive size={15} />,
            total > 1 ? `Part ${part.part} of ${total}` : part.filename,
            `${part.files} ${part.files === 1 ? 'file' : 'files'}, ${ByteSize.format(part.bytes)}`,
            part.url,
          ),
        )}
        {archive.separate.map((file) =>
          row(file.id, <FileText size={15} />, file.filename, ByteSize.format(file.size), file.url),
        )}
      </div>

      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </ModalActions>
    </Modal>
  )
}
