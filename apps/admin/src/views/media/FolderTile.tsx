import { useState } from 'react'
import { Folder, MoreHorizontal } from 'lucide-react'
import { Checkbox } from '../../components/controls/Checkbox'
import { MediaCardMenu } from './MediaCardMenu'
import { MediaPath } from './media-path'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  /** `undefined` while its count is still loading. */
  itemCount: number | undefined
  canEdit: boolean
  /** Also whether the tile is selectable at all — the checkbox is a bulk
   *  delete tool, so it needs the same claim the trash icon does. */
  canDelete: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDropToFolder?: (targetFolder: string, e: React.DragEvent) => void
}

/** One folder in the grid — a header row and a big folder glyph stand in for
 *  the preview and file metadata a `MediaCard` shows. Rename and delete move
 *  into the "more" menu (D49) rather than a persistent action row, since the
 *  tile has no footer to hold them in. */
export function FolderTile({
  path,
  itemCount,
  canEdit,
  canDelete,
  selected,
  onToggleSelect,
  onOpen,
  onRename,
  onDelete,
  onDragStart,
  onDropToFolder,
}: Props) {
  const name = MediaPath.name(path)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const count = itemCount === undefined ? '…' : `${itemCount} item${itemCount === 1 ? '' : 's'}`

  const handleDragOver = (e: React.DragEvent) => {
    if (!canEdit) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnter = (e: React.DragEvent) => {
    if (!canEdit) return
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!canEdit) return
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!canEdit) return
    e.preventDefault()
    setDragOver(false)
    onDropToFolder?.(path, e)
  }

  return (
    <div
      className={`${styles.assetCard} ${selected ? styles.cardSelected : ''} ${menuOpen ? styles.cardMenuOpen : ''} ${dragOver ? styles.dropTargetActive : ''}`}
      role="button"
      tabIndex={0}
      draggable={canEdit}
      aria-label={`Open folder ${name}, ${count}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      onDragStart={onDragStart}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardHeadIcon}>
          <Folder size={16} />
        </span>
        <span className={styles.cardHeadName} title={name}>
          {name}
        </span>
        {(canEdit || canDelete) && (
          <button
            type="button"
            className={styles.cardMore}
            title="More"
            aria-label="More options"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>

      <div className={`${styles.thumb} ${styles.thumbFolder}`}>
        {canDelete && (
          <span className={styles.thumbCheckbox} onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`Select ${name}`} />
          </span>
        )}
        <Folder size={44} strokeWidth={1.5} fill="currentColor" />
      </div>

      {menuOpen && (
        <MediaCardMenu
          canRename={canEdit}
          onRename={() => {
            setMenuOpen(false)
            onRename()
          }}
          canDelete={canDelete}
          onDelete={() => {
            setMenuOpen(false)
            onDelete()
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}
