import type { JsonConcreteType } from './json-value'
import styles from './JsonTypeBadge.module.css'

export interface JsonTypeBadgeProps {
  type: JsonConcreteType
  disabled?: boolean
  onChange: (nextType: JsonConcreteType) => void
  ariaLabel?: string
}

const TYPE_OPTIONS: readonly { value: JsonConcreteType; label: string }[] = [
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'null', label: 'Null' },
]

/**
 * Compact color-coded JSON type pill that lets the user convert a node's type
 * or inspect it when locked.
 */
export function JsonTypeBadge({
  type,
  disabled = false,
  onChange,
  ariaLabel = 'Value type',
}: JsonTypeBadgeProps) {
  const toneClass = styles[type]

  if (disabled) {
    const label = TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
    return <span className={`${styles.badge} ${toneClass}`}>{label}</span>
  }

  return (
    <select
      className={`${styles.badge} ${styles.select} ${toneClass}`}
      aria-label={ariaLabel}
      value={type}
      onChange={(event) => onChange(event.target.value as JsonConcreteType)}
    >
      {TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
