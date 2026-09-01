import type { SchemaFieldKind } from '../../schema/schema-field'
import styles from './SchemaEditor.module.css'

const OPTIONS: Array<{ value: SchemaFieldKind; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'Array' },
  { value: 'object', label: 'Object' },
  { value: 'enum', label: 'Enum' },
  { value: 'ref', label: 'Reference' },
  { value: 'ref-array', label: 'Reference list' },
  { value: 'media', label: 'Media' },
  { value: 'any', label: 'Any' },
]

interface Props {
  kind: SchemaFieldKind
  /** Set when the property carries an advanced construct the builder cannot
   *  draw; the type is then shown, not chosen. */
  construct?: string
  onChange: (kind: SchemaFieldKind) => void
}

export function FieldKindSelect({ kind, construct, onChange }: Props) {
  if (construct) {
    return (
      <div className={`input ${styles.compactInput} ${styles.constructInput}`}>
        <span className="mono">{construct}</span>
      </div>
    )
  }

  return (
    <select
      className={`input ${styles.compactInput}`}
      value={kind}
      onChange={(event) => onChange(event.target.value as SchemaFieldKind)}
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
