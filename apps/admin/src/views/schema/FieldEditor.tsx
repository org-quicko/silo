import { Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Toggle } from '../../components/controls/Toggle'
import type { SchemaField } from '../../schema/schema-field'
import { EnumValues } from './EnumValues'
import { FieldKindSelect } from './FieldKindSelect'
import { RefTarget } from './RefTarget'
import styles from './SchemaEditor.module.css'

interface Props {
  field: SchemaField
  /** Ref targets: names only — choosing one writes a `silo://` URL, and
   *  nothing here reads the target's schema. */
  collections: readonly { name: string }[]
  onChange: (patch: Partial<SchemaField>) => void
  onRemove: () => void
}

/** The expanded panel under a field row: everything about one property. */
export function FieldEditor({ field, collections, onChange, onRemove }: Props) {
  const isReference = field.kind === 'ref' || field.kind === 'ref-array'

  return (
    <div className={styles.fieldEditor}>
      <div className={styles.fieldEditorRow}>
        <div className={styles.fieldEditorColumn}>
          <span className={styles.fieldEditorLabel}>Field name</span>
          <input
            className={`input mono ${styles.compactInput}`}
            value={field.name}
            onChange={(event) =>
              onChange({ name: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })
            }
          />
        </div>
        <div className={styles.fieldEditorColumn}>
          <span className={styles.fieldEditorLabel}>Type</span>
          <FieldKindSelect
            kind={field.kind}
            construct={field.construct}
            onChange={(kind) => onChange({ kind })}
          />
        </div>
      </div>

      {field.kind === 'enum' && (
        <div className={styles.fieldEditorColumn}>
          <span className={styles.fieldEditorLabel}>Allowed values</span>
          <EnumValues
            values={field.enumValues}
            onChange={(enumValues) => onChange({ enumValues })}
          />
        </div>
      )}

      {isReference && (
        <RefTarget
          target={field.refTarget}
          collections={collections}
          isArray={field.kind === 'ref-array'}
          onChange={(refTarget) => onChange({ refTarget })}
        />
      )}

      <div className={styles.fieldEditorColumn}>
        <span className={styles.fieldEditorLabel}>Description</span>
        <input
          className={`input ${styles.compactInput}`}
          placeholder="Optional help text"
          value={field.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>

      <div className={styles.toggleRow}>
        <span>Required field</span>
        <Toggle size="sm" on={field.required} onChange={(required) => onChange({ required })} />
      </div>

      <Button
        className={styles.removeField}
        variant="dangerGhost"
        size="sm"
        onClick={onRemove}
      >
        <Trash2 size={13} /> Remove field
      </Button>
    </div>
  )
}
