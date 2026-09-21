import { ConstraintNumber } from './ConstraintNumber'
import styles from './SchemaEditor.module.css'

interface Props {
  label: string
  minimum: string
  maximum: string
  /** The smallest value the control offers — `0` for a count, which cannot be
   *  negative. Absent leaves the range open, which is what a number field is. */
  minimumAllowed?: number
  step: number | 'any'
  /** Entries exist, so both keywords are read-only (D70). */
  locked: boolean
  onMinimum: (value: string) => void
  onMaximum: (value: string) => void
}

/** A lower and an upper limit under one label: two halves of one decision, and
 *  either alone is a complete answer. */
export function ConstraintBounds({
  label,
  minimum,
  maximum,
  minimumAllowed,
  step,
  locked,
  onMinimum,
  onMaximum,
}: Props) {
  return (
    <div className={styles.fieldEditorColumn}>
      <span className={styles.fieldEditorLabel}>{label}</span>
      <div className={styles.bounds}>
        <ConstraintNumber
          label="Min"
          value={minimum}
          minimum={minimumAllowed}
          step={step}
          locked={locked}
          onChange={onMinimum}
        />
        <ConstraintNumber
          label="Max"
          value={maximum}
          minimum={minimumAllowed}
          step={step}
          locked={locked}
          onChange={onMaximum}
        />
      </div>
    </div>
  )
}
