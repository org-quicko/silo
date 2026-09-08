import type { ReactNode } from 'react'
import styles from './SettingsLedger.module.css'

/** One destructive action. `blast` says what it actually reaches — the thing a
 *  red card around it never managed to say. */
export function DestructiveRow({
  title,
  blast,
  children,
}: {
  title: string
  blast: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.destructiveRow}>
      <div>
        <b>{title}</b>
        <p>{blast}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}
