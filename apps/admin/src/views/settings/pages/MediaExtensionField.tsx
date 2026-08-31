import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { MediaPolicyDraft } from './media-policy-draft'
import styles from './MediaStoragePage.module.css'

/**
 * The extension allowlist, as chips you add to and take from (D46).
 *
 * A list rather than a comma-separated text box because the value is a set and
 * the mistakes are per item: a stray space or a leading dot in one entry would
 * silently refuse that whole file type, and a chip makes each entry something
 * you can see and remove on its own.
 */
export function MediaExtensionField({
  value,
  disabled,
  defaults,
  onChange,
}: {
  value: string[]
  disabled: boolean
  defaults: string[]
  onChange: (next: string[]) => void
}) {
  const [typed, setTyped] = useState('')

  const commit = () => {
    if (!typed.trim()) return
    onChange(MediaPolicyDraft.add(value, typed))
    setTyped('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
      return
    }
    // Backspace on an empty box takes the last chip, which is what every other
    // chip input does and what a hand reaches for without thinking.
    if (event.key === 'Backspace' && !typed && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <>
      <div className={`${styles.chips} ${disabled ? styles.chipsDisabled : ''}`}>
        {value.map((extension) => (
          <span key={extension} className={styles.chip}>
            {extension}
            <button
              type="button"
              aria-label={`Remove ${extension}`}
              disabled={disabled}
              onClick={() => onChange(MediaPolicyDraft.remove(value, extension))}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className={styles.chipInput}
          value={typed}
          disabled={disabled}
          placeholder={value.length === 0 ? 'jpg, png, pdf' : 'Add one'}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>

      <div className={styles.fieldFoot}>
        <span className={styles.help}>
          {MediaPolicyDraft.acceptsEverything(value)
            ? 'Accepting every file type.'
            : 'Uploads with any other extension are refused.'}
        </span>
        <span className={styles.fieldActions}>
          <button
            type="button"
            className={styles.inlineAction}
            disabled={disabled}
            onClick={() => onChange(defaults)}
          >
            Reset
          </button>
          <button
            type="button"
            className={styles.inlineAction}
            disabled={disabled}
            onClick={() => onChange([MediaPolicyDraft.Any])}
          >
            Accept all
          </button>
        </span>
      </div>
    </>
  )
}
