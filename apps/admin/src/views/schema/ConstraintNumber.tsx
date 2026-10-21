import styles from './SchemaEditor.module.css'

interface Props {
  /** Shown as the placeholder rather than above the box, so a pair of these
   *  reads as one control instead of two labelled ones. */
  label: string
  value: string
  minimum?: number
  step: number | 'any'
  onChange: (value: string) => void
}

/** One optional number of a field's constraints, empty when it declares none. */
export function ConstraintNumber({ label, value, minimum, step, onChange }: Props) {
  return (
    <input
      className={`input ${styles.compactInput}`}
      type="number"
      aria-label={label}
      placeholder={label}
      value={value}
      min={minimum}
      step={step}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
