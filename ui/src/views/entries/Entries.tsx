import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { Breadcrumb } from '../../components/Breadcrumb'
import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Globe,
  Lock,
  Calendar,
  TriangleAlert,
} from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { JsonPath } from '@silo/shared/json-path'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { SchemaAccess } from '@silo/shared/schema-access'
import { MediaRef } from '@silo/shared/media-ref'
import { api } from '../../api/api-client'
import { Formatters } from '../../utils/formatters'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { MediaAsset } from '../../api/types/media-asset'
import type { ListQuery } from '../../router/list-query'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Routes } from '../../router/routes'
import { FilterModel, type FilterDraft } from '../../query/filter-model'
import { PathLabel } from '../../query/path-label'
import { UrlFilter } from '../../query/url-filter'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import { ApiGuide } from '../ApiGuide'
import { Columns } from './columns'
import { ColumnsMenu } from './ColumnsMenu'
import { DeleteEntryModal } from './DeleteEntryModal'
import { EntriesTable } from './EntriesTable'
import { FilterBuilder } from './FilterBuilder'
import { FilterChips } from './FilterChips'
import { useEntriesData } from './use-entries-data'
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

function schemaColumns(schema: any): string[] {
  return schema?.properties ? Object.keys(schema.properties) : []
}

