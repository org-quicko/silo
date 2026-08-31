import { useRef, useState } from 'react'
import { FolderPlus, LayoutGrid, List, Plus, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Segmented } from '../../components/controls/Segmented'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import { TopBar } from '../shell/TopBar'
import { MediaDialogs } from './MediaDialogs'
import { MediaNotice } from './MediaNotice'
import { MediaPathTrail } from './MediaPathTrail'
import { MediaContents } from './MediaContents'
import { MediaSelectionBar } from './MediaSelectionBar'
import { useMediaDeleteFlow } from './use-media-delete-flow'
import { MediaPageSize, useMediaLibrary } from './use-media-library'
import { useMediaPurge } from './use-media-purge'
import { useMediaRenameFolderFlow } from './use-media-rename-folder-flow'
import styles from './MediaLibrary.module.css'

type LibraryView = 'grid' | 'list'

const VIEW_KEY = 'silo_media_view'
const LIST_COLS = 'minmax(0, 1fr) 100px 100px 140px 96px'
/** With the leading checkbox column — list view, once `media:delete` makes
 *  a row selectable. */
const LIST_COLS_SELECTABLE = `28px ${LIST_COLS}`

interface Props {
  serverId: string
  scope: ScopeRef
  collections: readonly { name: string; count: number | null; schema?: any }[]
  url: string
  apiKey: string
  claims: string[]
  /** A search carried in by the URL — the command palette links assets this way. */
  initialQuery?: string
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
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
  onOpenPalette,
  onNavigateToCollection,
}: Props) {
  const library = useMediaLibrary(url, apiKey, initialQuery)
  const deleteFlow = useMediaDeleteFlow(library.bulkDelete, library.deleteFolderRecursive)
  const purgeFlow = useMediaPurge(library.purge)
  const renameFolderFlow = useMediaRenameFolderFlow(library.renameFolder)
  const [editing, setEditing] = useState<MediaAsset | null>(null)
  const [editingBusy, setEditingBusy] = useState(false)
  const [view, setView] = useState<LibraryView>(
    () => (localStorage.getItem(VIEW_KEY) as LibraryView | null) || 'grid',
  )
  const fileInput = useRef<HTMLInputElement>(null)

  const canUpload = Claims.has(claims, Claims.MediaCreate)
  const canDelete = Claims.has(claims, Claims.MediaDelete)
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
  const listCols = canDelete ? LIST_COLS_SELECTABLE : LIST_COLS

  const browse = () => fileInput.current?.click()

  const changeView = (next: LibraryView) => {
    setView(next)
    localStorage.setItem(VIEW_KEY, next)
  }

  const createFolder = () => {
    const name = prompt('New folder name')?.trim()
    if (!name) return
    library.createFolder(library.folder ? `${library.folder}/${name}` : `/${name}`)
  }

  const selectedAssets = library.assets.filter((asset) => library.selected.has(asset.id))


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
          {canUpload && (
            <div className="head-actions">
              <Button variant="secondary" onClick={createFolder}>
                <FolderPlus size={14} /> New folder
              </Button>
              <Button variant="primary" onClick={browse} disabled={library.uploading}>
                <Plus size={14} /> Upload files
              </Button>
            </div>
          )}
        </div>

        {canDelete && (
          <div className={styles.purgeRow}>
            <Button variant="dangerGhost" size="sm" onClick={purgeFlow.start}>
              <Trash2 size={12} /> Purge library
            </Button>
          </div>
        )}

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
          <span className={styles.count}>
            {library.total} file{library.total === 1 ? '' : 's'}
          </span>
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

        {canDelete && selectedAssets.length > 0 && (
          <MediaSelectionBar
            count={selectedAssets.length}
            onClear={library.clearSelection}
            onDelete={() => deleteFlow.start(selectedAssets)}
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
        />

        {library.total > MediaPageSize && (
          <div className={styles.pager}>
            <Button
              variant="secondary"
              size="sm"
              disabled={library.offset === 0}
              onClick={() => library.setOffset(Math.max(0, library.offset - MediaPageSize))}
            >
              Previous
            </Button>
            <span>
              {library.offset + 1}–{Math.min(library.offset + MediaPageSize, library.total)} of{' '}
              {library.total}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={library.offset + MediaPageSize >= library.total}
              onClick={() => library.setOffset(library.offset + MediaPageSize)}
            >
              Next
            </Button>
          </div>
        )}
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
            if (await library.rename(editing.id, filename, folder)) setEditing(null)
          } finally {
            setEditingBusy(false)
          }
        }}
        onCloseRenameAsset={() => setEditing(null)}
      />
    </>
  )
}
