import { Folder } from 'lucide-react'
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
  onOpen: () => void
}

/** `FolderTile`'s row form for list view. */
export function FolderRow({ path, itemCount, gridCols, checkboxGap, onOpen }: Props) {
  const name = MediaPath.name(path)
  return (
    <button
      type="button"
      className={`${table.row} ${table.clickable} ${styles.rowReset}`}
      style={{ ['--cols' as any]: gridCols }}
      onClick={onOpen}
    >
      {checkboxGap && <div className={table.cell} />}
      <div className={`${table.cell} ${styles.rowName}`}>
        <span className={styles.rowIcon}>
          <Folder size={15} />
        </span>
        <span className={table.title} title={name}>
          {name}
        </span>
      </div>
      <div className={table.cell}>
        {itemCount === undefined ? '…' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
      </div>
      <div className={table.cell} />
      <div className={table.cell} />
      <div className={`${table.cell} ${table.actions}`} />
    </button>
  )
}
