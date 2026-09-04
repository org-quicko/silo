import { Globe, Lock, Plus } from 'lucide-react'
import { SchemaAccess } from '@silo/shared/schema-access'
import type { Collection } from '../../api/types/collection'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { ApiGuide } from '../ApiGuide'

interface Props {
  collection: Collection
  url: string
  scope: ScopeRef
  total: number
  /** Only shown when the view can honestly back it — see `Entries`. */
  lastUpdated: string | null
  canCreate: boolean
  canEditSchema: boolean
  onEditSchema: () => void
  onNewEntry: () => void
}

/** The collection's name, its read access, its size, and the two actions. */
export function EntriesHeader({
  collection,
  url,
  scope,
  total,
  lastUpdated,
  canCreate,
  canEditSchema,
  onEditSchema,
  onNewEntry,
}: Props) {
  const isPrivate = SchemaAccess.requiresAuth(collection.schema)

  return (
    <div className="page-head">
      <div className="page-title-group">
        <div className="page-title-row">
          <h2 className="page-title">{collection.name}</h2>
          {/* A glyph, not a tint: a shape distinguishes the two states for a
              reader who cannot tell the two colours apart. */}
          {isPrivate ? (
            <Pill tone="warn">
              <Lock size={12} /> auth required
            </Pill>
          ) : (
            <Pill tone="ok">
              <Globe size={12} /> public read
            </Pill>
          )}
        </div>
        <span className="page-sub">
          {total} {total === 1 ? 'entry' : 'entries'}
          {lastUpdated && <> · updated {lastUpdated}</>}
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
  )
}