function pickPrimary(cols: string[]): { primary: string | null; sub: string | null } {
  const primary = cols.find((c) => c === 'title') || cols.find((c) => c === 'name') || cols[0] || null
  const sub = cols.find((c) => c === 'slug') || null
  return { primary, sub }
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
  const [mediaById, setMediaById] = useState<Record<string, MediaAsset>>({})

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

  const cols = schemaColumns(collection.schema)
  const { primary, sub } = pickPrimary(cols)
  const excludeFromColumns = [primary, sub].filter((c): c is string => c != null)
  const eligibleColumns = Columns.eligible(collection.schema, excludeFromColumns)
  const extra = Columns.parse(query.cols, collection.schema, excludeFromColumns) ?? Columns.defaults(collection.schema, excludeFromColumns)
  const isPrivate = SchemaAccess.requiresAuth(collection.schema)
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

  // Resolves `x-silo-type: media` references in whatever extra columns are on
  // screen into filenames and thumbnails (handoff 1e) — CellValue must never
  // show the stored `silo://media/<ulid>` itself. Bounded to unique ids not
  // already known, so paging or re-searching only fetches what changed.
  useEffect(() => {
    const ids = new Set<string>()
    for (const e of entries) {
      for (const name of extra) {
        const id = MediaRef.canonicalId(e.data?.[name])
        if (id && !mediaById[id]) ids.add(id)
      }
    }
    if (ids.size === 0) return
    let alive = true
    Promise.all(
      [...ids].map((id) => api.getMediaAsset(url, apiKey, id).then((a) => [id, a] as const).catch(() => null)),
    ).then((resolved) => {
      if (!alive) return
      const next: Record<string, MediaAsset> = {}
      for (const r of resolved) if (r) next[r[0]] = r[1]
      if (Object.keys(next).length > 0) setMediaById((prev) => ({ ...prev, ...next }))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, extra.join(',')])

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
      await api.deleteEntry(url, apiKey, scope, collection.name, toDelete.id, toDelete.rev)
      setToDelete(null)
      await reload()
      onChanged()
    } catch (e: any) {
      alert(e.message || 'Delete failed')
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = query.page
  const label = (e: Entry) => (primary ? String(e.data?.[primary] ?? Formatters.shortId(e.id)) : Formatters.shortId(e.id))
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

        <div className="page-head">
          <div className="page-title-group">
            <div className="page-title-row">
              <h2 className="page-title">{collection.name}</h2>
              {/* Icon, not `dot`: the design canvas draws a globe/lock glyph
                  here, and a shape distinguishes the two states for a reader
                  who cannot tell the two tints apart. Both at once is noise. */}
              {isPrivate ? (
                <Pill tone="warn"><Lock size={12} /> auth required</Pill>
              ) : (
                <Pill tone="ok"><Globe size={12} /> public read</Pill>
              )}
            </div>
            <span className="page-sub">
              {total} {total === 1 ? 'entry' : 'entries'} · {cols.length} {cols.length === 1 ? 'field' : 'fields'}
              {lastUpdated && <> · updated {lastUpdated}</>}
            </span>
          </div>
          <div className="head-actions">
            <ApiGuide collection={collection} url={url} scope={scope} />
            {canEditSchema && (
              <Button variant="secondary" onClick={onEditSchema}>
                Edit collection
              </Button>
            )}
            {canCreate && (
              <Button variant="primary" onClick={onNewEntry}>
                <Plus size={14} strokeWidth={2.4} /> New entry
              </Button>
            )}
          </div>
        </div>

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
          <div className={`card ${styles.emptyCard}`}>
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Calendar size={26} strokeWidth={1.7} />
              </div>
              <h3>No entries in {collection.name} yet</h3>
              <p>
                This collection's schema is ready — it just needs content. Create your first entry with the generated
                form, or bring data in from another silo.
              </p>
              <div className={styles.emptyActions}>
                {canCreate && (
                  <Button variant="primary" onClick={onNewEntry}>
                    <Plus size={14} strokeWidth={2.4} /> New entry
                  </Button>
                )}
              </div>
              <span className={styles.apiHint}>
                GET /api/projects/{scope.project}/envs/{scope.env}/collections/{collection.name} →{' '}
                {'{ "data": [], "total": 0 }'}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.filterAnchor}>
                {draft !== null ? (
                  <FilterChips
                    schema={collection.schema}
                    draft={draft}
                    onEditRow={editFilterRow}
                    onRemoveRow={removeFilterRow}
                    onAddFilter={openFilterBuilder}
                    onClearAll={() => applyFilter(FilterModel.Empty)}
                  />
                ) : (
                  <button className={styles.filterPill} onClick={() => setShowFilter(true)}>
                    <span className={styles.filterKey}>filter</span>
                    <span className={styles.filterOperator}>advanced</span>
                  </button>
                )}
                {showFilter && (
                  <FilterBuilder
                    schema={collection.schema}
                    draft={draft ?? FilterModel.Empty}
                    advanced={draft === null ? query.filter : null}
                    focusRow={focusRow}
                    onApply={applyFilter}
                    onClose={() => {
                      setShowFilter(false)
                      setFocusRow(undefined)
                    }}
                  />
                )}
              </div>

              <div className={styles.toolbarDivider} />

              {query.sort ? (
                <Button
                  variant="secondary"
                  size="sm"
                  title={`Sorted by ${query.sort} — click to go back to the default order`}
                  onClick={() => onQueryChange({ ...query, sort: null, page: 1 })}
                >
                  Sort: {PathLabel.of(query.sort)} {desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                </Button>
              ) : (
                <span className={styles.sortNote}>{searching ? 'Sorted by relevance' : 'Newest first'}</span>
              )}

              <div className={styles.filterAnchor}>
                <Button variant="secondary" size="sm" onClick={() => setShowColumns(!showColumns)}>
                  Columns {extra.length + 2}/{eligibleColumns.length + 2}
                </Button>
                {showColumns && (
                  <ColumnsMenu
                    fields={eligibleColumns}
                    selected={extra}
                    onChange={toggleColumn}
                    onClose={() => setShowColumns(false)}
                  />
                )}
              </div>

              <div className={styles.toolbarSpacer} />

              {/* The engine tag lives in the search bar (handoff 1b) — stating
                  it twice on one screen just asks the reader which one to
                  believe. */}
              <span className={styles.resultSummary}>
                {total === 0 ? 'No entries' : `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`} · {filterSummary}
              </span>
            </div>

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

            <div className={styles.pager}>
              <span className={styles.pagerInfo}>
                {total === 0 ? 'No entries' : `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
              </span>
              <div className={styles.pagerButtons}>
                <button className={styles.pagerButton} disabled={currentPage <= 1} onClick={() => goToPage(Math.max(1, currentPage - 1))}>
                  ‹
                </button>
                {Array.from({ length: Math.min(pageCount, 3) }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    className={`${styles.pagerButton} ${p === currentPage ? styles.active : ''}`}
                    onClick={() => goToPage(p)}
                  >
                    {p}
                  </button>
                ))}
                <button className={styles.pagerButton} disabled={offset + PAGE_SIZE >= total} onClick={() => goToPage(currentPage + 1)}>
                  ›
                </button>
                <span className={styles.rowsTag}>Rows {PAGE_SIZE}</span>
              </div>
            </div>
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
