import { StatusPill } from '../../components/StatusPill'
import { ValueTitle } from '../../utils/value-title'

import styles from './CellValue.module.css'

// summary names a value the cell can't show the inside of. String(value) on an
// object renders "[object Object]", which a reference list turned into a row of
// them, so objects are labelled by their first filled field — the same rule the
// entry form's collapsed array items use.
function summary(schema: any, value: any): string {
  return ValueTitle.of(schema, undefined, value) ?? '{…}'
}

export function CellValue({ schema, name, value }: { schema: any; name: string; value: any }) {
  const prop = schema?.properties?.[name]
  if (value == null || value === '') return <span className="muted">—</span>
  if (prop?.enum && typeof value === 'string') return <StatusPill value={value} />
  if (Array.isArray(value)) {
    const shown = value.slice(0, 2)
    return (
      <span className={styles.tags}>
        {shown.map((v, i) => (
          <span key={i} className={styles.chip} title={summary(prop?.items, v)}>
            {summary(prop?.items, v)}
          </span>
        ))}
        {value.length > 2 && <span className={styles.more}>+{value.length - 2}</span>}
      </span>
    )
  }
  if (typeof value === 'boolean') return <span className={styles.boolean}>{value ? 'true' : 'false'}</span>
  if (typeof value === 'object') {
    const label = ValueTitle.of(prop, undefined, value)
    return label ? <span className={styles.text} title={label}>{label}</span> : <span className={styles.object}>{'{…}'}</span>
  }
  return <span className={styles.text}>{String(value)}</span>
}
