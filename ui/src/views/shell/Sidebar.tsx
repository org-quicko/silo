import { Plus, Image, ChevronLeft, Settings } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { SiloMark } from '../../components/SiloMark'
import { Link } from '../../router/Link'
import { Routes } from '../../router/routes'
import type { ScopeRef } from '../../api/types/scope-ref'
import styles from './Sidebar.module.css'

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
}) {
  const canCreateCollection = Claims.hasAnyCollectionPermission(
    claims,
    Claims.CollectionCreate,
    scope.project,
    scope.env,
  )
  const showMedia = Claims.has(claims, Claims.MediaRead)

  return (
    <aside className={styles.sidebar}>
      <Link to={Routes.servers()} className={styles.brand} title="Back to servers">
        <div className={styles.brandLogo}>
          <SiloMark size={16} />
        </div>
        <span className={styles.brandName}>silo</span>
        {version && <span className={styles.version}>v{version}</span>}
      </Link>

      <div className={styles.instance}>
        <Link to={Routes.servers()} className={styles.instanceCopy} title="Switch server, project, or environment">
          <div className={styles.instanceHeader}>
            <span className={styles.instanceName}>{instanceLabel}</span>
            <ChevronLeft size={13} className={styles.instanceBack} />
          </div>
          <span className={styles.instanceSubtitle}>
            {scope.project} · {scope.env}
          </span>
        </Link>
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
        <div className={styles.list}>
          {collections.length === 0 && (
            <span className={styles.emptyCollections}>
              No collections yet
            </span>
          )}
          {collections.map((c) => (
            <Link
              key={c.name}
              to={Routes.entries(serverId, scope.project, scope.env, c.name)}
              className={`${styles.item} ${activeCollection === c.name && !activePanel ? styles.active : ''}`}
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
            to={Routes.settingsGeneral(serverId)}
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
    </aside>
  )
}
