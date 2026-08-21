import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { useEffect, useRef, useState } from 'react'
import {
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  Globe,
  Lock,
  Search,
  MoreHorizontal,
  Trash2,
  Calendar,
} from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { JsonPath } from '@silo/shared/json-path'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { SchemaAccess } from '@silo/shared/schema-access'
import { api } from '../../api/api-client'
import { Formatters } from '../../utils/formatters'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { ListQuery } from '../../router/list-query'
import type { ScopeRef } from '../../api/types/scope-ref'
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
import { RowMenu } from './RowMenu'
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
  /** Filter/sort/page live in the URL, so a filtered view is linkable. */
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
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const { sort, desc } = query
  const offset = (query.page - 1) * PAGE_SIZE

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

  // Back/forward (or a fresh deep link) changed the filter — adopt it.
  useEffect(() => {
    if (query.q === synced.current) return
    synced.current = query.q
    setSearch(query.q)
  }, [query.q])

  // Settle typing into the URL. Replaces rather than pushes, so a filtered
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

  const reload = () => {
    setLoading(true)
    const filter = query.q.trim() && primary
      ? { op: 'contains', path: JsonPath.dataField(primary), value: query.q.trim() }
      : undefined
    return api
      .listEntries(url, apiKey, scope, collection.name, { limit: PAGE_SIZE, offset, sort: (desc ? '-' : '') + sort, filter })
      .then((r) => {
        setEntries(r.items)
        setTotal(r.total)
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    const filter = query.q.trim() && primary
      ? { op: 'contains', path: JsonPath.dataField(primary), value: query.q.trim() }
      : undefined
    api
      .listEntries(url, apiKey, scope, collection.name, { limit: PAGE_SIZE, offset, sort: (desc ? '-' : '') + sort, filter })
      .then((r) => {
        if (!alive) return
        setEntries(r.items)
        setTotal(r.total)
      })
      .catch(() => alive && setEntries([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, apiKey, scope, collection.name, offset, sort, desc, query.q])

  /** Takes a path (D29), so the URL and the API speak the same language. */
  const toggleSort = (path: string) => {
    onQueryChange({ ...query, sort: path, desc: sort === path ? !desc : true, page: 1 })
  }

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
  const clearSearch = () => {
    setSearch('')
    synced.current = ''
    onQueryChange({ ...query, q: '', page: 1 }, true)
  }
  const label = (e: Entry) => (primary ? String(e.data?.[primary] ?? Formatters.shortId(e.id)) : Formatters.shortId(e.id))

  return (
    <>
      <TopBar crumbs={[{ label: 'Collections' }, { label: collection.name }]} session={session}>
        <div className={styles.filterField}>
          <Search size={15} />
          <input value={search} placeholder="Filter entries…" onChange={(e) => setSearch(e.target.value)} />
          <span className={styles.keycap}>⌘K</span>
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

        {!loading && total === 0 && !query.q.trim() ? (
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
              <Button variant="secondary" size="sm">
                <SlidersHorizontal size={14} /> Filter
              </Button>
              {query.q.trim() && primary && (
                <span className={styles.filterPill}>
                  <span className={styles.filterKey}>{primary}</span>
                  <span className={styles.filterOperator}>contains</span>
                  <span className={styles.filterValue}>{query.q.trim()}</span>
                  <button className={styles.clearFilter} onClick={clearSearch}>
                    ✕
                  </button>
                </span>
              )}
              <div className={styles.toolbarSpacer} />
              <Button variant="secondary" size="sm" onClick={() => toggleSort(JsonPath.UpdatedAt)}>
                Sort: Updated <ArrowUpDown size={13} />
              </Button>
            </div>

            <div className="card">
              <div className={`${table.header} ${table.table}`} style={{ ['--cols' as any]: gridCols }}>
                <span className={table.sortable} onClick={() => primary && toggleSort(JsonPath.dataField(primary))}>
                  {primary || 'ID'} <ArrowUpDown size={11} />
                </span>
                {extra.map((c) => (
                  <span key={c} className={table.sortable} onClick={() => toggleSort(JsonPath.dataField(c))}>
                    {c} <ArrowUpDown size={11} />
                  </span>
                ))}
                <span className={table.sortable} onClick={() => toggleSort(JsonPath.UpdatedAt)}>
                  Updated
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

              {!loading && entries.length === 0 && (
                <div className={`${table.cell} ${styles.noResults}`}>
                  No entries match “{query.q.trim()}”.
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
