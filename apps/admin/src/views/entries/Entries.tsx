import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { useMemo, useState } from 'react'
import { ArrowUpDown, ArrowDown, ArrowUp, TriangleAlert } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { JsonPath } from '@silo/shared/json-path'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { api } from '../../api/silo-api'
import { Formatters } from '../../utils/formatters'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { ListQuery } from '../../router/list-query'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Routes } from '../../router/routes'
import { FilterModel, type FilterDraft } from '../../query/filter-model'
import { PathLabel } from '../../query/path-label'
import { UrlFilter } from '../../query/url-filter'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import { Columns } from './columns'
import { DeleteEntryModal } from './DeleteEntryModal'
import { EntriesTable } from './EntriesTable'
import { EmptyCollection } from './EmptyCollection'
import { EntriesHeader } from './EntriesHeader'
import { EntriesPager } from './EntriesPager'
import { EntriesToolbar } from './EntriesToolbar'
import { EntryLabels } from './entry-labels'
import { useEntriesData } from './use-entries-data'
import { useMediaColumns } from './use-media-columns'
import styles from './Entries.module.css'
import type { SessionBadge } from '../shell/session-badge'

const PAGE_SIZE = 50

interface Props {
  serverId: string
  collection: Collection
  /** For the smart bar's `@`-mention popup — every collection this key can reach, schema included. */
  collections: readonly { name: string; count: number | null; schema?: any }[]
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  session: SessionBadge
  /** Text, filter, sort, page and column selection live in the URL, so a view is linkable. */
  query: ListQuery
  onQueryChange: (next: ListQuery, replace?: boolean) => void
  onEditSchema: () => void
  onNewEntry: () => void
  onEditEntry: (e: Entry) => void
  onChanged: () => void
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
}

