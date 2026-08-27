import { Plus } from 'lucide-react'
import type { Collection } from '../../api/types/collection'
import { Button } from '../../components/buttons/Button'
import type { SchemaField } from '../../schema/schema-field'
import { FieldEditor } from './FieldEditor'
import { FieldRow } from './FieldRow'
import styles from './SchemaEditor.module.css'

interface Props {
  fields: SchemaField[]
  collections: Collection[]
  /** The index whose editor is open, or null. */
  expanded: number | null
  onExpand: (index: number | null) => void
  onChangeField: (index: number, patch: Partial<SchemaField>) => void
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
  onRemoveField,
  onAddField,
}: Props) {
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
            onToggle={() => onExpand(expanded === index ? null : index)}
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
