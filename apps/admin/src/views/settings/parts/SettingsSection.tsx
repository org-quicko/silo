import type { ReactNode } from 'react'
import styles from './SettingsLedger.module.css'

/** A hairline-ruled block of settings rows. `hint` is the right-aligned fact
 *  about the section — a count, or where its values are written. Set
 *  `divider={false}` for the rare section that opens a page and needs no rule
 *  under its own title — every other section keeps the hairline. */
export function SettingsSection({
  title,
  hint,
  divider = true,
  children,
}: {
  title: string
  hint?: ReactNode
  divider?: boolean
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={`${styles.sectionHead} ${divider ? '' : styles.sectionHeadPlain}`}>
        <h2>{title}</h2>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      {children}
    </section>
  )
}
