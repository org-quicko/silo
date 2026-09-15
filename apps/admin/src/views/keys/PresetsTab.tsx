import type { ClaimPreset } from '@silo/shared/claim-preset'
import type { KeyScope } from './key-scope'
import { KeyRoles } from './key-roles'
import { ScopeList } from './ScopeList'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  role: ClaimPreset
  scopes: KeyScope[]
  catalog: ScopeCatalog
  /** Roles the current key cannot delegate, mapped to the reason why. */
  blocked: Partial<Record<ClaimPreset, string>>
  onRole: (role: ClaimPreset) => void
  onScopes: (scopes: KeyScope[]) => void
}

/**
 * One standard role, over one or more scopes.
 *
 * The overwhelmingly common key is a single role, and this tab exists so that
 * key takes two clicks. Everything the role bundles — including the media and
 * operator claims each one carries — comes with it here rather than appearing
 * as toggles: a preset whose contents you have to assemble is not a preset. The
 * review below still spells out every claim it produced.
 */
export function PresetsTab({ role, scopes, catalog, blocked, onRole, onScopes }: Props) {
  return (
    <>
      <div className={styles.block}>
        <h3>Role</h3>
        <p>Each role includes everything the one before it grants.</p>
        <div className={styles.roles}>
          {KeyRoles.All.map((option) => {
            const reason = blocked[option.value] ?? ''
            return (
              <button
                key={option.value}
                type="button"
                className={`${styles.role} ${role === option.value ? styles.roleActive : ''} ${option.value === 'root' ? styles.roleRoot : ''}`}
                disabled={!!reason}
                title={reason || undefined}
                onClick={() => onRole(option.value)}
              >
                <b>{option.label}</b>
                <span>{option.blurb}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.block}>
        <h3>Where it applies</h3>
        {role === 'root' ? (
          <p className={styles.rootNote}>
            A root key covers every project and environment, so it takes no scope.
          </p>
        ) : (
          <>
            <p>The projects and environments this role is granted over.</p>
            <ScopeList
              scopes={scopes}
              catalog={catalog}
              onChange={onScopes}
              hint="The role applies to every collection in each scope, including ones created later."
            />
          </>
        )}
      </div>
    </>
  )
}
