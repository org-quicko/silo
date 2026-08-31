import { Folder, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { MediaPath } from './media-path'
import table from '../../components/data/DataTable.module.css'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  /** `undefined` while its count is still loading. */
  itemCount: number | undefined
  gridCols: string
  /** Whether the asset rows beside this one carry a leading checkbox column
   *  — folders are never selectable, but the grid still has to line up. */
  checkboxGap: boolean
  canEdit: boolean
  canDelete: boolean
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}

/**
 * `FolderTile`'s row form for list view.
 *
 * A clickable name cell plus a separate actions cell, not a `<button>`
 * wrapping the whole row: rename and delete are buttons of their own now
 * (D49), and nesting a button inside a button is invalid HTML.
 */
export function FolderRow({ path, itemCount, gridCols, checkboxGap, canEdit, canDelete, onOpen, onRename, onDelete }: Props) {
  const name = MediaPath.name(path)
  return (
    <div className={`${table.row} ${styles.fileRow}`} style={{ ['--cols' as any]: gridCols }}>
      {checkboxGap && <div className={table.cell} />}
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
            <Pencil size={11} />
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
            <Trash2 size={11} />
          </Button>
        )}
      </div>
    </div>
  )
}
