import styles from './SchemaEditor.module.css'

interface Props {
  /** Shown as the placeholder rather than above the box, so a pair of these
   *  reads as one control instead of two labelled ones. */
  label: string
  value: string
  minimum?: number
  step: number | 'any'
  /** Entries exist, so the keyword this writes is read-only (D70). */
  locked: boolean
  onChange: (value: string) => void
}

/** One optional number of a field's constraints, empty when it declares none. */
export function ConstraintNumber({ label, value, minimum, step, locked, onChange }: Props) {
  return (
    <input
      className={`input ${styles.compactInput}`}
      type="number"
      aria-label={label}
      placeholder={label}
      value={value}
      min={minimum}
      step={step}
      readOnly={locked}
      disabled={locked}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
