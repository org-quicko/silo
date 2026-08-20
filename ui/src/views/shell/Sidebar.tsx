import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Plus, Image, ChevronsUpDown, Settings, Search, X } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { SiloMark } from '../../components/SiloMark'
import { Link } from '../../router/Link'
import { Routes } from '../../router/routes'
import type { ScopeRef } from '../../api/types/scope-ref'
import styles from './Sidebar.module.css'

const DEFAULT_WIDTH = 248
const MIN_WIDTH = 190
const MAX_WIDTH = 500
const SIDEBAR_WIDTH_KEY = 'silo_sidebar_width'

export interface SidebarCollection {
  name: string
  count: number | null
}

export function Sidebar({
  serverId,
  collections,
  activeCollection,
  activePanel,
  claims,
  version,
  instanceLabel,
  totalEntries,
  scope,
  onOpenServerBrowser,
}: {
  serverId: string
  collections: SidebarCollection[]
  activeCollection: string | null
  activePanel: 'keys' | 'transfer' | 'media' | 'settings' | null
  claims: string[]
  version: string
  instanceLabel: string
  totalEntries: number | null
  url: string
  apiKey: string
  scope: ScopeRef
  onScopeChange?: (next: ScopeRef) => void
  onOpenServerBrowser?: () => void
}) {
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        return parsed
      }
    }
    return DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const [search, setSearch] = useState('')

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    isResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const nextWidth = Math.min(Math.max(moveEvent.clientX, MIN_WIDTH), MAX_WIDTH)
      setWidth(nextWidth)
    }

    const onMouseUp = (upEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)

      const finalWidth = Math.min(Math.max(upEvent.clientX, MIN_WIDTH), MAX_WIDTH)
      setWidth(finalWidth)
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH)
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH))
  }, [])

  useEffect(() => {
    return () => {
      if (isResizingRef.current) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [])

  const filteredCollections = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return collections
    return collections.filter((c) => c.name.toLowerCase().includes(query))
  }, [collections, search])

  const canCreateCollection = Claims.hasAnyCollectionPermission(
    claims,
    Claims.CollectionCreate,
    scope.project,
    scope.env,
  )
  const showMedia = Claims.has(claims, Claims.MediaRead)

  return (
    <aside
      className={`${styles.sidebar} ${isResizing ? styles.resizing : ''}`}
      style={{ width: `${width}px` }}
    >
      <Link to={Routes.collections(serverId, scope.project, scope.env)} className={styles.brand} title="Silo">
        <div className={styles.brandLogo}>
          <SiloMark size={16} />
        </div>
        <span className={styles.brandName}>silo</span>
        {version && <span className={styles.version}>v{version}</span>}
      </Link>

      <div className={styles.instance}>
        <button
          type="button"
          className={styles.instanceBtn}
          onClick={onOpenServerBrowser}
          title="Switch server, project, or environment"
        >
          <div className={styles.instanceHeader}>
            <span className={styles.instanceName}>{instanceLabel}</span>
            <ChevronsUpDown size={13} className={styles.instanceChevron} />
          </div>
          <span className={styles.instanceSubtitle}>
            {scope.project} · {scope.env}
          </span>
        </button>
      </div>

      <div className={styles.scroll}>
        <div className={styles.groupHead}>
          <span className={styles.groupLabel}>COLLECTIONS</span>
          {canCreateCollection && (
            <Link
              to={Routes.schema(serverId, scope.project, scope.env, null)}
              className={styles.add}
              title="New collection"
            >
              <Plus size={13} />
            </Link>
          )}
        </div>

        {collections.length > 0 && (
          <div className={styles.searchWrap}>
            <Search size={13} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search collections…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('')
              }}
              aria-label="Search collections"
            />
            {search && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearch('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}

        <div className={styles.list}>
          {collections.length === 0 && (
            <span className={styles.emptyCollections}>
              No collections yet
            </span>
          )}
          {collections.length > 0 && filteredCollections.length === 0 && (
            <span className={styles.emptyCollections}>
              No matching collections
            </span>
          )}
          {filteredCollections.map((c) => (
            <Link
              key={c.name}
              to={Routes.entries(serverId, scope.project, scope.env, c.name)}
              className={`${styles.item} ${activeCollection === c.name && !activePanel ? styles.active : ''}`}
              title={c.name}
            >
              <span className={styles.avatar}>{c.name.charAt(0).toUpperCase()}</span>
              <span className={styles.itemName}>{c.name}</span>
              {c.count != null && <span className={styles.itemCount}>{c.count}</span>}
            </Link>
          ))}
        </div>
      </div>

      {showMedia && (
        <>
          <div className={styles.divider} />
          <div className={`${styles.list} ${styles.panelList}`}>
            <Link
              to={Routes.media(serverId, scope.project, scope.env)}
              className={`${styles.item} ${activePanel === 'media' ? styles.active : ''}`}
            >
              <span className={styles.itemIcon}><Image size={15} /></span>
              <span className={styles.itemName}>Media Library</span>
            </Link>
          </div>
        </>
      )}

      <div className={styles.admin}>
        <div className={styles.divider} />
        <span className={`${styles.groupLabel} ${styles.adminLabel}`}>
          ADMIN
        </span>
        <div className={styles.list}>
          <Link
            to={Routes.projectSettings(serverId, scope.project, 'general')}
            className={styles.item}
          >
            <span className={styles.itemIcon}>
              <Settings size={15} />
            </span>
            <span className={styles.itemName}>Settings</span>
          </Link>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.connection}>
          <span className={styles.pulse} /> connected
        </span>
        {totalEntries != null && <span className={styles.entryCount}>{totalEntries} entries</span>}
      </div>

      <div
        className={`${styles.resizer} ${isResizing ? styles.isResizing : ''}`}
        onMouseDown={startResizing}
        onDoubleClick={resetWidth}
        title="Drag to resize sidebar, double-click to reset"
      />
    </aside>
  )
}
