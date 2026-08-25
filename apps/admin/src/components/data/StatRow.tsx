import type { ReactNode } from 'react'
import styles from './StatTile.module.css'

/** The row `StatTile`s sit in. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className={styles.stats}>{children}</div>
}
