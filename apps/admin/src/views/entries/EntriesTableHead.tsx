import type { ReactNode } from 'react'
import { JsonPath } from '@silo/shared/json-path'
import { ColumnResizer } from './ColumnResizer'
import { ColumnWidths } from './column-widths'
import table from '../../components/data/DataTable.module.css'
import styles from './Entries.module.css'

/** What a heading needs to let its right edge be dragged. */
export interface ColumnResize {
  clamp: (width: number) => number
  preview: (name: string, width: number) => void
  commit: (name: string, width: number) => void
  reset: (name: string) => void
}

/**
 * The entries table's heading row: one sortable cell per column, each of the
 * data columns resizable by its right edge. `Updated` is not — it takes
 * whatever the others leave, which is what keeps a resized table filling the
 * width it was given rather than trailing an empty strip.
 */
export function EntriesTableHead({
  primary,
  extra,
  numeric,
  sortIcon,
  onToggleSort,
  resize,
}: {
  primary: string | null
  extra: readonly string[]
  numeric: ReadonlySet<string>
  sortIcon: (path: string) => ReactNode
  onToggleSort: (path: string) => void
  resize: ColumnResize
}) {
  const handle = (name: string) => (
    <ColumnResizer
      clamp={resize.clamp}
      onPreview={(width) => resize.preview(name, width)}
      onCommit={(width) => resize.commit(name, width)}
      onReset={() => resize.reset(name)}
    />
  )

  return (
    <div className={`${table.header} ${table.table}`}>
      <span
        className={`${table.sortable} ${styles.headCell}`}
        onClick={() => primary && onToggleSort(JsonPath.dataField(primary))}
      >
        <span className={styles.headLabel}>{primary || 'ID'}</span>
        {primary && sortIcon(JsonPath.dataField(primary))}
        {handle(ColumnWidths.PrimaryKey)}
      </span>
      {extra.map((column) => (
        <span
          key={column}
          className={`${table.sortable} ${styles.headCell} ${numeric.has(column) ? styles.numericHead : ''}`}
          onClick={() => onToggleSort(JsonPath.dataField(column))}
        >
          <span className={styles.headLabel}>{column}</span>
          {sortIcon(JsonPath.dataField(column))}
          {handle(column)}
        </span>
      ))}
      <span className={table.sortable} onClick={() => onToggleSort(JsonPath.UpdatedAt)}>
        Updated {sortIcon(JsonPath.UpdatedAt)}
      </span>
      <span />
    </div>
  )
}
