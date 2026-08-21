import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Globe,
  Lock,
  Search,
  MoreHorizontal,
  Trash2,
  Calendar,
  TriangleAlert,
} from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { JsonPath } from '@silo/shared/json-path'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { SchemaAccess } from '@silo/shared/schema-access'
import { api } from '../../api/api-client'
import { Formatters } from '../../utils/formatters'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { SearchSnippet } from '../../api/types/search-snippet'
import type { ListQuery } from '../../router/list-query'
import type { ScopeRef } from '../../api/types/scope-ref'
import { FilterModel, type FilterDraft } from '../../query/filter-model'
import { PathLabel } from '../../query/path-label'
import { UrlFilter } from '../../query/url-filter'
import { Modal } from '../../components/Modal'
import { ModalActions } from '../../components/ModalActions'
import { ModalBody } from '../../components/ModalBody'
import { ModalCopy } from '../../components/ModalCopy'
import { ModalHeader } from '../../components/ModalHeader'
import { ModalIcon } from '../../components/ModalIcon'
import { ModalSubject } from '../../components/ModalSubject'
import { TopBar } from '../shell/TopBar'
import { ApiGuide } from '../ApiGuide'
import { CellValue } from './CellValue'
import { FilterBuilder } from './FilterBuilder'
import { RowMenu } from './RowMenu'
import { Snippets } from './Snippets'
import table from '../../components/DataTable.module.css'
import styles from './Entries.module.css'
import type { SessionBadge } from '../shell/session-badge'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 280

interface Props {
  collection: Collection
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  session: SessionBadge
  /** Text, filter, sort and page live in the URL, so a view is linkable. */
  query: ListQuery
  onQueryChange: (next: ListQuery, replace?: boolean) => void
  onEditSchema: () => void
  onNewEntry: () => void
  onEditEntry: (e: Entry) => void
  onChanged: () => void
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
  collection,
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
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [snippets, setSnippets] = useState<Record<string, SearchSnippet[]>>({})
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [engine, setEngine] = useState<'fts5' | 'scan' | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const { desc } = query
  const offset = (query.page - 1) * PAGE_SIZE
  const searching = query.q.trim() !== ''
  // No chosen sort means relevance while searching and newest-first otherwise;
  // an explicit one wins over both (§5.5).
  const sort = query.sort ?? JsonPath.UpdatedAt
  const sortParam = query.sort ? (desc ? '-' : '') + query.sort : undefined

  const parsed = useMemo(() => UrlFilter.parse(query.filter), [query.filter])
  const draft = useMemo(() => FilterModel.fromFilter(parsed.filter), [parsed.filter])

  // The text box keeps its own state so typing stays responsive; the URL only
  // gets the settled value. `synced` tracks what the URL already holds, which
  // both suppresses a redundant push and lets back/forward reset the box.
  const [search, setSearch] = useState(query.q)
  const synced = useRef(query.q)

  const cols = schemaColumns(collection.schema)
  const { primary, sub } = pickPrimary(cols)
  const extra = cols.filter((c) => c !== primary && c !== sub).slice(0, 3)
  const isPrivate = SchemaAccess.requiresAuth(collection.schema)
  const can = (permission: CollectionPermission) =>
    Claims.has(claims, Claims.collection(scope.project, scope.env, collection.name, permission))
  const canCreate = can(Claims.CollectionEntriesCreate)
  const canEdit = can(Claims.CollectionEntriesUpdate)
  const canDelete = can(Claims.CollectionEntriesDelete)
  const canEditSchema = can(Claims.CollectionSchemaUpdate)
  const gridCols = `1.9fr ${extra.map(() => '1fr').join(' ')} 0.8fr 44px`

  // Back/forward (or a fresh deep link) changed the text — adopt it.
  useEffect(() => {
    if (query.q === synced.current) return
    synced.current = query.q
    setSearch(query.q)
  }, [query.q])

