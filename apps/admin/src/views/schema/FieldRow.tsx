import { GripVertical, Settings } from 'lucide-react'
import type { SchemaField } from '../../schema/schema-field'
import { SchemaFieldSummary } from '../../schema/schema-field-summary'
import styles from './SchemaEditor.module.css'

interface Props {
  field: SchemaField
  expanded: boolean
  onToggle: () => void
}

/** One collapsed row of the visual builder: what the field is, at a glance. */
export function FieldRow({ field, expanded, onToggle }: Props) {
  return (
    <div className={`${styles.fieldRow} ${expanded ? styles.selected : ''}`}>
      <span className={styles.grip}>
        <GripVertical size={15} />
      </span>
      <div className={styles.fieldSummary}>
        <span className={styles.fieldName}>
          {field.name || <span className="muted">unnamed</span>}
        </span>
        <span className={styles.fieldDescription}>{SchemaFieldSummary.describe(field)}</span>
      </div>
      <span className={styles.type}>{SchemaFieldSummary.typeLabel(field)}</span>
      <span
        className={`${styles.requirement} ${field.required ? styles.required : styles.optional}`}
      >
        {field.required ? 'required' : 'optional'}
      </span>
      <button className={styles.gear} onClick={onToggle}>
        <Settings size={15} />
      </button>
    </div>
  )
}
