import { StatusPill } from '../../components/StatusPill'

import styles from './CellValue.module.css'

export function CellValue({ schema, name, value }: { schema: any; name: string; value: any }) {
  const prop = schema?.properties?.[name]
  if (value == null || value === '') return <span className="muted">—</span>
  if (prop?.enum && typeof value === 'string') return <StatusPill value={value} />
  if (Array.isArray(value)) {
    const shown = value.slice(0, 2)
    return (
      <span className={styles.tags}>
        {shown.map((v, i) => (
          <span key={i} className={styles.chip}>
            {String(v)}
          </span>
        ))}
        {value.length > 2 && <span className={styles.more}>+{value.length - 2}</span>}
      </span>
    )
  }
  if (typeof value === 'boolean') return <span className={styles.boolean}>{value ? 'true' : 'false'}</span>
  if (typeof value === 'object') return <span className={styles.object}>{'{…}'}</span>
  return <span className={styles.text}>{String(value)}</span>
}
