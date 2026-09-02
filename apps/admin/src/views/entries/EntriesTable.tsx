import { MoreHorizontal } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Formatters } from '../../utils/formatters'
import type { Entry } from '../../api/types/entry'
import type { MediaAsset } from '../../api/types/media-asset'
import type { SearchSnippet } from '../../api/types/search-snippet'
import { SchemaType } from '../../schema/schema-type'
import { CellValue } from './CellValue'
import { ColumnWidths } from './column-widths'
import { EntriesTableHead } from './EntriesTableHead'
import { EntryLabels } from './entry-labels'
import { RowMenu } from './RowMenu'
import { Snippets } from './Snippets'
import table from '../../components/data/DataTable.module.css'
import styles from './Entries.module.css'

/**
 * The entries grid itself — header, rows, empty state — split out of
 * `Entries.tsx` so the table's own rendering stays apart from the page's
 * search/filter/sort/column state that feeds it.
 */
export function EntriesTable({
  schema,
  entries,
  primary,
  sub,
  extra,
  widths,
  onResizeColumn,
  onResetColumn,
  mediaById,
  baseUrl,
  snippets,
  sortIcon,
  onToggleSort,
  onEditEntry,
  menuId,
  onMenuToggle,
  canEdit,
  canDelete,
  onDeleteRow,
  emptyMessage,
}: {
  schema: any
  entries: Entry[]
  primary: string | null
  sub: string | null
  extra: readonly string[]
  /** Column name → the width its reader dragged it to; absent means the table sizes it. */
  widths: Record<string, number>
  onResizeColumn: (name: string, width: number) => void
  onResetColumn: (name: string) => void
  mediaById: Record<string, MediaAsset>
  baseUrl?: string
  snippets: Record<string, SearchSnippet[]>
  sortIcon: (path: string) => ReactNode
  onToggleSort: (path: string) => void
  onEditEntry: (e: Entry) => void
  menuId: string | null
  onMenuToggle: (id: string | null) => void
  canEdit: boolean
  canDelete: boolean
  onDeleteRow: (e: Entry) => void
  /** Shown when nothing matched — the caller knows *why* (a search or a filter). `null` while a request is still in flight, so a stale "nothing here" never flashes before the real answer arrives. */
  emptyMessage: string | null
}) {
  const label = (e: Entry) => EntryLabels.of(e, primary, schema)
  // The id is the fallback title as well as the default subtitle, and an entry
  // with nothing nameable in it would otherwise print it on both lines.
  const subtitle = (e: Entry) => {
    const under = sub ? String(e.data?.[sub] ?? '') : Formatters.shortId(e.id)
    return under === label(e) ? '' : under
  }

  // Numbers render right-aligned in the cell (handoff 1e), so the heading and
  // the cell's own em-dash follow them over: a left heading above a right
  // column reads as two different columns, and a dash parked on the left of one
  // reads as a different column again.
  const numeric = new Set(extra.filter((column) => SchemaType.isNumeric(schema?.properties?.[column])))

  // `--cols` sits on the card and inherits, so a drag can repaint the grid by
  // writing one property on one element rather than re-rendering every row per
  // frame. The label column and `Updated` are two of the data columns a width
  // has to be left for.
  const card = useRef<HTMLDivElement>(null)
  const resize = {
    clamp: (width: number) => ColumnWidths.clamp(width, ColumnWidths.max(card.current?.clientWidth ?? 0, extra.length + 2)),
    preview: (name: string, width: number) =>
      card.current?.style.setProperty('--cols', ColumnWidths.template(extra, { ...widths, [name]: width })),
    commit: onResizeColumn,
    reset: onResetColumn,
  }

  return (
    <div className="card" ref={card} style={{ ['--cols' as any]: ColumnWidths.template(extra, widths) }}>
      <EntriesTableHead
        primary={primary}
        extra={extra}
        numeric={numeric}
        sortIcon={sortIcon}
        onToggleSort={onToggleSort}
        resize={resize}
      />

      {entries.map((e) => (
        <div
          key={e.id}
          className={`${table.row} ${table.clickable}`}
          onClick={() => onEditEntry(e)}
        >
          <div className={table.cell}>
            <div className={table.primary}>
              <span className={table.title}>{label(e)}</span>
              <span className={table.subtitle}>{subtitle(e)}</span>
              <Snippets snippets={snippets[e.id]} />
            </div>
          </div>
          {extra.map((c) => (
            <div key={c} className={`${table.cell} ${numeric.has(c) ? styles.numericCell : ''}`}>
              <CellValue schema={schema} name={c} value={e.data?.[c]} mediaById={mediaById} baseUrl={baseUrl} />
            </div>
          ))}
          <div className={`${table.cell} ${styles.relativeTime}`}>{Formatters.relativeTime(e.updated_at)}</div>
          <div className={`${table.actions} ${styles.menuCell}`} onClick={(evt) => evt.stopPropagation()}>
            <button
              className={styles.menuButton}
              onClick={(evt) => {
                evt.stopPropagation()
                onMenuToggle(menuId === e.id ? null : e.id)
              }}
            >
              <MoreHorizontal size={15} />
            </button>
            {menuId === e.id && (
              <RowMenu
                canEdit={canEdit}
                canDelete={canDelete}
                onClose={() => onMenuToggle(null)}
                onEdit={() => {
                  onMenuToggle(null)
                  onEditEntry(e)
                }}
                onDelete={() => {
                  onMenuToggle(null)
                  onDeleteRow(e)
                }}
              />
            )}
          </div>
        </div>
      ))}

      {entries.length === 0 && emptyMessage && <div className={`${table.cell} ${styles.noResults}`}>{emptyMessage}</div>}
    </div>
  )
}
