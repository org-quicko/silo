import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { FilterModel, type FilterDraft } from '../../query/filter-model'
import { PathLabel } from '../../query/path-label'
import { ColumnsMenu } from './ColumnsMenu'
import { FilterBuilder } from './FilterBuilder'
import { FilterChips } from './FilterChips'
import styles from './Entries.module.css'

const SEARCH_DEBOUNCE_MS = 200

interface Props {
  collectionName: string
  schema: any
  search: string
  onSearchChange: (next: string) => void

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

/** Inline search, filters, sort, and column choice above the table. */
export function EntriesToolbar({
  collectionName,
  schema,
  search,
  onSearchChange,
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
  const [draftSearch, setDraftSearch] = useState(search)
  const [prevSearch, setPrevSearch] = useState(search)
  const timerRef = useRef<number | null>(null)
  const latestSearchCommit = useRef(onSearchChange)

  if (search !== prevSearch) {
    setPrevSearch(search)
    setDraftSearch(search)
  }

  useEffect(() => {
    latestSearchCommit.current = onSearchChange
  }, [onSearchChange])

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [search])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const handleInput = (nextValue: string) => {
    setDraftSearch(nextValue)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      latestSearchCommit.current(nextValue)
    }, SEARCH_DEBOUNCE_MS)
  }

  const flushSearch = (nextValue: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    latestSearchCommit.current(nextValue)
  }

  const clearSearch = () => {
    setDraftSearch('')
    flushSearch('')
  }

  return (
    <div className={styles.toolbar}>
      <div className={styles.searchBox}>
        <Search size={14} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder={`Search ${collectionName}…`}
          value={draftSearch}
          onChange={(event) => handleInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              flushSearch(draftSearch)
              return
            }
            if (event.key === 'Escape') {
              if (draftSearch !== '') {
                event.preventDefault()
                clearSearch()
              } else {
                event.currentTarget.blur()
              }
            }
          }}
          aria-label={`Search ${collectionName}`}
        />
        {draftSearch !== '' && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={clearSearch}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

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
