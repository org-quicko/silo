import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Image,
  Layers,
  MoreHorizontal,
  Package,
} from 'lucide-react'
import type { TrashItem, TrashKind } from '../../api/types/trash-item'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { TrashLabels } from './trash-labels'
import styles from './Trash.module.css'

/**
 * One receipt: what it was, where it came from, when it went, and the way back.
 *
 * One row per *explicitly* deleted thing, never one per descendant — a
 * collection deleted with 300 entries is this row saying "300 entries", and the
 * disclosure is where that hierarchy lives.
 */
export function TrashRow({
  item,
  busy,
  canPurge,
  contents,
  onToggle,
  onRestore,
  onPurge,
}: {
  item: TrashItem
  busy: boolean
  canPurge: boolean
  /** The parked records, once loaded; undefined while collapsed. */
  contents?: { items: unknown[]; total: number }
  onToggle: () => void
  onRestore: (options: { rename?: string; chain?: boolean }) => void
  onPurge: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  // A leaf has no contents to disclose but itself, so it gets no triangle.
  const expandable =
    item.kind !== 'entry' &&
    item.kind !== 'media' &&
    (item.contents.entries > 0 || item.contents.assets > 0)
  const origin = TrashLabels.origin(item)
  const summary = TrashLabels.contents(item)

  return (
    <div className={styles.row}>
      {expandable ? (
        <button
          type="button"
          className={styles.disclosure}
          onClick={onToggle}
          aria-label={contents ? 'Hide contents' : 'Show contents'}
          aria-expanded={Boolean(contents)}
        >
          {contents ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span className={styles.disclosureSpacer} />
      )}

      <div className={styles.body}>
        <div className={styles.name}>
          <KindIcon kind={item.kind} />
          <span className={styles.nameText} title={item.subject_name}>
            {item.subject_name}
          </span>
          <Pill>{TrashLabels.kinds[item.kind]}</Pill>
        </div>

        <div className={styles.meta}>
          {origin.map((segment, index) => (
            <span key={`${segment}-${index}`}>
              {index > 0 && <span className={styles.separator}> / </span>}
              <span className={isStale(item, index) ? styles.stale : undefined}>{segment}</span>
            </span>
          ))}
          {summary && (
            <>
              <span className={styles.separator}>·</span>
              <span>{summary}</span>
            </>
          )}
          <span className={styles.separator}>·</span>
          <span title={new Date(item.deleted_at).toLocaleString()}>
            {TrashLabels.since(item.deleted_at)} by {TrashLabels.actor(item.deleted_by)}
          </span>
          <span className={styles.separator}>·</span>
          <span title={item.expires_at ? new Date(item.expires_at).toLocaleString() : undefined}>
            {TrashLabels.expiry(item.expires_at)}
          </span>
        </div>

        {item.blocked_by && (
          <div className={styles.blocked}>
            <span>
              Its {TrashLabels.kinds[item.blocked_by.kind].toLowerCase()} &quot;
              {item.blocked_by.name}&quot;{' '}
              {item.blocked_by.trash_id ? 'is in the trash too.' : 'no longer exists.'}
            </span>
            {item.blocked_by.trash_id && (
              <Button size="sm" disabled={busy} onClick={() => onRestore({ chain: true })}>
                Restore both
              </Button>
            )}
          </div>
        )}

        {contents && <Contents items={contents.items} total={contents.total} />}
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !item.restorable}
          onClick={() => onRestore({})}
        >
          Restore
        </Button>
        <div className={styles.menuWrap}>
          <Button
            size="sm"
            className={styles.menuButton}
            aria-label="More actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={14} />
          </Button>
          {menuOpen && (
            <div className={styles.menu} onMouseLeave={() => setMenuOpen(false)}>
              {/* Hidden rather than disabled without `trash:purge`: an
                  affordance the server will refuse is worse than none. */}
              {canPurge && (
                <button
                  type="button"
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={() => {
                    setMenuOpen(false)
                    onPurge()
                  }}
                >
                  Delete permanently
                </button>
              )}
              {!canPurge && <span className={styles.menuItem}>No other actions</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** One parked record as the API returns it: the wrapper, then the record. */
interface ParkedItem {
  kind: TrashKind
  record: unknown
}

/**
 * What rode along, listed read-only.
 *
 * The container's own record is parked beside its contents and is filtered out
 * here: a collection row already names itself, so listing it again inside its
 * own disclosure reads as a fourth entry that is not there.
 */
function Contents({ items, total }: { items: unknown[]; total: number }) {
  const parked = items as ParkedItem[]
  const leaves = parked.filter((item) => item.kind === 'entry' || item.kind === 'media')
  const hidden = total - parked.length

  return (
    <div className={styles.contents}>
      <ul className={styles.contentsList}>
        {leaves.map((item, index) => (
          <li key={index}>{describe(item.record)}</li>
        ))}
      </ul>
      {hidden > 0 && <div className={styles.contentsMore}>and {hidden} more</div>}
    </div>
  )
}

/** A breadcrumb segment whose record is gone, so it reads as history. */
function isStale(item: TrashItem, index: number): boolean {
  if (!item.blocked_by) return false
  const crumbs = TrashLabels.origin(item)
  return crumbs[index] === item.blocked_by.name
}

/** One parked record, in a line. The shapes differ by kind, so this reads the
 *  few fields they have in common and falls back to the id. */
function describe(record: unknown): string {
  if (!record || typeof record !== 'object') return String(record)
  const fields = record as Record<string, unknown>
  if (typeof fields.filename === 'string') return fields.filename
  if (typeof fields.name === 'string') return fields.name
  if (typeof fields.path === 'string') return fields.path
  const data = fields.data
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return typeof fields.id === 'string' ? fields.id : 'record'
}

function KindIcon({ kind }: { kind: TrashKind }) {
  const size = 14
  if (kind === 'project') return <Package size={size} />
  if (kind === 'environment') return <Layers size={size} />
  if (kind === 'collection') return <Layers size={size} />
  if (kind === 'media') return <Image size={size} />
  if (kind === 'media_folder') return <Folder size={size} />
  return <FileText size={size} />
}
