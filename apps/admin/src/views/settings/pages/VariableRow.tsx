import { useEffect, useState } from 'react'
import { Check, Eraser, Trash2 } from 'lucide-react'
import { VariableTemplate } from '@silo/shared/variable-template'
import { Button } from '../../../components/buttons/Button'
import { Pill } from '../../../components/feedback/Pill'
import type { Variable } from '../../../api/types/variable'
import styles from './EnvVariablesPage.module.css'

/**
 * One declared name, and this environment's value for it (D57).
 *
 * The value box is a draft rather than a controlled mirror of the server's
 * value, so typing does not fight a background refresh; it is re-seeded when
 * the *server's* value changes, which is what makes switching environment show
 * the new one instead of stranding the last environment's text in the box.
 */
export function VariableRow({
  variable,
  env,
  environments,
  busy,
  canSetValue,
  canUndeclare,
  onSave,
  onClear,
  onDelete,
}: {
  variable: Variable
  env: string
  /** How many environments the project has, for the "set in 2 of 3" count. */
  environments: number
  busy: boolean
  canSetValue: boolean
  canUndeclare: boolean
  onSave: (value: string) => void
  onClear: () => void
  onDelete: () => void
}) {
  const stored = variable.value ?? ''
  const [draft, setDraft] = useState(stored)

  useEffect(() => setDraft(stored), [stored])

  const dirty = draft !== stored
  const unset = variable.value === null

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <div className={styles.nameLine}>
          <code className={styles.token}>{VariableTemplate.spell(variable.name)}</code>
          {unset ? (
            <Pill tone="warn">Unset here</Pill>
          ) : (
            <Pill tone="ok" dot>
              Set
            </Pill>
          )}
        </div>
        {variable.description && <span className={styles.description}>{variable.description}</span>}
        <span className={styles.note}>
          {/* Counted across the project, because the name is the project's. */}
          Set in {variable.setIn} of {environments}{' '}
          {environments === 1 ? 'environment' : 'environments'}
        </span>
      </div>

      <div className={styles.valueCell}>
        <div className={styles.valueRow}>
          <input
            className={`input ${styles.valueInput}`}
            type="text"
            value={draft}
            placeholder={unset ? 'No value in this environment' : ''}
            disabled={!canSetValue || busy}
            aria-label={`Value of ${variable.name} in ${env}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && dirty) onSave(draft)
            }}
          />
          {dirty && canSetValue && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onSave(draft)}>
              <Check size={13} /> Save
            </Button>
          )}
        </div>
        {unset && (
          <span className={styles.note}>
            Entries here return {VariableTemplate.spell(variable.name)} unchanged until this has a
            value.
          </span>
        )}
      </div>

      <div className={styles.actions}>
        {canSetValue && !unset && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            title={`Clear the value in ${env}. Other environments keep theirs.`}
            onClick={onClear}
          >
            <Eraser size={13} />
          </Button>
        )}
        {canUndeclare && (
          <Button
            variant="dangerGhost"
            size="sm"
            disabled={busy}
            title="Remove from every environment in this project"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </div>
  )
}
