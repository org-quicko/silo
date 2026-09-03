import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Plus, Image, ChevronsUpDown, Settings, Search, X, Shield, Keyboard } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { SiloMark } from '../../components/brand/SiloMark'
import { Link } from '../../router/Link'
import { Routes } from '../../router/routes'
import type { ScopeRef } from '../../api/types/scope-ref'
import { ACCESS_TEXT, type SessionBadge } from './session-badge'
import { PlatformKeys } from '../../utils/platform-keys'
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
  session,
  scope,
  onOpenServerBrowser,
  onShowShortcuts,
}: {
  serverId: string
  collections: SidebarCollection[]
  activeCollection: string | null
  activePanel: 'keys' | 'transfer' | 'media' | 'settings' | null
  claims: string[]
  version: string
  instanceLabel: string
  session: SessionBadge
  url: string
  apiKey: string
  scope: ScopeRef
  onScopeChange?: (next: ScopeRef) => void
  onOpenServerBrowser?: () => void
  /** Opens the shell's shortcut list, the same dialog `?` opens. */
  onShowShortcuts: () => void
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
  const [filterOpen, setFilterOpen] = useState(false)
  const filterInput = useRef<HTMLInputElement>(null)

  // The header icon toggles the filter field (handoff 1b); ⌥F opens it too and
  // autofocuses, from anywhere in the sidebar's page.
  //
  // Matched on `code`, not `key`: Option is a compose modifier on macOS, so
  // ⌥F arrives with `key === "ƒ"` and a `key`-based check never fires there —
  // which is every machine this is developed on.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.code === 'KeyF') {
        event.preventDefault()
        setFilterOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (filterOpen) filterInput.current?.focus()
  }, [filterOpen])

  const closeFilter = () => {
    setFilterOpen(false)
    setSearch('')
  }

  const startResizing = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
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
          <div className={styles.instanceText}>
            <span className={styles.instanceName}>{instanceLabel}</span>
            <span className={styles.instanceSubtitle}>
              {scope.project} · {scope.env}
            </span>
          </div>
          <ChevronsUpDown size={13} className={styles.instanceChevron} />
        </button>
      </div>

      <div className={styles.scroll}>
        <div className={styles.groupHead}>
          <span className={styles.groupLabel}>COLLECTIONS</span>
          <span className={styles.groupCount}>{collections.length}</span>
          <span className={styles.groupSpacer} />
          {collections.length > 0 && (
            <button
              type="button"
              className={`${styles.groupIcon} ${filterOpen ? styles.groupIconActive : ''}`}
              // The field collapses on blur when empty, and blur lands before
              // click — without this, clicking the icon to close an empty
              // filter would close it and then immediately reopen it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (filterOpen ? closeFilter() : setFilterOpen(true))}
              title={`Search collections (${PlatformKeys.alt()}F)`}
              aria-label="Search collections"
            >
              <Search size={17} />
            </button>
          )}
        </div>

        {filterOpen && (
          <div className={styles.searchWrap}>
            <Search size={13} className={styles.searchIcon} />
            <input
              ref={filterInput}
              type="text"
              className={styles.searchInput}
              placeholder="Search collections…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeFilter()
              }}
              onBlur={() => {
                // Collapses on blur only when empty — a filter someone is
                // still reading should not vanish out from under them.
                if (!search) setFilterOpen(false)
              }}
              aria-label="Search collections"
            />
            {search && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearch('')}
                title="Clear filter"
                aria-label="Clear filter"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}

        {canCreateCollection && (
          <Link
            to={Routes.schema(serverId, scope.project, scope.env, null)}
            className={styles.newCollectionBtn}
          >
            <Plus size={13} />
            New collection
          </Link>
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

      <div className={styles.divider} />
      <div className={`${styles.list} ${styles.panelList}`}>
        {showMedia && (
          <Link
            to={Routes.media(serverId, scope.project, scope.env)}
            className={`${styles.item} ${activePanel === 'media' ? styles.active : ''}`}
          >
            <span className={styles.itemIcon}><Image size={15} /></span>
            <span className={styles.itemName}>Media Library</span>
          </Link>
        )}
        <Link
          to={Routes.projectSettings(serverId, scope.project, 'general')}
          className={styles.item}
        >
          <span className={styles.itemIcon}>
            <Settings size={15} />
          </span>
          <span className={styles.itemName}>Settings</span>
        </Link>
        {/* A button, not a link: it opens a dialog rather than going anywhere. */}
        <button type="button" className={styles.item} onClick={onShowShortcuts}>
          <span className={styles.itemIcon}>
            <Keyboard size={15} />
          </span>
          <span className={styles.itemName}>Keyboard shortcuts</span>
          <span className={styles.itemCount}>?</span>
        </button>
      </div>

      <div className={styles.divider} />

      {/* Not a control — states what the connected key can do here and
          which server it's talking to. No affordance implies a click that
          does nothing, so this is a plain row, not a button. */}
      <div className={styles.footer}>
        <span className={styles.accountIcon}>
          <Shield size={14} />
          <span className={`${styles.presenceDot} ${styles[session.level]}`} />
        </span>
        <span className={styles.accountCopy}>
          <span className={styles.accountPrimary}>{ACCESS_TEXT[session.level]}</span>
          <span className={styles.accountSecondary}>Connected · {instanceLabel}</span>
        </span>
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
