import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { FilterModel, type FilterDraft } from '../../query/filter-model'
import { PathLabel } from '../../query/path-label'
import { ColumnsMenu } from './ColumnsMenu'
import { FilterBuilder } from './FilterBuilder'
import { FilterChips } from './FilterChips'
import styles from './Entries.module.css'

interface Props {
  schema: any
  /** Null when the URL carries a filter the visual builder cannot draw. */
  draft: FilterDraft | null
  /** The raw filter string, shown to the builder when `draft` is null. */
  rawFilter: string | null
  showBuilder: boolean
  /** Which row the builder should focus when it opens, if any. */
  focusRow: number | undefined
  onOpenBuilder: () => void
  onCloseBuilder: () => void
  onEditRow: (index: number) => void
  onRemoveRow: (index: number) => void
  onApplyFilter: (draft: FilterDraft) => void

  sort: string | null
  desc: boolean
  onClearSort: () => void

  eligibleColumns: string[]
  selectedColumns: string[]
  showColumns: boolean
  onToggleColumns: () => void
  onCloseColumns: () => void
  onChangeColumns: (columns: string[]) => void
}

/** Filters, sort, column choice and the result count, above the table. */
export function EntriesToolbar({
  schema,
  draft,
  rawFilter,
  showBuilder,
  focusRow,
  onOpenBuilder,
  onCloseBuilder,
  onEditRow,
  onRemoveRow,
  onApplyFilter,
  sort,
  desc,
  onClearSort,
  eligibleColumns,
  selectedColumns,
  showColumns,
  onToggleColumns,
  onCloseColumns,
  onChangeColumns,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.filterAnchor}>
        {draft !== null ? (
          <FilterChips
            schema={schema}
            draft={draft}
            onEditRow={onEditRow}
            onRemoveRow={onRemoveRow}
            onAddFilter={onOpenBuilder}
            onClearAll={() => onApplyFilter(FilterModel.Empty)}
          />
        ) : (
          <button className={styles.filterPill} onClick={onOpenBuilder}>
            <span className={styles.filterKey}>filter</span>
            <span className={styles.filterOperator}>advanced</span>
          </button>
        )}
        {showBuilder && (
          <FilterBuilder
            schema={schema}
            draft={draft ?? FilterModel.Empty}
            advanced={draft === null ? rawFilter : null}
            focusRow={focusRow}
            onApply={onApplyFilter}
            onClose={onCloseBuilder}
          />
        )}
      </div>

      {sort && (
        <Button
          variant="secondary"
          size="sm"
          title={`Sorted by ${sort} — click to go back to the default order`}
          onClick={onClearSort}
        >
          Sort: {PathLabel.of(sort)} {desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
        </Button>
      )}

      <div className={styles.toolbarSpacer} />

      <div className={styles.filterAnchor}>
        <Button variant="secondary" size="sm" onClick={onToggleColumns}>
          Columns {selectedColumns.length + 2}/{eligibleColumns.length + 2}
        </Button>
        {showColumns && (
          <ColumnsMenu
            fields={eligibleColumns}
            selected={selectedColumns}
            onChange={onChangeColumns}
            onClose={onCloseColumns}
          />
        )}
      </div>
    </div>
  )
}
