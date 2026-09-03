import { GripVertical, Settings } from 'lucide-react'
import type { SchemaField } from '../../schema/schema-field'
import { SchemaFieldSummary } from '../../schema/schema-field-summary'
import styles from './SchemaEditor.module.css'

interface Props {
  field: SchemaField
  expanded: boolean
  /** This row is the one being dragged, so it fades out of the list under it. */
  dragging: boolean
  onToggle: () => void
  onDragStart: () => void
  onDragEnd: () => void
  /** The dragged row passed over this one: the list reorders there and then. */
  onDragOverRow: () => void
}

/** One collapsed row of the visual builder: what the field is, at a glance. */
export function FieldRow({ field, expanded, dragging, onToggle, onDragStart, onDragEnd, onDragOverRow }: Props) {
  // One line, whatever the field holds: a seventeen-value enum otherwise wrapped
  // the row to ten lines, and a single unbreakable value ran under the badges.
  const summary = SchemaFieldSummary.describe(field)
  return (
    // The whole row is the control: a 44px gear was the only way into a field's
    // settings, on a row whose every other pixel looked just as clickable.
    <div
      className={`${styles.fieldRow} ${expanded ? styles.selected : ''} ${dragging ? styles.dragging : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(event) => {
        // Without this the drop is refused and the row snaps back.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOverRow()
      }}
      onDrop={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onToggle()
      }}
    >
      <span className={styles.grip}>
        <GripVertical size={15} />
      </span>
      <div className={styles.fieldSummary}>
        <span className={styles.fieldName}>
          {field.name || <span className="muted">unnamed</span>}
        </span>
        <span className={styles.fieldDescription} title={summary}>
          {summary}
        </span>
      </div>
      <span className={styles.type}>{SchemaFieldSummary.typeLabel(field)}</span>
      <span
        className={`${styles.requirement} ${field.required ? styles.required : styles.optional}`}
      >
        {field.required ? 'required' : 'optional'}
      </span>
      {/* The row carries the click now, so this is the affordance and not a
          second tab stop inside it. */}
      <span className={styles.gear} aria-hidden="true">
        <Settings size={15} />
      </span>
    </div>
  )
}
