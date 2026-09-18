import { useState } from 'react'
import styles from './SchemaEditor.module.css'

export function EnumValues({
  values,
  disabled,
  onChange,
}: {
  values: string[]
  /** Entries exist: a member added or removed changes what validates. */
  disabled?: boolean
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const t = draft.trim()
    if (t && !values.includes(t)) onChange([...values, t])
    setDraft('')
  }
  return (
    <div className={styles.values}>
      {values.map((v, i) => (
        <span key={i} className={styles.value}>
          {v}
          {!disabled && (
            <button className={styles.removeValue} onClick={() => onChange(values.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          className={styles.valueInput}
          value={draft}
          placeholder="+ add"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={commit}
        />
      )}
    </div>
  )
}
