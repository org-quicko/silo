import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { ToastManager } from '../../../utils/toast-manager'
import styles from './SettingsLedger.module.css'

export interface Fact {
  key: string
  value: string
  /** Set for prose values — counts, dates — which are not machine truth and so
   *  are neither set in mono nor worth copying. */
  plain?: boolean
}

/**
 * Read-only values as definition rows: an id, a path, a driver name.
 *
 * These used to be rendered as disabled inputs, which promised an edit that
 * never came and offered no way to get the value out. A mono row that copies
 * itself on click is what they were always for.
 */
export function FactList({ facts }: { facts: Fact[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (fact: Fact) => {
    try {
      await navigator.clipboard.writeText(fact.value)
    } catch {
      /* a browser that refuses the clipboard still gets the toast below */
    }
    setCopied(fact.key)
    setTimeout(() => setCopied((held) => (held === fact.key ? null : held)), 1300)
    ToastManager.show('Copied to clipboard')
  }

  return (
    <div className={styles.facts}>
      {facts.map((fact) =>
        fact.plain ? (
          <div key={fact.key} className={styles.fact}>
            <span className={styles.factKey}>{fact.key}</span>
            <span className={`${styles.factValue} ${styles.plain}`}>{fact.value}</span>
            <span />
          </div>
        ) : (
          <button
            key={fact.key}
            type="button"
            className={`${styles.fact} ${styles.copyable}`}
            title={`Copy ${fact.key}`}
            onClick={() => copy(fact)}
          >
            <span className={styles.factKey}>{fact.key}</span>
            <span className={styles.factValue}>{fact.value}</span>
            <span className={`${styles.copyMark} ${copied === fact.key ? styles.copied : ''}`}>
              {copied === fact.key ? <Check size={14} /> : <Copy size={14} />}
            </span>
          </button>
        ),
      )}
    </div>
  )
}
