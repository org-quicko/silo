import type { ReactNode } from 'react'
import styles from './ScopeBrowser.module.css'

/**
 * The row of panes a column browser is made of.
 *
 * A component rather than a class the caller spells itself, so the container
 * and the columns inside it stay in one module: `ServerManager` used to hold
 * the container's class and the columns held theirs, which is two files that
 * have to agree about one layout.
 */
export function BrowserColumns({ children }: { children: ReactNode }) {
  return <div className={styles.columnsContainer}>{children}</div>
}
