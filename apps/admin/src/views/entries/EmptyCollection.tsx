import { Calendar, Plus } from 'lucide-react'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import styles from './Entries.module.css'

interface Props {
  collection: string
  scope: ScopeRef
  canCreate: boolean
  onNewEntry: () => void
}

/** What a collection with a schema and no content shows — including the
 *  request that would return the same emptiness, so the API is one copy away. */
export function EmptyCollection({ collection, scope, canCreate, onNewEntry }: Props) {
  return (
    <div className={`card ${styles.emptyCard}`}>
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <Calendar size={26} strokeWidth={1.7} />
        </div>
        <h3>No entries in {collection} yet</h3>
        <p>
          This collection&apos;s schema is ready — it just needs content. Create your first
          entry with the generated form, or bring data in from another silo.
        </p>
        <div className={styles.emptyActions}>
          {canCreate && (
            <Button variant="primary" onClick={onNewEntry}>
              <Plus size={14} strokeWidth={2.4} /> New entry
            </Button>
          )}
        </div>
        <span className={styles.apiHint}>
          GET /api/projects/{scope.project}/envs/{scope.env}/collections/{collection} →{' '}
          {'{ "data": [], "total": 0 }'}
        </span>
      </div>
    </div>
  )
}
