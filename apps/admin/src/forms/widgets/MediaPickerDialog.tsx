import { FileText, Image, Plus, Search } from 'lucide-react'
import { useRef } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { LoadingState } from '../../components/feedback/LoadingState'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ByteSize } from '../../utils/byte-size'
import styles from './MediaWidget.module.css'

interface Props {
  assets: MediaAsset[]
  /** The server's base URL; each asset's own `url` is rooted at it. */
  baseUrl: string
  selectedId: string | null
  search: string
  onSearch: (query: string) => void
  loading: boolean
  uploading: boolean
  error: string
  onUpload: (file: File) => void
  onChoose: (asset: MediaAsset) => void
  onClose: () => void
}

/** Browse the media library, or upload into it, from inside a form field. */
export function MediaPickerDialog({
  assets,
  baseUrl,
  selectedId,
  search,
  onSearch,
  loading,
  uploading,
  error,
  onUpload,
  onChoose,
  onClose,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <Modal onClose={onClose} size="lg">
      <input
        type="file"
        ref={fileInput}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUpload(file)
        }}
        className={styles.hiddenInput}
      />

      <ModalHeader className={styles.pickerHeader}>
        <div className={styles.pickerHeading}>
          <h3>Select Media File</h3>
          <span>
            Choose an existing media item from library or upload a file to server storage.
          </span>
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          <Plus size={14} /> {uploading ? 'Uploading…' : 'Upload new file'}
        </Button>
      </ModalHeader>

      <div className={styles.search}>
        <Search size={14} />
        <input
          type="text"
          className={`input ${styles.searchInput}`}
          placeholder="Search files by name..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <div className={styles.list}>
        {loading ? (
          <LoadingState message="Loading the media library…" />
        ) : assets.length === 0 ? (
          <div className={`center-wrap ${styles.empty}`}>
            <Image size={28} />
            <span>
              {error || (search
                ? 'No files match your search.'
                : 'No media files found in server storage.')}
            </span>
          </div>
        ) : (
          <div className={styles.grid}>
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className={`${styles.card} ${selectedId === asset.id ? styles.selected : ''}`}
                onClick={() => onChoose(asset)}
              >
                <div className={styles.cardPreview}>
                  {asset.content_type.startsWith('image/') ? (
                    <img src={`${baseUrl}${asset.url}`} alt={asset.filename} loading="lazy" />
                  ) : (
                    <FileText size={32} />
                  )}
                </div>
                <div className={styles.cardInfo}>
                  <span className={`${styles.cardName} mono`} title={asset.filename}>
                    {asset.filename}
                  </span>
                  <span className={styles.cardSize}>{ByteSize.format(asset.size)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <ModalActions className={styles.pickerActions}>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalActions>
    </Modal>
  )
}
