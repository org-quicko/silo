import { Toggle } from '../../components/controls/Toggle'
import { SchemaConstraints } from '../../schema/schema-constraints'
import type { SchemaField, SchemaFieldConstraints } from '../../schema/schema-field'
import { ConstraintBounds } from './ConstraintBounds'
import { ConstraintNumber } from './ConstraintNumber'
import styles from './SchemaEditor.module.css'

interface Props {
  field: SchemaField
  /** Entries exist, so every keyword here is read-only: each one decides
   *  whether an entry already stored is still valid (D69). */
  locked: boolean
  onChange: (constraints: SchemaFieldConstraints) => void
}

/** What a field accepts beyond its type, drawn for the kind that carries it. */
export function FieldConstraints({ field, locked, onChange }: Props) {
  const group = SchemaConstraints.groupFor(field.kind)
  // An advanced construct is edited in Code view whole. Its kind is this
  // builder's reading of a subtree it never writes back, so controls here would
  // offer edits that a save drops.
  if (!group || field.construct) return null

  const constraints = field.constraints
  const set = (patch: Partial<SchemaFieldConstraints>) => onChange({ ...constraints, ...patch })

  if (group === 'range') {
    return (
      <>
        <ConstraintBounds
          label="Range"
          minimum={constraints.minimum}
          maximum={constraints.maximum}
          step={field.kind === 'integer' ? 1 : 'any'}
          locked={locked}
          onMinimum={(minimum) => set({ minimum })}
          onMaximum={(maximum) => set({ maximum })}
        />
        <div className={styles.fieldEditorColumn}>
          <span className={styles.fieldEditorLabel}>Step</span>
          <ConstraintNumber
            label="Any"
            value={constraints.multipleOf}
            step="any"
            locked={locked}
            onChange={(multipleOf) => set({ multipleOf })}
          />
          <span className={styles.hint}>Values must be a multiple of this.</span>
        </div>
      </>
    )
  }

  if (group === 'items') {
    return (
      <>
        <ConstraintBounds
          label="Items"
          minimum={constraints.minItems}
          maximum={constraints.maxItems}
          minimumAllowed={0}
          step={1}
          locked={locked}
          onMinimum={(minItems) => set({ minItems })}
          onMaximum={(maxItems) => set({ maxItems })}
        />
        <div className={styles.toggleRow}>
          <span>No duplicate items</span>
          <Toggle
            size="sm"
            on={constraints.uniqueItems}
            disabled={locked}
            onChange={(uniqueItems) => set({ uniqueItems })}
          />
        </div>
      </>
    )
  }

  const badPattern = constraints.pattern !== '' && !isRegularExpression(constraints.pattern)

  return (
    <>
      <div className={styles.fieldEditorColumn}>
        <span className={styles.fieldEditorLabel}>Format</span>
        <select
          className={`input ${styles.compactInput}`}
          value={constraints.format}
          disabled={locked}
          onChange={(event) => set({ format: event.target.value })}
        >
          <option value="">No format</option>
          {SchemaConstraints.Formats.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
        <span className={styles.hint}>A format checks the value and picks the entry form's control.</span>
      </div>

      <ConstraintBounds
        label="Length"
        minimum={constraints.minLength}
        maximum={constraints.maxLength}
        minimumAllowed={0}
        step={1}
        locked={locked}
        onMinimum={(minLength) => set({ minLength })}
        onMaximum={(maxLength) => set({ maxLength })}
      />

      <div className={styles.fieldEditorColumn}>
        <span className={styles.fieldEditorLabel}>Pattern</span>
        <input
          className={`input mono ${styles.compactInput}`}
          placeholder="^[a-z0-9-]+$"
          value={constraints.pattern}
          readOnly={locked}
          disabled={locked}
          onChange={(event) => set({ pattern: event.target.value })}
        />
        <span className={`${styles.hint} ${badPattern ? styles.badHint : ''}`}>
          {badPattern
            ? 'Not a valid regular expression.'
            : 'A regular expression the value must match somewhere.'}
        </span>
      </div>
    </>
  )
}

/** Whether the server can compile this as a `pattern` — said here rather than
 *  arriving as a 400 that names the whole document. */
function isRegularExpression(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}
