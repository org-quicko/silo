import { Folder } from 'lucide-react'
import type { ReactNode } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Checkbox } from '../../components/controls/Checkbox'
import { LoadingState } from '../../components/feedback/LoadingState'
import { FolderRow } from './FolderRow'
import { FolderTile } from './FolderTile'
import { MediaCard } from './MediaCard'
import { MediaRow } from './MediaRow'
import { UploadZone } from './UploadZone'
import type { useMediaDeleteFlow } from './use-media-delete-flow'
import type { useMediaLibrary } from './use-media-library'
import type { useMediaRenameFolderFlow } from './use-media-rename-folder-flow'
import table from '../../components/data/DataTable.module.css'
import styles from './MediaLibrary.module.css'

interface Props {
  view: 'grid' | 'list'
  library: ReturnType<typeof useMediaLibrary>
  deleteFlow: ReturnType<typeof useMediaDeleteFlow>
  renameFolderFlow: ReturnType<typeof useMediaRenameFolderFlow>
  canUpload: boolean
  canDelete: boolean
  baseUrl: string
  listCols: string
  onBrowse: () => void
  onEditAsset: (asset: MediaAsset) => void
  /** List view only — rendered as the card's own last row (the grid has no
   *  enclosing card to sit inside, so `MediaLibraryView` renders it as its
   *  own block below the tiles there instead). */
  pagination?: ReactNode
}

/**
 * What the current folder shows: the empty states, and the folders and files
 * in whichever of the two layouts is selected.
 *
 * One component for both layouts rather than a `MediaGrid` and a `MediaList`,
 * because they render the same facts from the same props and differ only in the
 * shape they put them in — two files would be two identical prop lists to keep
 * in step. `library` and the flows are passed whole for the reason
 * `MediaDialogs` takes them that way.
 */
export function MediaContents({
  view,
  library,
  deleteFlow,
  renameFolderFlow,
  canUpload,
  canDelete,
  baseUrl,
  listCols,
  onBrowse,
  onEditAsset,
  pagination,
}: Props) {
  const hasQuery = library.query.trim() !== ''
  const nothingHere = library.subfolders.length === 0 && library.assets.length === 0
  // The empty state doubles as the upload invitation, so it only makes that
  // offer when the folder is genuinely empty. A filter hiding real content gets
  // told about the filter instead, never "drop a file here".
  const genuinelyEmpty = nothingHere && !hasQuery

  if (genuinelyEmpty) {
    return canUpload ? (
      <UploadZone
        folder={library.folder}
        uploading={library.uploading}
        onFiles={library.upload}
        onBrowse={onBrowse}
      />
    ) : (
      <div className={`center-wrap ${styles.empty}`}>
        <Folder size={32} strokeWidth={1.5} />
        <span>This folder is empty.</span>
      </div>
    )
  }

  if (library.loading && nothingHere) {
    return <LoadingState message="Loading the media library…" />
  }

  if (nothingHere) {
    return (
      <div className={`center-wrap ${styles.empty}`}>
        <Folder size={32} strokeWidth={1.5} />
        <span>No files match “{library.query}”.</span>
      </div>
    )
  }

  const noMatchNote = library.assets.length === 0 && hasQuery && (
    <p className={styles.noMatchNote}>No files match these filters.</p>
  )

  const openFolder = (path: string) => () => library.selectFolder(path)
  const renameFolder = (path: string) => () => renameFolderFlow.start(path)
  const deleteFolder = (path: string) => () => deleteFlow.startFolder(path)

  if (view === 'grid') {
    return (
      <>
        <div className={styles.grid}>
          {library.subfolders.map((path) => (
            <FolderTile
              key={path}
              path={path}
              itemCount={library.folderCounts[path]}
              canEdit={canUpload}
              canDelete={canDelete}
              selected={library.selectedFolders.has(path)}
              onToggleSelect={() => library.toggleFolderSelected(path)}
              onOpen={openFolder(path)}
              onRename={renameFolder(path)}
              onDelete={deleteFolder(path)}
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
              onEdit={() => onEditAsset(asset)}
              onDelete={() => deleteFlow.start([asset])}
            />
          ))}
        </div>
        {noMatchNote}
      </>
    )
  }

  const pageItemCount = library.subfolders.length + library.assets.length
  const pageSelectedCount =
    library.subfolders.filter((path) => library.selectedFolders.has(path)).length +
    library.assets.filter((asset) => library.selected.has(asset.id)).length
  const pageSelected = pageItemCount > 0 && pageSelectedCount === pageItemCount
  const pageIndeterminate = !pageSelected && pageSelectedCount > 0

  return (
    <>
      <div className="card">
        <div className={`${table.header} ${table.table}`} style={{ ['--cols' as any]: listCols }}>
          {canDelete && (
            <span className={styles.checkboxCell}>
              <Checkbox
                checked={pageSelected}
                indeterminate={pageIndeterminate}
                onChange={(checked) =>
                  library.selectAllOnPage(
                    library.assets.map((asset) => asset.id),
                    library.subfolders,
                    checked,
                  )
                }
                aria-label="Select all files and folders on this page"
              />
            </span>
          )}
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
          <span />
        </div>
        {library.subfolders.map((path) => (
          <FolderRow
            key={path}
            path={path}
            itemCount={library.folderCounts[path]}
            gridCols={listCols}
            showCheckbox={canDelete}
            selected={library.selectedFolders.has(path)}
            onToggleSelect={() => library.toggleFolderSelected(path)}
            canEdit={canUpload}
            canDelete={canDelete}
            onOpen={openFolder(path)}
            onRename={renameFolder(path)}
            onDelete={deleteFolder(path)}
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
            onEdit={() => onEditAsset(asset)}
            onDelete={() => deleteFlow.start([asset])}
          />
        ))}
        {pagination}
      </div>
      {noMatchNote}
    </>
  )
}
