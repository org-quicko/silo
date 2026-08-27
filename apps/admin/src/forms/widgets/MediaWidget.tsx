import { useRef, useState } from 'react'
import { FileText, FolderOpen, Image, Trash2, Upload } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
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
  const { url, apiKey } = registry?.formContext || props.formContext || {}

  const picker = useMediaPicker(url, apiKey, value, onChange)
  const [showManualInput, setShowManualInput] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const locked = disabled || readonly
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
  const previewUrl = MediaValue.previewUrl(value, baseUrl)

  return (
    <div className={styles.root}>
      <input
        type="file"
        ref={fileInput}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) picker.upload(file)
        }}
        className={styles.hiddenInput}
      />

      {value ? (
        <div className={styles.selectedCard}>
          <div className={styles.selectedThumb}>
            {MediaValue.looksLikeImage(value) ? (
              <img
                src={previewUrl}
                alt="Selected"
                onError={(event) => {
                  ;(event.target as HTMLElement).style.display = 'none'
                }}
              />
            ) : (
              <FileText size={24} />
            )}
          </div>

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
              <Button
                type="button"
                variant="dangerGhost"
                size="sm"
                onClick={() => onChange(options?.emptyValue)}
                title="Clear media"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.dropzone}>
          <div className={styles.dropzoneHint}>
            <Image size={24} />
            <span>No media file selected</span>
          </div>

          {!locked && (
            <div className={styles.dropzoneActions}>
              <Button type="button" variant="secondary" size="sm" onClick={picker.openPicker}>
                <FolderOpen size={14} /> Select from Media Library
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={picker.uploading}
              >
                <Upload size={14} /> {picker.uploading ? 'Uploading…' : 'Upload File'}
              </Button>
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
              onChange={(event) =>
                onChange(event.target.value === '' ? options?.emptyValue : event.target.value)
              }
            />
          )}
        </div>
      )}

      {picker.open && (
        <MediaPickerDialog
          assets={picker.assets}
          baseUrl={baseUrl}
          selectedId={picker.selectedId}
          search={picker.search}
          onSearch={picker.setSearch}
          loading={picker.loading}
          uploading={picker.uploading}
          error={picker.error}
          onUpload={picker.upload}
          onChoose={picker.choose}
          onClose={picker.closePicker}
        />
      )}
    </div>
  )
}
