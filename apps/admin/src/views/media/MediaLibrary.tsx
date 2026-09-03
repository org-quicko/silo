import { useEffect, useRef, useState } from 'react'
import { FolderPlus, LayoutGrid, List, MoreVertical, Plus, Settings, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Segmented } from '../../components/controls/Segmented'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { Pagination } from '../../components/data/Pagination'
import { Link } from '../../router/Link'
import { Routes } from '../../router/routes'
import { SmartSearch } from '../search/SmartSearch'
import { TopBar } from '../shell/TopBar'
import { MediaDialogs } from './MediaDialogs'
import { MediaModifiedFilter } from './MediaModifiedFilter'
import { MediaNotice } from './MediaNotice'
import { MediaPath } from './media-path'
import { MediaPathTrail } from './MediaPathTrail'
import { MediaContents } from './MediaContents'
import { MediaSelectionBar } from './MediaSelectionBar'
import { MediaTypeFilter } from './MediaTypeFilter'
import { useMediaDeleteFlow, type DeleteSubject } from './use-media-delete-flow'
import { useMediaLibrary } from './use-media-library'
import { useMediaPurge } from './use-media-purge'
import { useMediaRenameFolderFlow } from './use-media-rename-folder-flow'
import { ToastManager } from '../../utils/toast-manager'
import styles from './MediaLibrary.module.css'

type LibraryView = 'grid' | 'list'

const VIEW_KEY = 'silo_media_view'
const LIST_COLS = 'minmax(0, 1fr) 100px 100px 112px'
/** With the leading checkbox column — list view, once `media:delete` makes
 *  a row selectable. */
const LIST_COLS_SELECTABLE = `28px ${LIST_COLS}`

function deletedMessage(subject: DeleteSubject): string {
  if (subject.kind === 'folder') return `Folder "${MediaPath.name(subject.path)}" deleted`
  const count = subject.kind === 'mixed' ? subject.assets.length + subject.folderPaths.length : subject.assets.length
  return count === 1 ? 'File deleted' : `${count} items deleted`
}

interface Props {
  serverId: string
  scope: ScopeRef
  collections: readonly { name: string; count: number | null }[]
  url: string
  apiKey: string
  claims: string[]
  /** A search carried in by the URL — the command palette links assets this way. */
  initialQuery?: string
}

/**
 * The media library: one instance-global catalog (D23), browsed one folder
 * at a time like a directory tree — folders and files share the same grid at
 * whatever level you're at, and clicking a folder navigates into it rather
 * than just filtering the current view.
 *
 * The contents and every operation on them live in `useMediaLibrary`; this file
 * is the page.
 */
