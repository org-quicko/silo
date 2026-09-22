import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { SiloApi } from '../../api/silo-api'
import type { TrashItem, TrashKind } from '../../api/types/trash-item'
import { Button } from '../../components/buttons/Button'
import { LoadingState } from '../../components/feedback/LoadingState'
import { DangerConfirm } from '../../components/modal/DangerConfirm'
import { TrashLabels } from './trash-labels'
import { TrashRow } from './TrashRow'
import { useTrash } from './use-trash'
import styles from './Trash.module.css'

/** How many parked records an expanded row shows before it says "and N more". */
const ContentsPreview = 25

/**
 * The trash (D91): one flat list, newest first, one row per explicitly deleted
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
  url,
  apiKey,
  claims,
}: {
  api: SiloApi
  url: string
  apiKey: string
  claims: string[]
}) {
  const trash = useTrash(api, url, apiKey)
  const [expanded, setExpanded] = useState<Record<string, { items: unknown[]; total: number }>>({})
  const [confirmEmpty, setConfirmEmpty] = useState(false)
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
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Trash</h1>
        {canPurge && trash.total > 0 && (
          <Button variant="danger" size="sm" onClick={() => setConfirmEmpty(true)}>
            Empty trash
          </Button>
        )}
      </div>
      <p className={styles.lede}>Deleted items you can still restore.</p>

      <div className={styles.filters}>
        <select
          value={trash.query.kind ?? ''}
          onChange={(event) =>
            trash.setQuery({ ...trash.query, kind: (event.target.value || undefined) as TrashKind })
          }
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {(Object.keys(TrashLabels.kinds) as TrashKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {TrashLabels.kinds[kind]}
            </option>
          ))}
        </select>
        <input
          className={styles.search}
          type="search"
          placeholder="Filter by name"
          value={trash.query.q ?? ''}
          onChange={(event) => trash.setQuery({ ...trash.query, q: event.target.value })}
          aria-label="Filter by name"
        />
      </div>

      {trash.error && (
        <div className="notice noticeBad" role="alert" onClick={trash.dismissError}>
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
              onPurge={() => void trash.purge(item)}
            />
          ))}
        </div>
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
          Permanently deletes {trash.total} items. There is no undo.
        </DangerConfirm>
      )}
    </div>
  )
}
