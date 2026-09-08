import type { ReactNode } from 'react'
import styles from './SettingsLedger.module.css'

/**
 * One setting: name and, only where it is earned, a line of why on the left;
 * the control flush right.
 *
 * `stack` drops the control under the label for the few that need the width —
 * a token list, a font grid.
 */
export function SettingsRow({
  label,
  help,
  htmlFor,
  stack,
  inline,
  children,
}: {
  label: ReactNode
  help?: ReactNode
  /** Set when the control is a single labelable input. */
  htmlFor?: string
  stack?: boolean
  /** Lays the control out as a row of buttons rather than a stacked field. */
  inline?: boolean
  children: ReactNode
}) {
  return (
    <div className={`${styles.row} ${stack ? styles.stack : ''}`}>
      <div className={styles.rowLabel}>
        {htmlFor ? (
          <label className={styles.label} htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className={styles.label}>{label}</span>
        )}
        {help && <p>{help}</p>}
      </div>
      <div className={`${styles.rowControl} ${inline ? styles.inline : ''}`}>{children}</div>
    </div>
  )
}
