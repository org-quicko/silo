import { useRef, useState } from 'react'
import { Image, Plus, RefreshCw, Search, X } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaInUse } from '../../api/types/media-usage'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import { TopBar } from '../shell/TopBar'
import type { SessionBadge } from '../shell/session-badge'
import { AssetInUseDialog } from './AssetInUseDialog'
import { DeleteAssetDialog } from './DeleteAssetDialog'
import { FolderRail } from './FolderRail'
import { MediaCard } from './MediaCard'
import { RenameAssetDialog } from './RenameAssetDialog'
import { UploadZone } from './UploadZone'
import { MediaPageSize, useMediaLibrary } from './use-media-library'
import styles from './MediaLibrary.module.css'

interface Props {
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
}

/**
 * The media library: one instance-global catalog (D23), browsed by folder and
 * searched server-side.
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
  session,
  claims,
  initialQuery = '',
  onOpenPalette,
  onNavigateToCollection,
}: Props) {
  const library = useMediaLibrary(url, apiKey, initialQuery)
  const [editing, setEditing] = useState<MediaAsset | null>(null)
  const [toDelete, setToDelete] = useState<MediaAsset | null>(null)
  const [inUse, setInUse] = useState<MediaInUse | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const canUpload = Claims.has(claims, Claims.MediaCreate)
  const canDelete = Claims.has(claims, Claims.MediaDelete)
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''

  const browse = () => fileInput.current?.click()

  const createFolder = () => {
    const path = prompt('New folder path', library.folder ? `${library.folder}/` : '/')
    if (path) library.createFolder(path)
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    const blocked = await library.remove(toDelete.id)
    if (blocked) setInUse(blocked)
    else setToDelete(null)
  }

  const closeInUse = () => {
    setInUse(null)
    setToDelete(null)
  }

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
          <Button variant="primary" onClick={browse} disabled={library.uploading}>
            <Plus size={15} /> Upload
          </Button>
        )}
      </TopBar>

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Library' }, { label: 'Media' }]} />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => event.target.files && library.upload(event.target.files)}
        />

        <div className={`page-head ${styles.pageHeader}`}>
          <div className="page-title-group">
            <h2 className="page-title">Media</h2>
            <span className="page-sub">
              One library for the whole instance. Entries reference files by id.
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refresh}
            onClick={library.reload}
            disabled={library.loading}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
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

        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={14} />
            <input
              placeholder="Search files…"
              value={library.search}
              onChange={(event) => library.setSearch(event.target.value)}
            />
          </div>
          <span className={styles.count}>
            {library.total} file{library.total === 1 ? '' : 's'}
            {library.folder ? ` in ${library.folder}` : ''}
          </span>
        </div>

        <div className={styles.layout}>
          <FolderRail
            folders={library.folders}
            selected={library.folder}
            canCreate={canUpload}
            onSelect={library.selectFolder}
            onCreate={createFolder}
          />

          <div className={styles.main}>
            {canUpload && (
              <UploadZone
                folder={library.folder}
                uploading={library.uploading}
                onFiles={library.upload}
                onBrowse={browse}
              />
            )}

            {library.loading && library.assets.length === 0 ? (
              <div className={`center-wrap ${styles.loading}`}>Loading media library…</div>
            ) : library.assets.length === 0 ? (
              <div className={`center-wrap ${styles.empty}`}>
                <Image size={32} strokeWidth={1.5} />
                <span>
                  {library.query
                    ? `Nothing matches “${library.query}”.`
                    : 'No media files here yet.'}
                </span>
              </div>
            ) : (
              <div className={styles.grid}>
                {library.assets.map((asset) => (
                  <MediaCard
                    key={asset.id}
                    asset={asset}
                    baseUrl={baseUrl}
                    canEdit={canUpload}
                    canDelete={canDelete}
                    onEdit={() => setEditing(asset)}
                    onDelete={() => setToDelete(asset)}
                  />
                ))}
              </div>
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
        </div>
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

      {toDelete && !inUse && (
        <DeleteAssetDialog
          asset={toDelete}
          onConfirm={confirmDelete}
          onClose={() => setToDelete(null)}
        />
      )}

      {inUse && (
        <AssetInUseDialog
          filename={toDelete?.filename ?? ''}
          inUse={inUse}
          onClose={closeInUse}
        />
      )}
    </>
  )
}
