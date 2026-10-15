import { Claims } from '@silo/shared/claims'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SiloApi } from '../../api/silo-api'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { TrashItem } from '../../api/types/trash-item'
import { ColumnSearch } from '../../components/browser/ColumnSearch'
import { Button } from '../../components/buttons/Button'
import { Pagination } from '../../components/data/Pagination'
import { LoadingState } from '../../components/feedback/LoadingState'
import { DangerConfirm } from '../../components/modal/DangerConfirm'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { SmartSearch } from '../search/SmartSearch'
import { TopBar } from '../shell/TopBar'
import { PurgeTrashItemDialog } from './PurgeTrashItemDialog'
import styles from './Trash.module.css'
import { TrashKindFilter } from './TrashKindFilter'
import { TrashRow } from './TrashRow'
import { useTrash } from './use-trash'

/** How many parked records an expanded row shows before it says "and N more". */
const ContentsPreview = 25

/**
 * The trash (D113): one flat list, newest first, one row per explicitly deleted
 * thing.
 *
 * Flat rather than a tree of project > env > collection, because a trash tree
 * is mostly empty nodes and the question anyone brings here is "undo what I
 * just did", which is time-ordered. The hierarchy is a filter across the list
 * and reappears inside a row that took children with it. See
 * `docs/design/trash.md`.
 */
export function Trash({
  api,
  serverId,
  scope,
  collections,
  url,
  apiKey,
  claims,
}: {
  api: SiloApi
  serverId: string
  scope: ScopeRef
  /** For the top bar's search, as every workspace page has it. */
  collections: readonly { name: string; count: number | null }[]
  url: string
  apiKey: string
  claims: string[]
}) {
  const trash = useTrash(api, url, apiKey)
  const [expanded, setExpanded] = useState<Record<string, { items: unknown[]; total: number }>>({})
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState<TrashItem | null>(null)
  const canPurge = Claims.has(claims, Claims.TrashPurge)

  const toggle = async (item: TrashItem) => {
    if (expanded[item.id]) {
      setExpanded(({ [item.id]: _removed, ...rest }) => rest)
      return
    }
    const page = await api.trash.items(url, apiKey, item.id, { limit: ContentsPreview })
    setExpanded((current) => ({ ...current, [item.id]: page }))
  }

  return (
    <>
      <TopBar
        search={
          <SmartSearch serverId={serverId} url={url} apiKey={apiKey} scope={scope} collections={collections} />
        }
      />

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Admin' }, { label: 'Trash' }]} />

        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Trash</h2>
            <span className="page-sub">Deleted items you can still restore.</span>
          </div>
          {canPurge && trash.total > 0 && (
            <div className="head-actions">
              <Button variant="danger" onClick={() => setConfirmEmpty(true)}>
                <Trash2 size={14} /> Empty trash
              </Button>
            </div>
          )}
        </div>

        <div className={styles.toolbar}>
          <ColumnSearch
            className={styles.search}
            label="Search trash"
            value={trash.query.q ?? ''}
            onChange={(q) => trash.setQuery({ ...trash.query, q })}
          />
          <TrashKindFilter value={trash.query.kind} onChange={(kind) => trash.setQuery({ ...trash.query, kind })} />
        </div>

        {trash.error && (
          <div className={`banner banner-bad ${styles.error}`} role="alert" onClick={trash.dismissError}>
            {trash.error}
          </div>
        )}

        {trash.loading && <LoadingState message="Loading trash…" />}

        {!trash.loading && trash.items.length === 0 && (
          <div className={styles.empty}>
            <Trash2 size={22} />
            <div className={styles.emptyTitle}>Nothing in the trash</div>
            <div>Deleted items stay here until they expire, then they go for good.</div>
          </div>
        )}

        {!trash.loading && trash.items.length > 0 && (
          <div className={styles.list}>
            {trash.items.map((item) => (
              <TrashRow
                key={item.id}
                item={item}
                busy={trash.busy === item.id}
                canPurge={canPurge}
                contents={expanded[item.id]}
                onToggle={() => void toggle(item)}
                onRestore={(options) => void trash.restore(item, options)}
                onPurge={() => setConfirmPurge(item)}
              />
            ))}
            <Pagination
              bordered={false}
              page={Math.floor(trash.offset / trash.pageSize) + 1}
              pageSize={trash.pageSize}
              total={trash.total}
              onPageChange={(page) => trash.setOffset((page - 1) * trash.pageSize)}
              onPageSizeChange={trash.setPageSize}
            />
          </div>
        )}

        {confirmPurge && (
          <PurgeTrashItemDialog
            item={confirmPurge}
            onCancel={() => setConfirmPurge(null)}
            onConfirm={() => {
              setConfirmPurge(null)
              void trash.purge(confirmPurge)
            }}
          />
        )}

        {confirmEmpty && (
          <DangerConfirm
            title="Empty trash"
            confirmWord="empty"
            confirmLabel="Empty trash"
            busy={trash.busy === '*'}
            onCancel={() => setConfirmEmpty(false)}
            onConfirm={() => {
              setConfirmEmpty(false)
              void trash.empty()
            }}
          >
            Permanently deletes every item in this server’s trash, including items hidden by the current
            search and filters. There is no undo.
          </DangerConfirm>
        )}
      </div>
    </>
  )
}
