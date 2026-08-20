import { Button } from '../../components/Button'
import { useEffect, useState, useRef } from 'react'
import { Image, Plus, Trash2, Link, FileText, UploadCloud, RefreshCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/api-client'
import type { MediaMetadata } from '../../api/types/media-metadata'
import { Modal } from '../../components/Modal'
import { ModalActions } from '../../components/ModalActions'
import { ModalBody } from '../../components/ModalBody'
import { ModalCopy } from '../../components/ModalCopy'
import { ModalHeader } from '../../components/ModalHeader'
import { ModalIcon } from '../../components/ModalIcon'
import { TopBar } from '../shell/TopBar'
import styles from './MediaLibrary.module.css'
import type { SessionBadge } from '../shell/session-badge'

export function MediaLibraryView({
  url,
  apiKey,
  session,
  claims,
}: {
  url: string
  apiKey: string
  session: SessionBadge
  claims: string[]
}) {
  const [mediaList, setMediaList] = useState<MediaMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<MediaMetadata | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canUpload = Claims.has(claims, Claims.MediaCreate)
  const canDelete = Claims.has(claims, Claims.MediaDelete)
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''

  const load = () => {
    setLoading(true)
    api
      .listMedia(url, apiKey)
      .then(setMediaList)
      .catch(() => setMediaList([]))
      .finally(() => setLoading(false))
  }

  useEffect(load, [url, apiKey])

  const handleUpload = async (files: FileList) => {
    if (!canUpload || files.length === 0) return
    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        await api.uploadMedia(url, apiKey, files[i])
      }
      load()
    } catch (e: any) {
      alert(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    try {
      const diskFilename = toDelete.url.split('/').pop() || ''
      await api.deleteMedia(url, apiKey, diskFilename)
      setToDelete(null)
      load()
    } catch (e: any) {
      alert(e.message || 'Delete failed')
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  const isImageFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'Library' }, { label: 'Media' }]} session={session}>
        {canUpload && (
          <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Plus size={14} strokeWidth={2.4} /> Upload media
          </Button>
        )}
      </TopBar>

      <div className="content">
        <input
          type="file"
          ref={fileInputRef}
          className={styles.hiddenInput}
          multiple
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
        />

        <div className={`page-head ${styles.pageHeader}`}>
          <div className="page-title-group">
            <h2 className="page-title">Media Library</h2>
            <span className="page-sub">
              Upload images and files to use in your collections. Stored in your instance's data directory.
            </span>
          </div>
          <Button variant="secondary" size="sm" className={styles.refresh} onClick={load} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
          </Button>
        </div>

        {canUpload && (
          <div
            className={`${styles.uploadZone} ${dragActive ? styles.dragActive : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud size={32} className={styles.uploadIcon} />
            <div className={styles.uploadText}>
              {uploading ? (
                <span>Uploading files...</span>
              ) : (
                <span>Drag & drop files here, or <strong>browse</strong></span>
              )}
            </div>
          </div>
        )}

        {loading && mediaList.length === 0 ? (
          <div className={`center-wrap ${styles.loading}`}>Loading media library...</div>
        ) : mediaList.length === 0 ? (
          <div className={`center-wrap ${styles.empty}`}>
            <Image size={32} strokeWidth={1.5} />
            <span>No media files uploaded yet.</span>
          </div>
        ) : (
          <div className={styles.grid}>
            {mediaList.map((m) => {
              const isImg = isImageFile(m.filename)
              const fileUrl = `${baseUrl}${m.url}`
              return (
                <div key={m.hash} className={styles.card}>
                  <div className={styles.preview}>
                    {isImg ? (
                      <img src={fileUrl} alt={m.filename} loading="lazy" />
                    ) : (
                      <div className={styles.previewIcon}>
                        <FileText size={36} strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className={styles.info}>
                    <span className={styles.name} title={m.filename}>
                      {m.filename}
                    </span>
                    <div className={styles.meta}>
                      <span>{formatSize(m.size)}</span>
                      <span>{new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary" size="sm"
                      className={styles.copyAction}
                      title="Copy portable relative path"
                      onClick={() => {
                        navigator.clipboard.writeText(m.url)
                      }}
                    >
                      <Link size={11} /> Rel
                    </Button>
                    <Button
                      variant="secondary" size="sm"
                      className={styles.copyAction}
                      title="Copy full absolute URL"
                      onClick={() => {
                        navigator.clipboard.writeText(fileUrl)
                      }}
                    >
                      <Link size={11} /> Full
                    </Button>
                    {canDelete && (
                      <Button
                        variant="dangerGhost" size="sm"
                        className={styles.deleteAction}
                        title="Delete file"
                        onClick={() => setToDelete(m)}
                      >
                        <Trash2 size={11} />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {toDelete && (
        <Modal onClose={() => setToDelete(null)}>
          <ModalHeader>
            <ModalIcon tone="bad">
              <Trash2 size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Delete file?</h3>
              <ModalBody>
                Are you sure you want to delete <strong>{toDelete.filename}</strong>? This action cannot be undone and any schema reference to its URL will be broken.
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <ModalActions>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete file
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
