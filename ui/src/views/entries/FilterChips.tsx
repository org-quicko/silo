import { X } from 'lucide-react'
import { FilterModel, type FilterDraft, type FilterRow } from '../../query/filter-model'
import { FilterFields } from './filter-fields'
import styles from './FilterChips.module.css'

/** How a completed row reads as a sentence fragment: `field · op · value`. */
function describe(row: FilterRow, label: string, opLabel: string): { field: string; op: string; value: string | null } {
  if (row.op === 'exists') return { field: label, op: opLabel, value: null }
  if (row.op === 'between') {
    const [from, to] = row.value.split(',').map((p) => p.trim())
    return { field: label, op: opLabel, value: `${from} – ${to}` }
  }
  return { field: label, op: opLabel, value: row.value }
}

/**
 * Active filters as removable chips (handoff 1d), replacing the old count
 * badge on the Filter button. Each chip is a condition read as a sentence —
 * `title · is · "Guide"` — so the toolbar states what is filtering the table
 * rather than just how many things are.
 */
export function FilterChips({
  schema,
  draft,
  onEditRow,
  onRemoveRow,
  onAddFilter,
  onClearAll,
}: {
  schema: any
  draft: FilterDraft
  onEditRow: (index: number) => void
  onRemoveRow: (index: number) => void
  onAddFilter: () => void
  onClearAll: () => void
}) {
  const fields = FilterFields.of(schema)
  const rows = draft.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => FilterModel.isComplete(row))

  if (rows.length === 0) {
    return (
      <button className={styles.addChip} onClick={onAddFilter}>
        + Add filter
      </button>
    )
  }

  return (
    <div className={styles.chips}>
      {rows.map(({ row, index }) => {
        const field = fields.find((f) => f.path === row.path)
        const opts = field ? FilterFields.ops(field) : []
        const opLabel = opts.find((o) => o.op === row.op)?.label ?? row.op
        const { field: fieldLabel, op, value } = describe(row, field?.label ?? row.path, opLabel)
        return (
          <span key={index} className={styles.chip}>
            <button className={styles.chipBody} onClick={() => onEditRow(index)}>
              <span className={styles.chipField}>{fieldLabel}</span>
              <span className={styles.chipOp}>{op}</span>
              {value !== null && <span className={styles.chipValue}>{value}</span>}
            </button>
            <button className={styles.chipRemove} onClick={() => onRemoveRow(index)} aria-label={`Remove ${fieldLabel} filter`}>
              <X size={11} />
            </button>
          </span>
        )
      })}
      <button className={styles.addChip} onClick={onAddFilter}>
        + Add filter
      </button>
      <button className={styles.clearAll} onClick={onClearAll}>
        Clear all
      </button>
    </div>
  )
}
