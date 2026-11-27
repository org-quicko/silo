import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '../../router/router'
import { ArrowUpDown, ArrowDown, ArrowUp, TriangleAlert } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { JsonPath } from '@silo/shared/json-path'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { api } from '../../api/silo-api'
import { Formatters } from '../../utils/formatters'
import { store } from '../../store/store'
import { TrashUndo } from '../trash/trash-undo'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { ListQuery } from '../../router/list-query'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SessionInfo } from '../../api/types/session-info'
import { Routes } from '../../router/routes'
import { FilterModel, type FilterDraft } from '../../query/filter-model'
import { PathLabel } from '../../query/path-label'
import { UrlFilter } from '../../query/url-filter'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import { Pagination } from '../../components/data/Pagination'
import { Columns } from './columns'
import { DeleteEntryModal } from './DeleteEntryModal'
import { EntriesPreferences } from './entries-preferences'
import { EntriesTable } from './EntriesTable'
import { EmptyCollection } from './EmptyCollection'
import { EntriesHeader } from './EntriesHeader'
import { EntriesToolbar } from './EntriesToolbar'
import { EntryLabels } from './entry-labels'
import { useColumnWidths } from './use-column-widths'
import { useEntriesKeyboard } from './use-entries-keyboard'
import { useEntriesData } from './use-entries-data'
import { useMediaColumns } from './use-media-columns'
import { useScrollMemory } from './use-scroll-memory'
import styles from './Entries.module.css'