  // Settle typing into the URL. Replaces rather than pushes, so a searched
  // list is one back-press away from where the user came from.
  useEffect(() => {
    if (search === synced.current) return
    const t = setTimeout(() => {
      synced.current = search
      onQueryChange({ ...query, q: search, page: 1 }, true)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  /**
   * One loader for both routes. Text runs the collection-reach `/search`
   * (D30), which ranks and explains itself with snippets; without text the
   * plain list route answers, because a filter-only search returns the same
   * set in a shape the table does not need.
   *
   * Responses are ticketed rather than cancelled: typing fires several, and
   * they can land out of order — the last one *asked for* must win, not the
   * last one to arrive.
   */
  const seq = useRef(0)
  const load = (): Promise<void> => {
    const ticket = ++seq.current
    const fresh = () => seq.current === ticket
    setLoading(true)

    if (parsed.error) {
      // A filter that cannot be read is refused, not dropped: showing every
      // entry under a URL that claims to be filtered is the one failure
      // direction that misleads instead of interrupting.
      setEntries([])
      setSnippets({})
      setTotal(0)
      setError(parsed.error)
      setLoading(false)
      return Promise.resolve()
    }

    const request = searching
      ? api
          .search(
            url,
            apiKey,
            { kind: 'collection', scope, collection: collection.name },
            { q: query.q.trim(), filter: parsed.filter, sort: sortParam, limit: PAGE_SIZE, offset },
          )
          .then((r) => {
            if (!fresh()) return
            setEntries(r.items.map((h) => h.entry))
            setSnippets(Object.fromEntries(r.items.map((h) => [h.entry.id, h.snippets])))
            setTotal(r.total)
            setTruncated(r.truncated)
            setEngine(r.engine)
          })
      : api
          .listEntries(url, apiKey, scope, collection.name, {
            limit: PAGE_SIZE,
            offset,
            sort: (desc ? '-' : '') + sort,
            filter: parsed.filter ?? undefined,
          })
          .then((r) => {
            if (!fresh()) return
            setEntries(r.items)
            setSnippets({})
            setTotal(r.total)
            setTruncated(false)
            setEngine(null)
          })

    return request
      .then(() => fresh() && setError(''))
      .catch((e: unknown) => {
        if (!fresh()) return
        setEntries([])
        setSnippets({})
        setTotal(0)
        setError(e instanceof Error ? e.message : 'Could not load entries')
      })
      .then(() => {
        if (fresh()) setLoading(false)
      })
  }

  // Depends on the scope's *values*, not the prop's identity: `scope` is built
  // fresh by the parent on every render, so depending on the object reloads
  // the whole page — a second search per render — every time anything above
  // this view changes state.
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    apiKey,
    scope.project,
    scope.env,
    collection.name,
    offset,
    sort,
    desc,
    query.q,
    query.filter,
    query.sort,
  ])

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
    onQueryChange({ ...query, filter: UrlFilter.stringify(FilterModel.toFilter(next)), page: 1 })
  }

  const goToPage = (page: number) => onQueryChange({ ...query, page })

  const doDelete = async () => {
    if (!toDelete) return
    try {
      await api.deleteEntry(url, apiKey, scope, collection.name, toDelete.id, toDelete.rev)
      setToDelete(null)
      await load()
      onChanged()
    } catch (e: any) {
      alert(e.message || 'Delete failed')
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = query.page
  const clearSearch = () => {
    setSearch('')
    synced.current = ''
    onQueryChange({ ...query, q: '', page: 1 }, true)
  }
  const label = (e: Entry) => (primary ? String(e.data?.[primary] ?? Formatters.shortId(e.id)) : Formatters.shortId(e.id))
  const conditions = draft ? draft.rows.filter(FilterModel.isComplete).length : 0

  return (
    <>
      <TopBar crumbs={[{ label: 'Collections' }, { label: collection.name }]} session={session}>
        <div className={styles.filterField}>
          <Search size={15} />
          <input
            value={search}
            placeholder={`Search ${collection.name}…`}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </TopBar>

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <div className="page-title-row">
              <h2 className="page-title">{collection.name}</h2>
              {isPrivate ? (
                <Pill tone="warn"><Lock size={12} /> auth required</Pill>
              ) : (
                <Pill tone="ok"><Globe size={12} /> public read</Pill>
              )}
            </div>
            <span className="page-sub">
              {total} {total === 1 ? 'entry' : 'entries'} · {cols.length} {cols.length === 1 ? 'field' : 'fields'}
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowFilter(!showFilter)}
                  className={parsed.filter ? styles.filterActive : undefined}
                >
                  <SlidersHorizontal size={14} /> Filter
                  {conditions > 0 && <span className={styles.filterCount}>{conditions}</span>}
                </Button>
                {showFilter && (
                  <FilterBuilder
                    schema={collection.schema}
                    draft={draft ?? FilterModel.Empty}
                    advanced={draft === null ? query.filter : null}
                    onApply={applyFilter}
                    onClose={() => setShowFilter(false)}
                  />
                )}
              </div>

              {searching && (
                <span className={styles.filterPill}>
                  <span className={styles.filterKey}>search</span>
                  <span className={styles.filterValue}>{query.q.trim()}</span>
                  <button className={styles.clearFilter} onClick={clearSearch} aria-label="Clear search">
                    ✕
                  </button>
                </span>
              )}
              {draft === null && (
                <span className={styles.filterPill}>
                  <span className={styles.filterKey}>filter</span>
                  <span className={styles.filterOperator}>advanced</span>
                </span>
              )}

              <div className={styles.toolbarSpacer} />

              {engine && <span className={styles.engineTag} title="Which engine answered (D30)">{engine}</span>}
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
            </div>

            {truncated && (
              <div className={styles.truncatedNote}>
                This search stopped at its scan limit, so {total} counts what was examined rather than what exists.
                Narrow it, or enable the SQLite index.
              </div>
            )}

            <div className="card">
              <div className={`${table.header} ${table.table}`} style={{ ['--cols' as any]: gridCols }}>
                <span className={table.sortable} onClick={() => primary && toggleSort(JsonPath.dataField(primary))}>
                  {primary || 'ID'} {primary && sortIcon(JsonPath.dataField(primary))}
                </span>
                {extra.map((c) => (
                  <span key={c} className={table.sortable} onClick={() => toggleSort(JsonPath.dataField(c))}>
                    {c} {sortIcon(JsonPath.dataField(c))}
                  </span>
                ))}
                <span className={table.sortable} onClick={() => toggleSort(JsonPath.UpdatedAt)}>
                  Updated {sortIcon(JsonPath.UpdatedAt)}
                </span>
                <span />
              </div>

              {entries.map((e) => (
                <div
                  key={e.id}
                  className={`${table.row} ${table.clickable}`}
                  onClick={() => onEditEntry(e)}
                  style={{ ['--cols' as any]: gridCols }}
                >
                  <div className={table.cell}>
                    <div className={table.primary}>
                      <span className={table.title}>{label(e)}</span>
                      <span className={table.subtitle}>{sub ? String(e.data?.[sub] ?? '') : Formatters.shortId(e.id)}</span>
                      <Snippets snippets={snippets[e.id]} />
                    </div>
                  </div>
                  {extra.map((c) => (
                    <div key={c} className={table.cell}>
                      <CellValue schema={collection.schema} name={c} value={e.data?.[c]} />
                    </div>
                  ))}
                  <div className={`${table.cell} ${styles.relativeTime}`}>
                    {Formatters.relativeTime(e.updated_at)}
                  </div>
                  <div className={`${table.actions} ${styles.menuCell}`} onClick={(evt) => evt.stopPropagation()}>
                    <button
                      className={styles.menuButton}
                      onClick={(evt) => {
                        evt.stopPropagation()
                        setMenuId(menuId === e.id ? null : e.id)
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {menuId === e.id && (
                      <RowMenu
                        canEdit={canEdit}
                        canDelete={canDelete}
                        onClose={() => setMenuId(null)}
                        onEdit={() => {
                          setMenuId(null)
                          onEditEntry(e)
                        }}
                        onDelete={() => {
                          setMenuId(null)
                          setToDelete(e)
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}

              {!loading && !error && entries.length === 0 && (
                <div className={`${table.cell} ${styles.noResults}`}>
                  {searching ? `Nothing in ${collection.name} matches “${query.q.trim()}”.` : 'No entries match this filter.'}
                </div>
              )}
            </div>

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
        <Modal onClose={() => setToDelete(null)}>
          <ModalHeader>
            <ModalIcon tone="bad">
              <Trash2 size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Delete this entry?</h3>
              <ModalBody>
                You're about to delete <b>“{label(toDelete)}”</b> from <b>{collection.name}</b>. The row is removed
                immediately and can't be recovered.
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <ModalSubject
            mark={collection.name.charAt(0).toUpperCase()}
            title={label(toDelete)}
            subtitle={
              <>
                {sub && toDelete.data?.[sub] ? String(toDelete.data[sub]) + ' · ' : ''}
                {Formatters.shortId(toDelete.id)}
              </>
            }
          />
          <ModalActions>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete}>
              Delete entry
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
