import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import styles from './CopyIconButton.module.css'

/**
 * Copies one value stated inline, where the labelled `CopyButton` would
 * outweigh the fact it sits beside. `label` names the value, not the act —
 * it is the button's only accessible name.
 */
export function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? <Check size={12} className={styles.copied} /> : <Copy size={12} />}
    </button>
  )
}
