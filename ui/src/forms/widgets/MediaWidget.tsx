import { Button } from '../../components/Button'
import { useState, useRef } from 'react'
import { Upload, Image, Trash2, Search, FileText, Plus, FolderOpen } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { ModalActions } from '../../components/ModalActions'
import { ModalHeader } from '../../components/ModalHeader'
import { api } from '../../api/api-client'
import styles from './MediaWidget.module.css'
import type { MediaMetadata } from '../../api/types/media-metadata'

export function MediaWidget(props: any) {
  const { value, disabled, readonly, onChange, registry, options } = props
  // RJSF v6 drops the top-level `formContext` widget prop — it lives on `registry`.
  const { url, apiKey } = registry?.formContext || props.formContext || {}
  const [uploading, setUploading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [mediaList, setMediaList] = useState<MediaMetadata[]>([])
  const [loadingMedia, setLoadingMedia] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [search, setSearch] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalFileInputRef = useRef<HTMLInputElement>(null)

  const isLocked = disabled || readonly

  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
  const displayUrl = value ? (value.startsWith('/') ? `${baseUrl}${value}` : value) : ''

  const isImg = value && (
    value.endsWith('.png') ||
    value.endsWith('.jpg') ||
    value.endsWith('.jpeg') ||
    value.endsWith('.gif') ||
    value.endsWith('.svg') ||
    value.endsWith('.webp') ||
    value.includes('/media/') ||
    value.startsWith('http://') ||
    value.startsWith('https://')
  )

  const handleUploadFile = async (file: File) => {
    if (!file) return
    if (!url || !apiKey) {
      alert('Not connected to a silo server — cannot upload media.')
      return
    }
    setUploading(true)
    try {
      const meta = await api.uploadMedia(url, apiKey, file)
      onChange(meta.url)
      setShowModal(false)
    } catch (err: any) {
      alert(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const loadMediaList = async () => {
    if (!url || !apiKey) {
      setMediaList([])
      setMediaError('Not connected to a silo server — cannot list media.')
      return
    }
    setLoadingMedia(true)
    setMediaError('')
    try {
      const list = await api.listMedia(url, apiKey)
      setMediaList(list || [])
    } catch (err: any) {
      setMediaList([])
      setMediaError(err?.message || 'Failed to load the media library.')
    } finally {
      setLoadingMedia(false)
    }
  }

  const openLibrary = () => {
    setShowModal(true)
    loadMediaList()
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  const filteredMedia = mediaList.filter((m) =>
    m.filename.toLowerCase().includes(search.toLowerCase())
  )

  // Stored values are `/media/<sha256>_<original name>`; the hash is noise in a
  // form, so the card leads with the readable name and keeps the raw path below.
  const prettyName = (v: string) => {
    const last = v.split('/').pop() || v
    return last.replace(/^[0-9a-f]{16,}_/i, '')
  }

  return (
    <div className={styles.root}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleUploadFile(f)
        }}
        className={styles.hiddenInput}
      />

      {value ? (
        <div className={styles.selectedCard}>
          <div className={styles.selectedThumb}>
            {isImg ? (
              <img
                src={displayUrl}
                alt="Selected"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none'
                }}
              />
            ) : (
              <FileText size={24} />
            )}
          </div>
          <div className={styles.selectedMeta}>
            <span className={styles.selectedName} title={value}>
              {prettyName(value)}
            </span>
            <span className={`${styles.selectedPath} mono`} title={value}>
              {value}
            </span>
          </div>

          {!isLocked && (
            <div className={styles.selectedActions}>
              <Button
                type="button"
                 variant="secondary" size="sm"
                onClick={openLibrary}
                title="Choose from media library"
              >
                <FolderOpen size={13} /> Change
              </Button>
              <Button
                type="button"
                 variant="secondary" size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Upload file"
              >
                <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload'}
              </Button>
              <Button
                type="button"
                 variant="dangerGhost" size="sm"
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

          {!isLocked && (
            <div className={styles.dropzoneActions}>
              <Button type="button" variant="secondary" size="sm" onClick={openLibrary}>
                <FolderOpen size={14} /> Select from Media Library
              </Button>
              <Button
                type="button"
                 variant="primary" size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload File'}
              </Button>
            </div>
          )}

          {!isLocked && (
            <button
              type="button"
              className={styles.manualToggle}
              onClick={() => setShowManualInput(!showManualInput)}
            >
              {showManualInput ? 'Hide manual URL input' : 'Enter media URL manually'}
            </button>
          )}

          {showManualInput && !isLocked && (
            <input
              type="text"
              className={`input mono ${styles.manualInput}`}
              placeholder="/media/filename.png or https://..."
              value={value || ''}
              onChange={(e) => onChange(e.target.value === '' ? options?.emptyValue : e.target.value)}
            />
          )}
        </div>
      )}

      {showModal && (
        <Modal onClose={() => setShowModal(false)} size="lg">
          <input
            type="file"
            ref={modalFileInputRef}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUploadFile(f)
            }}
            className={styles.hiddenInput}
          />

          <ModalHeader className={styles.pickerHeader}>
            <div className={styles.pickerHeading}>
              <h3>Select Media File</h3>
              <span>Choose an existing media item from library or upload a file to server storage.</span>
            </div>
            <Button
              type="button"
               variant="primary" size="sm"
              onClick={() => modalFileInputRef.current?.click()}
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.list}>
            {loadingMedia ? (
              <div className={`center-wrap ${styles.empty}`}>Loading media library…</div>
            ) : filteredMedia.length === 0 ? (
              <div className={`center-wrap ${styles.empty}`}>
                <Image size={28} />
                <span>
                  {mediaError
                    ? mediaError
                    : search
                      ? 'No files match your search.'
                      : 'No media files found in server storage.'}
                </span>
              </div>
            ) : (
              <div className={styles.grid}>
                {filteredMedia.map((m) => {
                  const ext = m.filename.split('.').pop()?.toLowerCase() || ''
                  const isImgFile = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)
                  const itemUrl = `${baseUrl}${m.url}`
                  const selected = value === m.url || value === itemUrl

                  return (
                    <button
                      key={m.hash}
                      type="button"
                      className={`${styles.card} ${selected ? styles.selected : ''}`}
                      onClick={() => {
                        onChange(m.url)
                        setShowModal(false)
                      }}
                    >
                      <div className={styles.cardPreview}>
                        {isImgFile ? (
                          <img src={itemUrl} alt={m.filename} loading="lazy" />
                        ) : (
                          <FileText size={32} />
                        )}
                      </div>
                      <div className={styles.cardInfo}>
                        <span className={`${styles.cardName} mono`} title={m.filename}>
                          {m.filename}
                        </span>
                        <span className={styles.cardSize}>{formatSize(m.size)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <ModalActions className={styles.pickerActions}>
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
              Close
            </Button>
          </ModalActions>
        </Modal>
      )}
    </div>
  )
}
