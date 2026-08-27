import { Trash2 } from 'lucide-react'
import type { Collection } from '../../api/types/collection'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import styles from './SchemaEditor.module.css'

interface Props {
  collection: Collection
  scope: ScopeRef
  fieldCount: number
  entryCount: number | null
  requiresAuth: boolean
  canDelete: boolean
  onDelete: () => void
}

/** The facts about an existing collection, beside the editor. */
export function CollectionRail({
  collection,
  scope,
  fieldCount,
  entryCount,
  requiresAuth,
  canDelete,
  onDelete,
}: Props) {
  const rows: Array<[string, string | number]> = [
    ['name', collection.name],
    ['project', scope.project],
    ['environment', scope.env],
    ['fields', fieldCount],
    ['entries', entryCount ?? '—'],
    ['read access', requiresAuth ? 'API key' : 'public'],
  ]

  return (
    <aside className={styles.rail}>
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

      {canDelete && (
        <>
          <div className={styles.railDivider} />
          <Button variant="dangerGhost" onClick={onDelete}>
            <Trash2 size={14} /> Delete collection
          </Button>
          <span className={styles.railCaption}>
            Deletes the schema and every entry in this collection. This can't be undone.
          </span>
        </>
      )}
    </aside>
  )
}
