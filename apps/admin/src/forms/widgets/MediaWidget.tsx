import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { AlertCircle, FileText, Film, FolderOpen, Image, Music, Trash2, Upload, X } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../components/buttons/Button'
import { MediaDrop } from './media-drop'
import { MediaPickerDialog } from './MediaPickerDialog'
import { MediaValue } from './media-value'
import { useMediaPicker } from './use-media-picker'
import styles from './MediaWidget.module.css'

/**
 * The RJSF widget for a `x-silo-type: media` property.
 *
 * What it stores is a reference, never a URL — that is what survives a rename
 * and what the delete guard counts (D23). Everything else on screen is derived
 * from it.
 */
export function MediaWidget(props: any) {
  const { value, disabled, readonly, onChange, registry, options } = props
  const context = registry?.formContext ?? props.formContext
  const { url, apiKey, claims, onMediaUploadPendingChange } = context || {}

  const locked = Boolean(disabled || readonly)
  const canUpload = !claims || Claims.has(claims, Claims.MediaCreate)
  const dropEnabled = !locked && canUpload
  const widgetInstanceId = useId()
  const pendingChange = onMediaUploadPendingChange as
    | ((key: string, pending: boolean) => void)
    | undefined

  const picker = useMediaPicker(url, apiKey, value, onChange, canUpload)
  const [showManualInput, setShowManualInput] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    pendingChange?.(widgetInstanceId, picker.uploading)
    return () => {
      pendingChange?.(widgetInstanceId, false)
    }
  }, [widgetInstanceId, picker.uploading, pendingChange])

  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
  const previewUrl = MediaValue.previewUrl(value, baseUrl)
  const isImage = picker.selected
    ? picker.selected.content_type.startsWith('image/')
    : MediaValue.looksLikeImage(value)

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!MediaDrop.canAcceptDrag(event.dataTransfer, dropEnabled)) return
    event.preventDefault()
    event.stopPropagation()
    setDragActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!MediaDrop.canAcceptDrag(event.dataTransfer, dropEnabled)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (!dragActive) setDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dropEnabled) return
    const current = event.currentTarget
    if (MediaDrop.leftTarget((target) => target instanceof Node && current.contains(target), event.relatedTarget)) {
      setDragActive(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (dragActive) setDragActive(false)
    const file = MediaDrop.droppedFile(event.dataTransfer, dropEnabled)
    if (!file) {
      if (MediaDrop.canAcceptDrag(event.dataTransfer, dropEnabled)) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    void picker.upload(file)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = MediaDrop.pastedFile(event.clipboardData, dropEnabled)
    if (!file) return
    event.preventDefault()
    event.stopPropagation()
    void picker.upload(file)
  }

  const renderSelectedThumb = () => {
    if (isImage) {
      return (
        <img
          src={previewUrl}
          alt="Selected"
          onError={(event) => {
            ;(event.target as HTMLElement).style.display = 'none'
          }}
        />
      )
    }
    if (picker.selected?.content_type.startsWith('video/')) return <Film size={24} />
    if (picker.selected?.content_type.startsWith('audio/')) return <Music size={24} />
    return <FileText size={24} />
  }

  return (
    <div className={styles.root} onPaste={handlePaste}>
      {canUpload && (
        <input
          type="file"
          ref={fileInput}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void picker.upload(file)
          }}
          className={styles.hiddenInput}
        />
      )}

      {value ? (
        <div
          className={`${styles.selectedCard} ${dragActive ? styles.dragActive : ''}`}
          tabIndex={dropEnabled ? -1 : undefined}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className={styles.selectedThumb}>{renderSelectedThumb()}</div>

          <div className={styles.selectedMeta}>
            <span className={styles.selectedName} title={value}>
              {MediaValue.displayName(value, picker.selected)}
            </span>
            <span className={`${styles.selectedPath} mono`} title={value}>
              {value}
            </span>
          </div>

          {!locked && (
            <div className={styles.selectedActions}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={picker.openPicker}
                title="Choose from media library"
              >
                <FolderOpen size={13} /> Change
              </Button>
              {canUpload && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={picker.uploading}
                  title="Upload file"
                >
                  <Upload size={13} /> {picker.uploading ? 'Uploading…' : 'Upload'}
                </Button>
              )}
              <Button
                type="button"
                variant="dangerGhost"
                size="sm"
                onClick={() => {
                  picker.cancelUpload()
                  onChange(options?.emptyValue)
                }}
                title="Clear media"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div
          className={`${styles.dropzone} ${dragActive ? styles.dragActive : ''}`}
          tabIndex={dropEnabled ? -1 : undefined}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className={styles.dropzoneHint}>
            <Image size={24} />
            <span>
              {picker.uploading
                ? 'Uploading…'
                : dropEnabled
                  ? 'No media file selected — drop or paste a file here'
                  : 'No media file selected'}
            </span>
          </div>

          {!locked && (
            <div className={styles.dropzoneActions}>
              <Button type="button" variant="secondary" size="sm" onClick={picker.openPicker}>
                <FolderOpen size={14} /> Select from Media Library
              </Button>
              {canUpload && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={picker.uploading}
                >
                  <Upload size={14} /> {picker.uploading ? 'Uploading…' : 'Upload File'}
                </Button>
              )}
            </div>
          )}

          {!locked && (
            <button
              type="button"
              className={styles.manualToggle}
              onClick={() => setShowManualInput(!showManualInput)}
            >
              {showManualInput ? 'Hide manual URL input' : 'Enter media URL manually'}
            </button>
          )}

          {showManualInput && !locked && (
            <input
              type="text"
              className={`input mono ${styles.manualInput}`}
              placeholder="silo://media/<id> or https://…"
              value={value || ''}
              onChange={(event) => {
                picker.cancelUpload()
                onChange(event.target.value === '' ? options?.emptyValue : event.target.value)
              }}
            />
          )}
        </div>
      )}

      {!picker.open && picker.uploadError && (
        <div className={`banner banner-bad ${styles.errorBanner}`} role="alert">
          <AlertCircle size={15} />
          <span className={styles.bannerMessage}>{picker.uploadError}</span>
          <button
            type="button"
            className={styles.bannerDismiss}
            onClick={picker.clearUploadError}
            aria-label="Dismiss upload error"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {picker.open && (
        <MediaPickerDialog
          assets={picker.assets}
          baseUrl={baseUrl}
          selectedId={picker.selectedId}
          search={picker.search}
          onSearch={picker.setSearch}
          folder={picker.folder}
          folders={picker.folders}
          onFolderChange={picker.setFolder}
          type={picker.type}
          onTypeChange={picker.setType}
          page={picker.page}
          pageSize={picker.pageSize}
          total={picker.total}
          onPageChange={picker.setPage}
          onPageSizeChange={picker.setPageSize}
          loading={picker.loading}
          uploading={picker.uploading}
          canUpload={canUpload}
          error={picker.error}
          uploadError={picker.uploadError}
          onClearUploadError={picker.clearUploadError}
          onUpload={(file) => void picker.upload(file, picker.folder || undefined)}
          onChoose={picker.choose}
          onClose={picker.closePicker}
        />
      )}
    </div>
  )
}
