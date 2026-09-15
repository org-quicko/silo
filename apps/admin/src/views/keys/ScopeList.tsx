import { Plus } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { KeyScopes, type KeyScope } from './key-scope'
import { ScopeRow } from './ScopeRow'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  scopes: KeyScope[]
  catalog: ScopeCatalog
  onChange: (scopes: KeyScope[]) => void
  /** Shown under the list. One line, per the admin's copy rule. */
  hint?: string
}

/** The project and environment pairs a grant targets. Add a row for each. */
export function ScopeList({ scopes, catalog, onChange, hint }: Props) {
  const replace = (index: number, scope: KeyScope) =>
    onChange(scopes.map((held, position) => (position === index ? scope : held)))

  const add = () => {
    const last = scopes[scopes.length - 1]
    onChange([
      ...scopes,
      { project: last?.project ?? catalog.projects[0] ?? KeyScopes.Any, env: KeyScopes.Any },
    ])
  }

  return (
    <div className={styles.scopeList}>
      {scopes.map((scope, index) => (
        <ScopeRow
          key={index}
          scope={scope}
          catalog={catalog}
          onChange={(next) => replace(index, next)}
          onRemove={
            scopes.length > 1
              ? () => onChange(scopes.filter((_, position) => position !== index))
              : undefined
          }
        />
      ))}

      <div className={styles.scopeListFoot}>
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus size={13} /> Add scope
        </Button>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
    </div>
  )
}
