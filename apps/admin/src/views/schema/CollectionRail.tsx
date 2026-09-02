import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { Collection } from '../../api/types/collection'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import styles from './SchemaEditor.module.css'

interface Props {
  /** `null` while the collection is being created: the rail is then its actions alone. */
  collection: Collection | null
  scope: ScopeRef
  fieldCount: number
  entryCount: number | null
  requiresAuth: boolean
  canDelete: boolean
  onDelete: () => void
  /** Save and Cancel. A page's actions belong with the page, not in the top bar. */
  actions: ReactNode
}

/** The editor's right column: what the page can do, then the facts about the
 *  collection it is editing. */
export function CollectionRail({
  collection,
  scope,
  fieldCount,
  entryCount,
  requiresAuth,
  canDelete,
  onDelete,
  actions,
}: Props) {
  const rows: Array<[string, string | number]> = collection ? [
    ['name', collection.name],
    ['project', scope.project],
    ['environment', scope.env],
    ['fields', fieldCount],
    ['entries', entryCount ?? '—'],
    ['read access', requiresAuth ? 'API key' : 'public'],
  ] : []

  return (
    <aside className={styles.rail}>
      {collection && (
        <>
          <div className={styles.metadataGroup}>
            <span className={styles.metadataLabel}>COLLECTION</span>
            {rows.map(([key, value]) => (
              <div className={styles.metadataRow} key={key}>
                <span className={styles.metadataKey}>{key}</span>
                <span className={styles.metadataValue} title={String(value)}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.railDivider} />
        </>
      )}

      {/* Every action the page has, in one block under what it is acting on. */}
      <div className={styles.railActions}>
        {actions}
        {collection && canDelete && (
          <>
            <Button variant="dangerGhost" onClick={onDelete}>
              <Trash2 size={14} /> Delete collection
            </Button>
            <span className={styles.railCaption}>
              Deletes the schema and every entry in this collection. This can't be undone.
            </span>
          </>
        )}
      </div>
    </aside>
  )
}
