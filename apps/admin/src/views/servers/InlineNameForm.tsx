import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import styles from './ServerManager.module.css'

interface Props {
  placeholder: string
  onSubmit: (name: string) => void
  onCancel: () => void
}

/** The one-field create form that appears at the top of a column. */
export function InlineNameForm({ placeholder, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <form onSubmit={submit} className={styles.inlineForm}>
      <input
        type="text"
        placeholder={placeholder}
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
      />
      <div className={styles.inlineActions}>
        <button type="submit" className={styles.inlineSubmit} title="Create">
          <Check size={13} />
        </button>
        <button type="button" className={styles.inlineCancel} onClick={onCancel} title="Cancel">
          ×
        </button>
      </div>
    </form>
  )
}
