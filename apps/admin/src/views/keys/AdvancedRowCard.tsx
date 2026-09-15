import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { ClaimWords } from '../../claims/claim-words'
import { CollectionPicker } from './CollectionPicker'
import { KeyScopes } from './key-scope'
import type { AdvancedRow } from './key-plan'
import { ScopeRow } from './ScopeRow'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  row: AdvancedRow
  catalog: ScopeCatalog
  ownClaims: string[]
  onChange: (row: AdvancedRow) => void
  onRemove: () => void
}

/**
 * One scope's collection grant: where, which collections, and which of the
 * nine permissions.
 *
 * A permission is offered only where the current key could actually delegate it
 * *for this row's targets*, so widening a row's scope can grey out a
 * permission that was live a moment ago. That is the honest behaviour: the
 * refusal belongs next to the choice that caused it rather than in a banner at
 * the bottom of the page.
 */
export function AdvancedRowCard({ row, catalog, ownClaims, onChange, onRemove }: Props) {
  useEffect(() => {
    catalog.loadCollections(row.scope)
  }, [row.scope.project, row.scope.env])

  const named = KeyScopes.complete(row.scope) &&
    !KeyScopes.isAny(row.scope.project) &&
    !KeyScopes.isAny(row.scope.env)

  const targets = row.collections.length > 0 ? row.collections : [Claims.Root]

  const blocked = (permission: CollectionPermission): boolean =>
    !KeyScopes.complete(row.scope) ||
    !Claims.canDelegate(
      ownClaims,
      targets.map((name) => Claims.collection(row.scope.project, row.scope.env, name, permission)),
    )

  const toggle = (permission: CollectionPermission) =>
    onChange({
      ...row,
      permissions: row.permissions.includes(permission)
        ? row.permissions.filter((held) => held !== permission)
        : [...row.permissions, permission],
    })

  return (
    <div className={styles.advancedRow}>
      <div className={styles.advancedRowHead}>
        <ScopeRow scope={row.scope} catalog={catalog} onChange={(scope) => onChange({ ...row, scope })} />
        <button type="button" className={styles.scopeRemove} title="Remove scope" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>

      {named ? (
        <CollectionPicker
          scopeLabel={KeyScopes.describe(row.scope)}
          collections={catalog.collectionsOf(row.scope)}
          selected={row.collections}
          narrowed={!!row.narrowed}
          onNarrow={(narrowed) =>
            onChange({ ...row, narrowed, collections: narrowed ? row.collections : [] })
          }
          onToggle={(name) =>
            onChange({
              ...row,
              collections: row.collections.includes(name)
                ? row.collections.filter((held) => held !== name)
                : [...row.collections, name],
            })
          }
        />
      ) : (
        // A collection list is drawn from one concrete scope's contents, and
        // the same name under a wildcard is a different collection in every
        // scope it matches. There is nothing here to enumerate.
        <p className={styles.wildNote}>
          Every collection in {KeyScopes.describe(row.scope)}. Naming collections needs one project
          and one environment.
        </p>
      )}

      <div className={styles.permissions}>
        {ClaimWords.permissionOrder.map((permission) => {
          const unavailable = blocked(permission)
          return (
            <label
              key={permission}
              className={`${styles.permission} ${unavailable ? styles.permissionBlocked : ''}`}
              title={
                unavailable
                  ? 'The current key cannot delegate this permission here.'
                  : ClaimWords.permissions[permission]
              }
            >
              <input
                type="checkbox"
                checked={row.permissions.includes(permission)}
                disabled={unavailable}
                onChange={() => toggle(permission)}
              />
              <span>
                <b>{ClaimWords.permissions[permission]}</b>
                <small>{permission}</small>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
