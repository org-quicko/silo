import { useState } from 'react'
import styles from './TagsWidget.module.css'

// TagsWidget: chip input for array<string> (design: tags field).
export function TagsWidget(props: any) {
  const { value, disabled, readonly, onChange } = props
  const tags: string[] = Array.isArray(value) ? value : []
  const [draft, setDraft] = useState('')
  const locked = disabled || readonly
  const commit = () => {
    const t = draft.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  return (
    <div className={styles.input}>
      {tags.map((t, i) => (
        <span key={i} className={styles.tag}>
          {t}
          {!locked && (
            <button type="button" className={styles.remove} onClick={() => onChange(tags.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </span>
      ))}
      {!locked && (
        <input
          className={styles.textInput}
          value={draft}
          placeholder="Add tag…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Backspace' && draft === '' && tags.length) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={commit}
        />
      )}
    </div>
  )
}