interface Props {
  serverId: string
  collection: Collection
  /** For the smart bar's `@`-mention popup — every collection this key can reach, schema included. */
  collections: readonly { name: string; count: number | null }[]
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  /** Read by the delete dialog for whether this delete is recoverable (D113). */
  session: SessionInfo | null
  /** Changes when something outside this table restored an entry into it — the
   *  undo toast from the entry form, which navigated away before it fired. */
  refreshToken?: string
  /** Entry id to highlight and focus when returning from `EntryForm`. */
  focusEntryId?: string | null
  /** Active router navigation id so focus restoration runs once per arrival. */
  navigationKey?: number
  /** Text, filter, sort, page and column selection live in the URL, so a view is linkable. */
  query: ListQuery
  onQueryChange: (next: ListQuery, replace?: boolean) => void
  onEditSchema: () => void
  onNewEntry: () => void
  onEditEntry: (e: Entry) => void
  onChanged: () => void
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
  refreshToken,
  focusEntryId,
  navigationKey,
  query,
  onQueryChange,
  onEditSchema,
  onNewEntry,
  onEditEntry,
  onChanged,
}: Props) {
  const prefKey = EntriesPreferences.key(serverId, scope.project, scope.env, collection.name)
  const [prefsState, setPrefsState] = useState(() => ({
    key: prefKey,
    prefs: EntriesPreferences.read(prefKey),
  }))
  if (prefsState.key !== prefKey) {
    setPrefsState({ key: prefKey, prefs: EntriesPreferences.read(prefKey) })
  }

  const [menuId, setMenuId] = useState<string | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [focusRow, setFocusRow] = useState<number | undefined>(undefined)
  const [showColumns, setShowColumns] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const latestQueryRef = useRef(query)
  useEffect(() => {
    latestQueryRef.current = query
  }, [query])

  const pageSize = prefsState.prefs.pageSize
  const { desc } = query
  const offset = (query.page - 1) * pageSize
  const searching = query.q.trim() !== ''

  const parsed = useMemo(() => UrlFilter.parse(query.filter), [query.filter])
  const draft = useMemo(() => FilterModel.fromFilter(parsed.filter), [parsed.filter])

  const schemaColumns = EntryLabels.schemaColumns(collection.schema)
  const { primary, sub } = EntryLabels.pickPrimary(schemaColumns, collection.schema)
  const excludeFromColumns = [primary, sub].filter((column): column is string => column != null)
  const eligibleColumns = Columns.eligible(collection.schema, excludeFromColumns)
  const urlCols = Columns.parse(query.cols, collection.schema, excludeFromColumns)
  const storedCols = urlCols
    ? null
    : Columns.parseStored(prefsState.prefs.cols, collection.schema, excludeFromColumns)
  const extra = urlCols ?? storedCols ?? Columns.defaults(collection.schema, excludeFromColumns)

  const can = (permission: CollectionPermission) =>
    Claims.has(claims, Claims.collection(scope.project, scope.env, collection.name, permission))
  const canCreate = can(Claims.CollectionEntriesCreate)
  const canEdit = can(Claims.CollectionEntriesUpdate)
  const canDelete = can(Claims.CollectionEntriesDelete)
  const canEditSchema = can(Claims.CollectionSchemaUpdate)
  const { widths, setWidth, resetWidth } = useColumnWidths(serverId, scope, collection.name)

  const { entries, snippets, total, truncated, error, loading, reload } = useEntriesData({
    serverId,
    url,
    apiKey,
    scope,
    collection: collection.name,
    offset,
    limit: pageSize,
    explicitSort: query.sort,
    desc,
    q: query.q,
    filter: parsed.filter,
    filterError: parsed.error,
    refreshToken,
  })

  useEffect(() => {
    if (loading || error) return
    const clamped = EntriesPreferences.clampPage(query.page, pageSize, total)
    if (clamped !== query.page) {
      onQueryChange({ ...latestQueryRef.current, page: clamped }, true)
    }
  }, [loading, error, query.page, pageSize, total, onQueryChange])

  const location = useLocation()
  const contentRef = useScrollMemory(location, entries.length > 0)

  const mediaById = useMediaColumns(url, apiKey, entries, extra)
  const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''

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
  const editFilterRow = (index: number) => {
    setFocusRow(index)
    setShowFilter(true)
  }
  const removeFilterRow = (index: number) => {
    if (!draft) return
    applyFilter({ ...draft, rows: draft.rows.filter((_, at) => at !== index) })
  }

  const toggleColumn = (next: string[]) => {
    const encoded = Columns.stringify(next, collection.schema, excludeFromColumns)
    const nextCols = encoded === null ? null : next
    EntriesPreferences.writeCols(prefKey, nextCols)
    setPrefsState((current) => ({
      key: prefKey,
      prefs: { ...current.prefs, cols: nextCols },
    }))
    onQueryChange({ ...query, cols: encoded })
  }

  const handleSearchChange = (nextQuery: string) => {
    const latest = latestQueryRef.current
    if (nextQuery === latest.q) return
    onQueryChange({ ...latest, q: nextQuery, page: 1 }, true)
  }

  const goToPage = (page: number) => onQueryChange({ ...query, page })
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const doDelete = async () => {
    if (!toDelete) return
    const epochAtStart = store.sessionEpoch()
    try {
      const trashId = await api.entries.delete(url, apiKey, scope, collection.name, toDelete.id, toDelete.rev)
      if (store.sessionEpoch() !== epochAtStart) return
      const subject = label(toDelete)
      setToDelete(null)
      await reload()
      if (store.sessionEpoch() !== epochAtStart) return
      onChanged()
      TrashUndo.offer(trashId, subject, url, apiKey, () => {
        if (store.sessionEpoch() !== epochAtStart) return
        void reload().then(() => {
          if (store.sessionEpoch() === epochAtStart) onChanged()
        })
      })
    } catch (caught: any) {
      if (store.sessionEpoch() !== epochAtStart) return
      alert(caught.message || 'Delete failed')
    }
  }

  const label = (entry: Entry) => EntryLabels.of(entry, primary, collection.schema)

  const entryIds = useMemo(() => entries.map((item) => item.id), [entries])

  const { cursor, setCursor } = useEntriesKeyboard({
    rowCount: entries.length,
    active: !toDelete,
    entryIds,
    focusEntryId,
    navigationKey,
    onOpen: (index) => onEditEntry(entries[index]),
    onDelete: (index) => canDelete && setToDelete(entries[index]),
    onNew: () => canCreate && onNewEntry(),
    onFilter: openFilterBuilder,
    onColumns: () => setShowColumns(!showColumns),
    onPage: (delta) => {
      const next = query.page + delta
      if (next >= 1 && next <= lastPage) goToPage(next)
    },
    onDismiss: () => {
      const open = showFilter || showColumns || menuId !== null
      setShowFilter(false)
      setFocusRow(undefined)
      setShowColumns(false)
      setMenuId(null)
      return open
    },
  })
  const conditions = draft ? draft.rows.filter(FilterModel.isComplete).length : 0

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
            url={url}
            apiKey={apiKey}
            scope={scope}
            collections={collections}
          />
        }
      />

      <div className="content" ref={contentRef}>
        <Breadcrumb crumbs={[{ label: 'Collections', to: Routes.collections(serverId, scope.project, scope.env) }, { label: collection.name }]} />

        <EntriesHeader
          collection={collection}
          url={url}
          scope={scope}
          total={total}
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
              collectionName={collection.name}
              schema={collection.schema}
              search={query.q}
              onSearchChange={handleSearchChange}
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
              onClearSort={() => onQueryChange({ ...query, sort: null, page: 1 })}
              eligibleColumns={eligibleColumns}
              selectedColumns={extra}
              showColumns={showColumns}
              onToggleColumns={() => setShowColumns(!showColumns)}
              onCloseColumns={() => setShowColumns(false)}
              onChangeColumns={toggleColumn}
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
              widths={widths}
              onResizeColumn={setWidth}
              onResetColumn={resetWidth}
              mediaById={mediaById}
              baseUrl={baseUrl}
              snippets={snippets}
              cursor={cursor}
              onCursorChange={setCursor}
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
              pagination={
                <Pagination
                  bordered={false}
                  total={total}
                  pageSize={pageSize}
                  page={query.page}
                  pageSizeOptions={[...EntriesPreferences.AllowedPageSizes]}
                  onPageChange={goToPage}
                  onPageSizeChange={(next) => {
                    const normalized = EntriesPreferences.normalizePageSize(next)
                    EntriesPreferences.writePageSize(prefKey, normalized)
                    setPrefsState((current) => ({
                      key: prefKey,
                      prefs: { ...current.prefs, pageSize: normalized },
                    }))
                    goToPage(1)
                  }}
                />
              }
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
          session={session}
          onCancel={() => setToDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </>
  )
}
