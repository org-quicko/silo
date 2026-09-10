import { useState } from 'react'
import { Folder, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Checkbox } from '../../components/controls/Checkbox'
import { MediaPath } from './media-path'
import table from '../../components/data/DataTable.module.css'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  /** `undefined` while its count is still loading. */
  itemCount: number | undefined
  gridCols: string
  /** Whether the asset rows beside this one carry a leading checkbox column
   *  — also whether this row's own checkbox renders, so the grid lines up
   *  either way. */
  showCheckbox: boolean
  selected: boolean
  onToggleSelect: () => void
  canEdit: boolean
  canDelete: boolean
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDropToFolder?: (targetFolder: string, e: React.DragEvent) => void
}

/**
 * `FolderTile`'s row form for list view with drag-and-drop support.
 */
export function FolderRow({
  path,
  itemCount,
  gridCols,
  showCheckbox,
  selected,
  onToggleSelect,
  canEdit,
  canDelete,
  onOpen,
  onRename,
  onDelete,
  onDragStart,
  onDropToFolder,
}: Props) {
  const name = MediaPath.name(path)
  const [dragOver, setDragOver] = useState(false)

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
      className={`${table.row} ${styles.fileRow} ${dragOver ? styles.dropTargetActive : ''}`}
      style={{ ['--cols' as any]: gridCols }}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showCheckbox && (
        <div className={`${table.cell} ${styles.checkboxCell}`}>
          <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`Select ${name}`} />
        </div>
      )}
      <button
        type="button"
        className={`${table.cell} ${table.clickable} ${styles.rowName} ${styles.rowNameButton}`}
        onClick={onOpen}
      >
        <span className={styles.rowIcon}>
          <Folder size={15} />
        </span>
        <span className={table.title} title={name}>
          {name}
        </span>
      </button>
      <div className={table.cell}>
        {itemCount === undefined ? '…' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
      </div>
      <div className={table.cell} />
      <div className={`${table.cell} ${table.actions} ${styles.rowActions}`}>
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.iconAction}
            title="Rename or move"
            onClick={onRename}
          >
            <Pencil size={14} />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="dangerGhost"
            size="sm"
            className={styles.iconAction}
            title="Delete folder"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
