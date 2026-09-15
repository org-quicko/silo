import { useEffect } from 'react'
import { X } from 'lucide-react'
import { KeyScopes, type KeyScope } from './key-scope'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  scope: KeyScope
  catalog: ScopeCatalog
  onChange: (scope: KeyScope) => void
  onRemove?: () => void
}

/**
 * One project/environment pair, each segment a name or the wildcard.
 *
 * The environment control changes shape with the project, and deliberately.
 * Under a named project it is that project's environment list. Under **every
 * project** it is free text, because the answer there is an environment *name*
 * that may exist in projects the current key cannot list, so one project's ids
 * are a suggestion rather than the set of valid answers.
 */
export function ScopeRow({ scope, catalog, onChange, onRemove }: Props) {
  const anyProject = KeyScopes.isAny(scope.project)

  useEffect(() => {
    if (!anyProject) catalog.loadEnvironments(scope.project)
  }, [scope.project, anyProject])

  const environments = catalog.environmentsOf(scope.project)

  const changeProject = (project: string) => {
    if (KeyScopes.isAny(project)) {
      onChange({ project, env: scope.env })
      return
    }
    // The env list belongs to the project it was drawn from, so an environment
    // the new project does not have is dropped rather than carried over.
    const known = catalog.environmentsOf(project)
    const env = known.includes(scope.env) ? scope.env : (known[0] ?? '')
    onChange({ project, env })
  }

  return (
    <div className={styles.scopeRow}>
      <select
        className="input"
        value={scope.project}
        onChange={(event) => changeProject(event.target.value)}
      >
        <option value={KeyScopes.Any}>Every project</option>
        {catalog.projects.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        {scope.project && !anyProject && !catalog.projects.includes(scope.project) && (
          <option value={scope.project}>{scope.project}</option>
        )}
      </select>

      <span className={styles.scopeSlash}>/</span>

      {anyProject ? (
        <>
          <input
            className="input"
            list="silo-known-envs"
            value={KeyScopes.isAny(scope.env) ? '' : scope.env}
            spellCheck={false}
            placeholder="Every environment"
            onChange={(event) =>
              onChange({ ...scope, env: event.target.value.trim() || KeyScopes.Any })
            }
          />
          <datalist id="silo-known-envs">
            {catalog.knownEnvironments.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      ) : (
        <select
          className="input"
          value={scope.env}
          onChange={(event) => onChange({ ...scope, env: event.target.value })}
        >
          <option value={KeyScopes.Any}>Every environment</option>
          {environments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {scope.env && !KeyScopes.isAny(scope.env) && !environments.includes(scope.env) && (
            <option value={scope.env}>{scope.env}</option>
          )}
        </select>
      )}

      {onRemove && (
        <button type="button" className={styles.scopeRemove} title="Remove" onClick={onRemove}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
