import { AlertCircle, FileText, Film, Image, Music, Plus, Search, X } from 'lucide-react'
import { useRef } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { Pagination } from '../../components/data/Pagination'
import { LoadingState } from '../../components/feedback/LoadingState'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ByteSize } from '../../utils/byte-size'
import { MediaFileUrl } from '../../views/media/media-file-url'
import { MediaPickerQuery } from './media-picker-query'
import styles from './MediaWidget.module.css'

interface Props {
  assets: MediaAsset[]
  /** The server's base URL; each asset's own `url` is rooted at it. */
  baseUrl: string
  selectedId: string | null
  search: string
  onSearch: (query: string) => void
  folder: string
  folders: string[]
  onFolderChange: (folder: string) => void
  type: string
  onTypeChange: (type: string) => void
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  loading: boolean
  uploading: boolean
  canUpload: boolean
  error: string
  uploadError: string
  onClearUploadError: () => void
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
  folder,
  folders,
  onFolderChange,
  type,
  onTypeChange,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  loading,
  uploading,
  canUpload,
  error,
  uploadError,
  onClearUploadError,
  onUpload,
  onChoose,
  onClose,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const hasFilters = Boolean(search.trim() || folder || type)

  return (
    <Modal onClose={onClose} size="lg">
      {canUpload && (
        <input
          type="file"
          ref={fileInput}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onUpload(file)
          }}
          className={styles.hiddenInput}
        />
      )}

      <ModalHeader className={styles.pickerHeader}>
        <div className={styles.pickerHeading}>
          <h3>Select Media File</h3>
          <span>
            Choose an existing media item from library or upload a file to server storage.
          </span>
        </div>
        {canUpload && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            <Plus size={14} /> {uploading ? 'Uploading…' : 'Upload new file'}
          </Button>
        )}
      </ModalHeader>

      <div className={styles.controls}>
        <div className={styles.search}>
          <Search size={14} />
          <input
            type="text"
            className={`input ${styles.searchInput}`}
            placeholder="Search files by name..."
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            aria-label="Search media files"
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onSearch('')}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <select
          className={`input ${styles.filterSelect} ${folder ? styles.filterActive : ''}`}
          value={folder}
          onChange={(event) => onFolderChange(event.target.value)}
          aria-label="Filter by folder"
        >
          <option value="">All folders</option>
          {folders.map((folderPath) => (
            <option key={folderPath} value={folderPath}>
              {folderPath}
            </option>
          ))}
        </select>

        <select
          className={`input ${styles.filterSelect} ${type ? styles.filterActive : ''}`}
          value={type}
          onChange={(event) => onTypeChange(event.target.value)}
          aria-label="Filter by type"
        >
          {MediaPickerQuery.TypeOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {uploadError && (
        <div className={`banner banner-bad ${styles.pickerBanner}`} role="alert">
          <AlertCircle size={15} />
          <span className={styles.bannerMessage}>{uploadError}</span>
          <button
            type="button"
            className={styles.bannerDismiss}
            onClick={onClearUploadError}
            aria-label="Dismiss upload error"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className={styles.list}>
        {loading ? (
          <LoadingState message="Loading the media library…" />
        ) : assets.length === 0 ? (
          <div className={`center-wrap ${styles.empty}`}>
            <Image size={28} />
            <span>
              {error ||
                (hasFilters
                  ? 'No files match your filters.'
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
                disabled={uploading}
              >
                <div className={styles.cardPreview}>
                  {asset.content_type.startsWith('image/') ? (
                    <img src={MediaFileUrl.of(asset, baseUrl)} alt={asset.filename} loading="lazy" />
                  ) : asset.content_type.startsWith('video/') ? (
                    <Film size={32} />
                  ) : asset.content_type.startsWith('audio/') ? (
                    <Music size={32} />
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

      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizeOptions={MediaPickerQuery.PageSizeOptions}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}

      <ModalActions className={styles.pickerActions}>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalActions>
    </Modal>
  )
}
