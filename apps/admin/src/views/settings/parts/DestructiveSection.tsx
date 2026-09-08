import type { ReactNode } from 'react'
import styles from './SettingsLedger.module.css'

/** The page's terminal section. One per page, always last, quiet until the
 *  confirmation it opens. */
export function DestructiveSection({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${styles.section} ${styles.destructive}`}>
      <div className={styles.sectionHead}>
        <h2>Destructive</h2>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      {children}
    </section>
  )
}
