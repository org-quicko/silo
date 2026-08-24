import { Button } from '../../components/Button'
import { Breadcrumb } from '../../components/Breadcrumb'
import { useCallback, useEffect, useState, useRef } from 'react'
import {
  Image,
  Plus,
  Trash2,
  Link,
  FileText,
  UploadCloud,
  RefreshCw,
  Folder,
  FolderPlus,
  Search,
  Pencil,
  X,
} from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { MediaRef } from '@silo/shared/media-ref'
import { api } from '../../api/api-client'
import { ApiError } from '../../api/api-error'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaInUse } from '../../api/types/media-usage'
import { Modal } from '../../components/Modal'
import { ModalActions } from '../../components/ModalActions'
import { ModalBody } from '../../components/ModalBody'
import { ModalCopy } from '../../components/ModalCopy'
import { ModalHeader } from '../../components/ModalHeader'
import { ModalIcon } from '../../components/ModalIcon'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import type { ScopeRef } from '../../api/types/scope-ref'
import styles from './MediaLibrary.module.css'
import type { SessionBadge } from '../shell/session-badge'

const PAGE_SIZE = 48

export function MediaLibraryView({
  serverId,
  scope,
  collections,
  url,
  apiKey,
  session,
  claims,
  initialQuery = '',
  onOpenPalette,
  onNavigateToCollection,
}: {
  serverId: string
  scope: ScopeRef
  collections: readonly { name: string; count: number | null; schema?: any }[]
  url: string
  apiKey: string
  session: SessionBadge
  claims: string[]
  /** A search carried in by the URL — the command palette links assets this way. */
  initialQuery?: string
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
}) {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  const [search, setSearch] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<MediaAsset | null>(null)
  const [inUse, setInUse] = useState<MediaInUse | null>(null)
  const [stalled, setStalled] = useState('')
  const [editing, setEditing] = useState<MediaAsset | null>(null)
  const [editName, setEditName] = useState('')
  const [editFolder, setEditFolder] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canUpload = Claims.has(claims, Claims.MediaCreate)
  const canDelete = Claims.has(claims, Claims.MediaDelete)
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''

  // Searching a folder is recursive: picking "/marketing" and seeing nothing
  // because everything sits in "/marketing/launch" reads as a broken filter,
  // not as a precise one.
  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.listMedia(url, apiKey, {
        q: query || undefined,
        folder,
        recursive: true,
        limit: PAGE_SIZE,
        offset,
      }),
      api.listMediaFolders(url, apiKey),
    ])
      .then(([page, folderList]) => {
        setAssets(page.items)
        setTotal(page.total)
        setFolders(folderList)
        setError('')
      })
      .catch((e: unknown) => {
        setAssets([])
        setTotal(0)
        setError(e instanceof Error ? e.message : 'Could not load the media library')
      })
      .finally(() => setLoading(false))
  }, [url, apiKey, query, folder, offset])

  useEffect(load, [load])

  // The library stays mounted while the URL changes underneath it, so a second
  // arrival from the palette has to be adopted rather than ignored.
  useEffect(() => {
    setSearch(initialQuery)
    setQuery(initialQuery)
    setOffset(0)
  }, [initialQuery])

  // Debounced so typing pages the server once per pause, not once per key.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  const handleUpload = async (files: FileList) => {
    if (!canUpload || files.length === 0) return
    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        await api.uploadMedia(url, apiKey, files[i], folder || undefined)
      }
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    try {
      await api.deleteMedia(url, apiKey, toDelete.id)
      setToDelete(null)
      load()
    } catch (e: unknown) {
      // The refusal is the feature, so it gets a real explanation rather than
      // a generic failure: the count is always true, the listed referrers are
      // only those this key may read.
      if (e instanceof ApiError && e.code === 'media_in_use') {
        setInUse(e.info as unknown as MediaInUse)
        return
      }
      // The blob store refused. The asset is staged, not gone, and the way
      // out is a command — so say that rather than showing a bare failure.
      if (e instanceof ApiError && e.code === 'media_delete_stalled') {
        setStalled(e.message)
        setToDelete(null)
        load()
        return
      }
      setError(e instanceof Error ? e.message : 'Delete failed')
      setToDelete(null)
    }
  }

  const handleRename = async () => {
    if (!editing) return
    try {
      await api.updateMediaAsset(url, apiKey, editing.id, {
        filename: editName,
        folder: editFolder,
      })
      setEditing(null)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
  }

  const handleNewFolder = async () => {
    const path = prompt('New folder path', folder ? `${folder}/` : '/')
    if (!path) return
    try {
      const created = await api.createMediaFolder(url, apiKey, path)
      setFolder(created.path)
      setOffset(0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create the folder')
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  const isImage = (asset: MediaAsset) => asset.content_type.startsWith('image/')

  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            scope={scope}
            collection={null}
            collections={collections}
            onNavigateToCollection={onNavigateToCollection}
            onOpenPalette={onOpenPalette}
          />
        }
        session={session}
      >
        {canUpload && (
          <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Plus size={14} strokeWidth={2.4} /> Upload media
          </Button>
        )}
      </TopBar>

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Library' }, { label: 'Media' }]} />
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
              One library for the whole server. Files are referenced by id, so renaming or moving one
              never breaks an entry.
            </span>
          </div>
          <Button variant="secondary" size="sm" className={styles.refresh} onClick={load} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
          </Button>
        </div>

        {error && (
          <div className={styles.error}>
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={() => setError('')}>
              <X size={11} />
            </Button>
          </div>
        )}

        {stalled && (
          <div className={styles.stalled}>
            <span>{stalled}</span>
            <Button variant="secondary" size="sm" onClick={() => setStalled('')}>
              <X size={11} />
            </Button>
          </div>
        )}

        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={13} className={styles.searchIcon} />
            <input
              type="search"
              value={search}
              placeholder="Search by file name…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className={styles.count}>
            {total} file{total === 1 ? '' : 's'}
            {folder ? ` in ${folder}` : ''}
          </span>
        </div>

        <div className={styles.layout}>
          <nav className={styles.rail}>
            <div className={styles.railHead}>
              <span>Folders</span>
              {canUpload && (
                <Button variant="secondary" size="sm" title="New folder" onClick={handleNewFolder}>
                  <FolderPlus size={12} />
                </Button>
              )}
            </div>
            <button
              type="button"
              className={`${styles.railItem} ${folder === '' ? styles.railItemActive : ''}`}
              onClick={() => {
                setFolder('')
                setOffset(0)
              }}
            >
              <Folder size={12} /> All files
            </button>
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.railItem} ${folder === f ? styles.railItemActive : ''}`}
                style={{ paddingLeft: `${10 + (f.split('/').length - 2) * 12}px` }}
                onClick={() => {
                  setFolder(f)
                  setOffset(0)
                }}
              >
                <Folder size={12} /> {f.split('/').pop()}
              </button>
            ))}
          </nav>

          <div className={styles.main}>
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
                    <span>Uploading files…</span>
                  ) : (
                    <span>
                      Drag &amp; drop files here, or <strong>browse</strong>
                      {folder ? ` — into ${folder}` : ''}
                    </span>
                  )}
                </div>
              </div>
            )}

            {loading && assets.length === 0 ? (
              <div className={`center-wrap ${styles.loading}`}>Loading media library…</div>
            ) : assets.length === 0 ? (
              <div className={`center-wrap ${styles.empty}`}>
                <Image size={32} strokeWidth={1.5} />
                <span>{query ? `Nothing matches “${query}”.` : 'No media files here yet.'}</span>
              </div>
            ) : (
              <div className={styles.grid}>
                {assets.map((m) => {
                  const fileUrl = `${baseUrl}${m.url}`
                  const used = m.usage_count || 0
                  return (
                    <div key={m.id} className={styles.card}>
                      <div className={styles.preview}>
                        {isImage(m) ? (
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
                          <span
                            className={
                              m.state === 'deleting'
                                ? styles.stalledBadge
                                : used > 0
                                  ? styles.usedBadge
                                  : undefined
                            }
                            title={
                              m.state === 'deleting'
                                ? 'Staged for deletion but its file could not be removed. Run "silo media reconcile".'
                                : used > 0
                                  ? `Referenced by ${used} entr${used === 1 ? 'y' : 'ies'} — cannot be deleted`
                                  : 'Not referenced by any entry'
                            }
                          >
                            {m.state === 'deleting'
                              ? 'stuck deleting'
                              : used > 0
                                ? `in use · ${used}`
                                : 'unused'}
                          </span>
                        </div>
                        {m.folder && <span className={styles.folderTag}>{m.folder}</span>}
                      </div>
                      <div className={styles.actions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          className={styles.copyAction}
                          title="Copy the reference to paste into an entry"
                          onClick={() => navigator.clipboard.writeText(MediaRef.url(m.id))}
                        >
                          <Link size={11} /> Ref
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className={styles.copyAction}
                          title="Copy the public URL"
                          onClick={() => navigator.clipboard.writeText(fileUrl)}
                        >
                          <Link size={11} /> URL
                        </Button>
                        {canUpload && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className={styles.iconAction}
                            title="Rename or move"
                            onClick={() => {
                              setEditing(m)
                              setEditName(m.filename)
                              setEditFolder(m.folder)
                            }}
                          >
                            <Pencil size={11} />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="dangerGhost"
                            size="sm"
                            className={styles.iconAction}
                            title={used > 0 ? 'Referenced by entries' : 'Delete file'}
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

            {total > PAGE_SIZE && (
              <div className={styles.pager}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <span>
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <ModalHeader>
            <ModalIcon tone="ok">
              <Pencil size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Rename or move</h3>
              <ModalBody>
                Entries reference this file by id, so neither its name nor its folder appears in any
                entry. Nothing you change here can break one.
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <div className={styles.editFields}>
            <label>
              <span>File name</span>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <label>
              <span>Folder</span>
              <input
                value={editFolder}
                placeholder="/ (library root)"
                onChange={(e) => setEditFolder(e.target.value)}
              />
            </label>
          </div>
          <ModalActions>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleRename}>
              Save
            </Button>
          </ModalActions>
        </Modal>
      )}

      {toDelete && !inUse && (
        <Modal onClose={() => setToDelete(null)}>
          <ModalHeader>
            <ModalIcon tone="bad">
              <Trash2 size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Delete file?</h3>
              <ModalBody>
                Delete <strong>{toDelete.filename}</strong> permanently? If any entry still
                references it, the delete will be refused rather than breaking that entry.
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

      {inUse && (
        <Modal
          onClose={() => {
            setInUse(null)
            setToDelete(null)
          }}
        >
          <ModalHeader>
            <ModalIcon tone="bad">
              <Link size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>This file is still in use</h3>
              <ModalBody>
                {toDelete?.filename} is referenced by {inUse.usage_count}{' '}
                {inUse.usage_count === 1 ? 'entry' : 'entries'}. Remove the reference from each one,
                then delete the file.
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <div className={styles.usageList}>
            {inUse.referrers.map((u) => (
              <div key={`${u.project}/${u.env}/${u.collection}/${u.entry_id}`} className={styles.usageRow}>
                <span className={styles.usageScope}>
                  {u.project}/{u.env}
                </span>
                <span>
                  {u.collection} · {u.entry_id}
                </span>
              </div>
            ))}
            {inUse.usage_count > inUse.visible_count && (
              // Media is instance-global but entries are scoped, so a key
              // confined to one project learns the extent without learning
              // where the rest live.
              <div className={styles.usageHidden}>
                {inUse.usage_count - inUse.visible_count} more in projects this key cannot read.
              </div>
            )}
          </div>
          <ModalActions>
            <Button
              variant="secondary"
              onClick={() => {
                setInUse(null)
                setToDelete(null)
              }}
            >
              Close
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
