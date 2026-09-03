import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import type { SchemaField } from '../../schema/schema-field'
import { FieldEditor } from './FieldEditor'
import { FieldRow } from './FieldRow'
import styles from './SchemaEditor.module.css'

interface Props {
  fields: SchemaField[]
  /** Ref targets: names only — choosing one writes a `silo://` URL, and
   *  nothing here reads the target's schema. */
  collections: readonly { name: string }[]
  /** The index whose editor is open, or null. */
  expanded: number | null
  onExpand: (index: number | null) => void
  onChangeField: (index: number, patch: Partial<SchemaField>) => void
  onMoveField: (from: number, to: number) => void
  onRemoveField: (index: number) => void
  onAddField: () => void
}

/** The visual builder: one row per property, with an editor under the open one. */
export function FieldList({
  fields,
  collections,
  expanded,
  onExpand,
  onChangeField,
  onMoveField,
  onRemoveField,
  onAddField,
}: Props) {
  // The row being dragged, by index. It follows its own field as the list
  // reorders under the pointer, so passing over a row is the drop.
  const [dragging, setDragging] = useState<number | null>(null)

  return (
    <div className={styles.builder}>
      {fields.length === 0 && (
        <div className={styles.emptyFields}>No fields yet — add one below.</div>
      )}

      {fields.map((field, index) => (
        <div key={index}>
          <FieldRow
            field={field}
            expanded={expanded === index}
            dragging={dragging === index}
            onToggle={() => onExpand(expanded === index ? null : index)}
            onDragStart={() => setDragging(index)}
            onDragEnd={() => setDragging(null)}
            onDragOverRow={() => {
              if (dragging === null || dragging === index) return
              onMoveField(dragging, index)
              setDragging(index)
            }}
          />
          {expanded === index && (
            <FieldEditor
              field={field}
              collections={collections}
              onChange={(patch) => onChangeField(index, patch)}
              onRemove={() => onRemoveField(index)}
            />
          )}
        </div>
      ))}

      <Button variant="dashed" onClick={onAddField}>
        <Plus size={15} /> Add field
      </Button>
    </div>
  )
}
