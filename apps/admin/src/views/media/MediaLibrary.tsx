import { useRef, useState } from 'react'
import { Folder, FolderPlus, LayoutGrid, List, Plus, X } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Checkbox } from '../../components/controls/Checkbox'
import { Segmented } from '../../components/controls/Segmented'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import { TopBar } from '../shell/TopBar'
import { AssetInUseDialog } from './AssetInUseDialog'
import { DeleteAssetDialog } from './DeleteAssetDialog'
import { FolderRow } from './FolderRow'
import { FolderTile } from './FolderTile'
import { MediaCard } from './MediaCard'
import { MediaPath } from './media-path'
import { MediaRow } from './MediaRow'
import { MediaSelectionBar } from './MediaSelectionBar'
import { RenameAssetDialog } from './RenameAssetDialog'
import { UploadZone } from './UploadZone'
import { useMediaDeleteFlow } from './use-media-delete-flow'
import { MediaPageSize, useMediaLibrary } from './use-media-library'
import table from '../../components/data/DataTable.module.css'
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
  const deleteFlow = useMediaDeleteFlow(library.bulkDelete)
  const [editing, setEditing] = useState<MediaAsset | null>(null)
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
  const pageSelected = library.assets.length > 0 && library.assets.every((asset) => library.selected.has(asset.id))
  const pageIndeterminate = !pageSelected && library.assets.some((asset) => library.selected.has(asset.id))

  const pathSegments = MediaPath.segments(library.folder)
  const hasQuery = library.query.trim() !== ''
  const nothingHere = library.subfolders.length === 0 && library.assets.length === 0
  // The empty state doubles as the upload invitation, so it only makes that
  // offer when the folder is genuinely empty — a filter hiding real content
  // gets told about the filter instead, never "drop a file here".
  const genuinelyEmpty = nothingHere && !hasQuery

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

        {library.error && (
          <div className={styles.error}>
            <span>{library.error}</span>
            <button type="button" onClick={() => library.setError('')}>
              <X size={13} />
            </button>
          </div>
        )}

        {library.stalled && (
          <div className={styles.stalled}>
            <span>{library.stalled}</span>
            <button type="button" onClick={() => library.setStalled('')}>
              <X size={13} />
            </button>
          </div>
        )}

        {library.deleteIssues && (
          <div className={styles.deleteIssues}>
            <span>{library.deleteIssues}</span>
            <button type="button" onClick={() => library.setDeleteIssues('')}>
              <X size={13} />
            </button>
          </div>
        )}

        <div className={styles.pathRow}>
          <nav className={styles.pathTrail} aria-label="Folder path">
            {library.folder === '' ? (
              <span className={styles.pathCurrent}>All files</span>
            ) : (
              <button type="button" className={styles.pathCrumb} onClick={() => library.selectFolder('')}>
                All files
              </button>
            )}
            {pathSegments.map((segment, index) => (
              <span key={segment.path} className={styles.pathSegment}>
                <span className={styles.pathSep}>/</span>
                {index === pathSegments.length - 1 ? (
                  <span className={styles.pathCurrent}>{segment.name}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.pathCrumb}
                    onClick={() => library.selectFolder(segment.path)}
                  >
                    {segment.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
        </div>

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

        {genuinelyEmpty ? (
          canUpload ? (
            <UploadZone
              folder={library.folder}
              uploading={library.uploading}
              onFiles={library.upload}
              onBrowse={browse}
            />
          ) : (
            <div className={`center-wrap ${styles.empty}`}>
              <Folder size={32} strokeWidth={1.5} />
              <span>This folder is empty.</span>
            </div>
          )
        ) : library.loading && nothingHere ? (
          <div className={`center-wrap ${styles.loading}`}>Loading media library…</div>
        ) : nothingHere ? (
          <div className={`center-wrap ${styles.empty}`}>
            <Folder size={32} strokeWidth={1.5} />
            <span>No files match “{library.query}”.</span>
          </div>
        ) : view === 'grid' ? (
          <>
            <div className={styles.grid}>
              {library.subfolders.map((path) => (
                <FolderTile
                  key={path}
                  path={path}
                  itemCount={library.folderCounts[path]}
                  onOpen={() => library.selectFolder(path)}
                />
              ))}
              {library.assets.map((asset) => (
                <MediaCard
                  key={asset.id}
                  asset={asset}
                  baseUrl={baseUrl}
                  canEdit={canUpload}
                  canDelete={canDelete}
                  selected={library.selected.has(asset.id)}
                  onToggleSelect={() => library.toggleSelected(asset.id)}
                  onEdit={() => setEditing(asset)}
                  onDelete={() => deleteFlow.start([asset])}
                />
              ))}
            </div>

            {library.assets.length === 0 && hasQuery && (
              <p className={styles.noMatchNote}>No files match these filters.</p>
            )}
          </>
        ) : (
          <>
            <div className="card">
              <div
                className={`${table.header} ${table.table}`}
                style={{ ['--cols' as any]: listCols }}
              >
                {canDelete && (
                  <span className={styles.checkboxCell}>
                    <Checkbox
                      checked={pageSelected}
                      indeterminate={pageIndeterminate}
                      onChange={(checked) =>
                        library.selectMany(library.assets.map((asset) => asset.id), checked)
                      }
                      aria-label="Select all files on this page"
                    />
                  </span>
                )}
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Status</span>
                <span />
              </div>
              {library.subfolders.map((path) => (
                <FolderRow
                  key={path}
                  path={path}
                  itemCount={library.folderCounts[path]}
                  gridCols={listCols}
                  checkboxGap={canDelete}
                  onOpen={() => library.selectFolder(path)}
                />
              ))}
              {library.assets.map((asset) => (
                <MediaRow
                  key={asset.id}
                  asset={asset}
                  baseUrl={baseUrl}
                  canEdit={canUpload}
                  canDelete={canDelete}
                  gridCols={listCols}
                  selected={library.selected.has(asset.id)}
                  onToggleSelect={() => library.toggleSelected(asset.id)}
                  onEdit={() => setEditing(asset)}
                  onDelete={() => deleteFlow.start([asset])}
                />
              ))}
            </div>

            {library.assets.length === 0 && hasQuery && (
              <p className={styles.noMatchNote}>No files match these filters.</p>
            )}
          </>
        )}

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

      {editing && (
        <RenameAssetDialog
          asset={editing}
          onSave={async (filename, folder) => {
            if (await library.rename(editing.id, filename, folder)) setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteFlow.confirming && (
        <DeleteAssetDialog
          assets={deleteFlow.confirming}
          busy={deleteFlow.busy}
          onConfirm={deleteFlow.confirm}
          onClose={deleteFlow.cancel}
        />
      )}

      {deleteFlow.inUse && (
        <AssetInUseDialog
          assets={deleteFlow.inUse}
          checked={deleteFlow.forceChecked}
          busy={deleteFlow.busy}
          onCheckedChange={deleteFlow.setForceChecked}
          onForceDelete={deleteFlow.forceDelete}
          onClose={deleteFlow.cancel}
        />
      )}
    </>
  )
}