export function MediaLibraryView({
  serverId,
  scope,
  collections,
  url,
  apiKey,
  claims,
  initialQuery = '',
}: Props) {
  const library = useMediaLibrary(url, apiKey, initialQuery)
  const deleteFlow = useMediaDeleteFlow(library.bulkDelete, library.deleteFolderRecursive, (subject) =>
    ToastManager.show(deletedMessage(subject)),
  )
  const purgeFlow = useMediaPurge(library.purge, () => ToastManager.show('Media library purged'))
  const renameFolderFlow = useMediaRenameFolderFlow(library.renameFolder, () => ToastManager.show('Folder renamed'))
  const [editing, setEditing] = useState<MediaAsset | null>(null)
  const [editingBusy, setEditingBusy] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [creatingFolderBusy, setCreatingFolderBusy] = useState(false)
  const [headMenuOpen, setHeadMenuOpen] = useState(false)
  const [view, setView] = useState<LibraryView>(
    () => (localStorage.getItem(VIEW_KEY) as LibraryView | null) || 'grid',
  )
  const fileInput = useRef<HTMLInputElement>(null)
  const headMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!headMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (headMenuRef.current && !headMenuRef.current.contains(e.target as Node)) setHeadMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [headMenuOpen])

  const canUpload = Claims.has(claims, Claims.MediaCreate)
  const canDelete = Claims.has(claims, Claims.MediaDelete)
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
  const listCols = canDelete ? LIST_COLS_SELECTABLE : LIST_COLS

  const browse = () => fileInput.current?.click()

  const changeView = (next: LibraryView) => {
    setView(next)
    localStorage.setItem(VIEW_KEY, next)
  }

  const submitNewFolder = async (name: string) => {
    setCreatingFolderBusy(true)
    try {
      if (await library.createFolder(library.folder ? `${library.folder}/${name}` : `/${name}`)) {
        ToastManager.show(`Folder "${name}" created`)
      }
    } finally {
      setCreatingFolderBusy(false)
      setCreatingFolder(false)
    }
  }

  const selectedAssets = library.assets.filter((asset) => library.selected.has(asset.id))
  const selectedFolderPaths = library.subfolders.filter((path) => library.selectedFolders.has(path))
  const selectedCount = selectedAssets.length + selectedFolderPaths.length

  const pager = library.total > 0 && (
    <Pagination
      bordered={view === 'grid'}
      page={Math.floor(library.offset / library.pageSize) + 1}
      pageSize={library.pageSize}
      total={library.total}
      onPageChange={(page) => library.setOffset((page - 1) * library.pageSize)}
      onPageSizeChange={library.setPageSize}
    />
  )


  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            url={url}
            apiKey={apiKey}
            scope={scope}
            claims={claims}
            collections={collections}
          />
        }
      />

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Admin' }, { label: 'Media Library' }]} />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => event.target.files && library.upload(event.target.files)}
        />

        <div className={`page-head ${styles.pageHeader}`}>
          <div className="page-title-group">
            <h2 className="page-title">Media Library</h2>
            <span className="page-sub">
              One library for the whole instance. Collections reference these files by ID,
              <br />
              so a file can be reused across entries.
            </span>
          </div>
          <div className="head-actions">
            {canUpload && (
              <>
                <Button variant="secondary" onClick={() => setCreatingFolder(true)}>
                  <FolderPlus size={14} /> New folder
                </Button>
                <Button variant="primary" onClick={browse} disabled={library.uploading}>
                  <Plus size={14} /> Upload files
                </Button>
              </>
            )}
            <div ref={headMenuRef} className={styles.headMenuWrap}>
              <Button
                variant="secondary"
                className={styles.headMenuButton}
                aria-label="More actions"
                title="More actions"
                onClick={() => setHeadMenuOpen((open) => !open)}
              >
                <MoreVertical size={16} />
              </Button>
              {headMenuOpen && (
                <div className={styles.headMenu}>
                  <Link
                    to={Routes.serverSettings(serverId, 'media-storage')}
                    className={styles.cardMenuItem}
                    onNavigate={() => setHeadMenuOpen(false)}
                  >
                    <Settings size={14} /> <span>Storage settings</span>
                  </Link>
                  {canDelete && (
                    <button
                      type="button"
                      className={`${styles.cardMenuItem} ${styles.cardMenuDanger}`}
                      onClick={() => {
                        setHeadMenuOpen(false)
                        purgeFlow.start()
                      }}
                    >
                      <Trash2 size={14} /> <span>Purge library</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <MediaNotice
          message={library.error}
          className={styles.error}
          onDismiss={() => library.setError('')}
        />
        <MediaNotice
          message={library.stalled}
          className={styles.stalled}
          onDismiss={() => library.setStalled('')}
        />
        <MediaNotice
          message={library.deleteIssues}
          className={styles.deleteIssues}
          onDismiss={() => library.setDeleteIssues('')}
        />

        <MediaPathTrail folder={library.folder} onSelectFolder={library.selectFolder} />

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <span className={styles.count}>
              {library.total} file{library.total === 1 ? '' : 's'}
            </span>
            <MediaTypeFilter extensions={library.extensions} value={library.ext} onChange={library.setExt} />
            <MediaModifiedFilter value={library.modified} onChange={library.setModified} />
          </div>
          <Segmented
            value={view}
            onChange={changeView}
            variant="compact"
            options={[
              { value: 'grid', label: <LayoutGrid size={14} /> },
              { value: 'list', label: <List size={14} /> },
            ]}
          />
        </div>

        {canDelete && selectedCount > 0 && (
          <MediaSelectionBar
            count={selectedCount}
            onClear={library.clearSelection}
            onDelete={() => deleteFlow.startMixed(selectedAssets, selectedFolderPaths)}
          />
        )}

        <MediaContents
          view={view}
          library={library}
          deleteFlow={deleteFlow}
          renameFolderFlow={renameFolderFlow}
          canUpload={canUpload}
          canDelete={canDelete}
          baseUrl={baseUrl}
          listCols={listCols}
          onBrowse={browse}
          onEditAsset={setEditing}
          pagination={view === 'list' ? pager : undefined}
        />

        {view === 'grid' && pager}
      </div>

      <MediaDialogs
        claims={claims}
        editing={editing}
        editingBusy={editingBusy}
        deleteFlow={deleteFlow}
        purgeFlow={purgeFlow}
        renameFolderFlow={renameFolderFlow}
        onRenameAsset={async (filename, folder) => {
          if (!editing) return
          setEditingBusy(true)
          try {
            if (await library.rename(editing.id, filename, folder)) {
              setEditing(null)
              ToastManager.show('File updated')
            }
          } finally {
            setEditingBusy(false)
          }
        }}
        onCloseRenameAsset={() => setEditing(null)}
        creatingFolder={creatingFolder}
        creatingFolderBusy={creatingFolderBusy}
        newFolderParent={library.folder}
        onCreateFolder={submitNewFolder}
        onCloseNewFolder={() => setCreatingFolder(false)}
      />
    </>
  )
}