export function EntriesView({
  serverId,
  collection,
  collections,
  url,
  apiKey,
  scope,
  claims,
  session,
  query,
  onQueryChange,
  onEditSchema,
  onNewEntry,
  onEditEntry,
  onChanged,
  onOpenPalette,
  onNavigateToCollection,
}: Props) {
  const [menuId, setMenuId] = useState<string | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [focusRow, setFocusRow] = useState<number | undefined>(undefined)
  const [showColumns, setShowColumns] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const { desc } = query
  const offset = (query.page - 1) * PAGE_SIZE
  const searching = query.q.trim() !== ''

  // Memoised on the URL string, not recomputed per render: `parsed.filter` is a
  // fresh object out of `JSON.parse`, and it is a dependency of the loader
  // effect below. Without this, every response re-renders, every render mints a
  // new filter identity, and the effect fires again — a filtered view would
  // re-request itself forever. This is the same class of defect P3 hit with the
  // `scope` prop; it is cheap to reintroduce and invisible until you watch the
  // network panel.
  const parsed = useMemo(() => UrlFilter.parse(query.filter), [query.filter])
  const draft = useMemo(() => FilterModel.fromFilter(parsed.filter), [parsed.filter])

  const schemaColumns = EntryLabels.schemaColumns(collection.schema)
  const { primary, sub } = EntryLabels.pickPrimary(schemaColumns)
  const excludeFromColumns = [primary, sub].filter((c): c is string => c != null)
  const eligibleColumns = Columns.eligible(collection.schema, excludeFromColumns)
  const extra = Columns.parse(query.cols, collection.schema, excludeFromColumns) ?? Columns.defaults(collection.schema, excludeFromColumns)
  const can = (permission: CollectionPermission) =>
    Claims.has(claims, Claims.collection(scope.project, scope.env, collection.name, permission))
  const canCreate = can(Claims.CollectionEntriesCreate)
  const canEdit = can(Claims.CollectionEntriesUpdate)
  const canDelete = can(Claims.CollectionEntriesDelete)
  const canEditSchema = can(Claims.CollectionSchemaUpdate)
  const gridCols = `minmax(0,1.9fr) ${extra.map(() => 'minmax(0,1fr)').join(' ')} minmax(0,0.8fr) 44px`

  const { entries, snippets, total, truncated, engine, error, loading, reload } = useEntriesData({
    url,
    apiKey,
    scope,
    collection: collection.name,
    offset,
    limit: PAGE_SIZE,
    explicitSort: query.sort,
    desc,
    q: query.q,
    filter: parsed.filter,
    filterError: parsed.error,
  })

  const mediaById = useMediaColumns(url, apiKey, entries, extra)

  /** Takes a path (D29), so the URL and the API speak the same language. */
  const toggleSort = (path: string) => {
    onQueryChange({ ...query, sort: path, desc: query.sort === path ? !desc : true, page: 1 })
  }

  const sortIcon = (path: string) => {
    if (query.sort !== path) return <ArrowUpDown size={11} />
    return desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />
  }

  const applyFilter = (next: FilterDraft) => {
    setShowFilter(false)
    setFocusRow(undefined)
    onQueryChange({ ...query, filter: UrlFilter.stringify(FilterModel.toFilter(next)), page: 1 })
  }

  const openFilterBuilder = () => {
    setFocusRow(undefined)
    setShowFilter(true)
  }
  const editFilterRow = (i: number) => {
    setFocusRow(i)
    setShowFilter(true)
  }
  const removeFilterRow = (i: number) => {
    if (!draft) return
    applyFilter({ ...draft, rows: draft.rows.filter((_, at) => at !== i) })
  }

  const toggleColumn = (next: string[]) =>
    onQueryChange({ ...query, cols: Columns.stringify(next, collection.schema, excludeFromColumns) })

  const goToPage = (page: number) => onQueryChange({ ...query, page })

  const doDelete = async () => {
    if (!toDelete) return
    try {
      await api.entries.delete(url, apiKey, scope, collection.name, toDelete.id, toDelete.rev)
      setToDelete(null)
      await reload()
      onChanged()
    } catch (caught: any) {
      alert(caught.message || 'Delete failed')
    }
  }

  const label = (entry: Entry) => EntryLabels.of(entry, primary)
  const conditions = draft ? draft.rows.filter(FilterModel.isComplete).length : 0
  const filterSummary = draft === null ? 'advanced filter' : conditions === 0 ? 'no filters' : `${conditions} filter${conditions === 1 ? '' : 's'}`

  // Real, not guessed: on the untouched first page (no search, no filter, no
  // chosen sort) row zero of the default newest-first order *is* the
  // collection's most recently updated entry. Any other view state has no
  // honest single answer, so the line is simply omitted rather than shown
  // from a page that cannot back it.
  const lastUpdated =
    !searching && !parsed.filter && !query.sort && query.page === 1 && entries.length > 0
      ? Formatters.relativeTime(entries[0].updated_at)
      : null

  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            scope={scope}
            collection={collection.name}
            collections={collections}
            listQuery={{ q: query.q, engine, onQueryChange: (q) => onQueryChange({ ...query, q, page: 1 }, true) }}
            onNavigateToCollection={onNavigateToCollection}
            onOpenPalette={onOpenPalette}
          />
        }
        session={session}
      />

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Collections', to: Routes.collections(serverId, scope.project, scope.env) }, { label: collection.name }]} />

        <EntriesHeader
          collection={collection}
          url={url}
          scope={scope}
          total={total}
          fieldCount={schemaColumns.length}
          lastUpdated={lastUpdated}
          canCreate={canCreate}
          canEditSchema={canEditSchema}
          onEditSchema={onEditSchema}
          onNewEntry={onNewEntry}
        />

        {error && (
          <div className={styles.errorBanner}>
            <TriangleAlert size={14} /> {error}
            {parsed.error && (
              <button className={styles.bannerAction} onClick={() => onQueryChange({ ...query, filter: null, page: 1 })}>
                Clear filter
              </button>
            )}
          </div>
        )}

        {!loading && !error && total === 0 && !searching && conditions === 0 && !parsed.filter ? (
          <EmptyCollection
            collection={collection.name}
            scope={scope}
            canCreate={canCreate}
            onNewEntry={onNewEntry}
          />
        ) : (
          <>
            <EntriesToolbar
              schema={collection.schema}
              draft={draft}
              rawFilter={query.filter}
              showBuilder={showFilter}
              focusRow={focusRow}
              onOpenBuilder={openFilterBuilder}
              onCloseBuilder={() => {
                setShowFilter(false)
                setFocusRow(undefined)
              }}
              onEditRow={editFilterRow}
              onRemoveRow={removeFilterRow}
              onApplyFilter={applyFilter}
              sort={query.sort}
              desc={desc}
              searching={searching}
              onClearSort={() => onQueryChange({ ...query, sort: null, page: 1 })}
              eligibleColumns={eligibleColumns}
              selectedColumns={extra}
              showColumns={showColumns}
              onToggleColumns={() => setShowColumns(!showColumns)}
              onCloseColumns={() => setShowColumns(false)}
              onChangeColumns={toggleColumn}
              summary={`${
                total === 0
                  ? 'No entries'
                  : `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`
              } · ${filterSummary}`}
            />

            {searching && (
              <div className={styles.searchStatus}>
                {total} {total === 1 ? 'result' : 'results'} · {query.sort ? `sorted by ${PathLabel.of(query.sort)}` : 'ranked by relevance'}
                {!query.sort && (
                  <button className={styles.searchStatusAction} onClick={() => onQueryChange({ ...query, sort: JsonPath.UpdatedAt, page: 1 })}>
                    Sort by newest instead
                  </button>
                )}
              </div>
            )}

            {truncated && (
              <div className={styles.truncatedNote}>
                This search stopped at its scan limit, so {total} counts what was examined rather than what exists.
                Narrow it, or enable the SQLite index.
              </div>
            )}

            <EntriesTable
              schema={collection.schema}
              entries={entries}
              primary={primary}
              sub={sub}
              extra={extra}
              gridCols={gridCols}
              mediaById={mediaById}
              snippets={snippets}
              sortIcon={sortIcon}
              onToggleSort={toggleSort}
              onEditEntry={onEditEntry}
              menuId={menuId}
              onMenuToggle={setMenuId}
              canEdit={canEdit}
              canDelete={canDelete}
              onDeleteRow={setToDelete}
              emptyMessage={
                loading || error
                  ? null
                  : searching
                    ? `Nothing in ${collection.name} matches “${query.q.trim()}”.`
                    : 'No entries match this filter.'
              }
            />

            <EntriesPager
              total={total}
              offset={offset}
              pageSize={PAGE_SIZE}
              page={query.page}
              onGoTo={goToPage}
            />
          </>
        )}
      </div>

      {toDelete && (
        <DeleteEntryModal
          entry={toDelete}
          collectionName={collection.name}
          label={label(toDelete)}
          sub={sub}
          onCancel={() => setToDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </>
  )
}
