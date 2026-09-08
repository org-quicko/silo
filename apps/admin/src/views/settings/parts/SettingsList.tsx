import type { ReactNode } from 'react'
import styles from './SettingsLedger.module.css'

/** A hairline-separated index of things — projects, environments — or, when it
 *  holds none, the one line saying so. */
export function SettingsList({ empty, children }: { empty?: ReactNode; children: ReactNode }) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children
  if (isEmpty && empty) return <div className={styles.empty}>{empty}</div>
  return <div className={styles.list}>{children}</div>
}
