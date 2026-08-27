import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import styles from './Sheet.module.css'

/**
 * A panel that slides in from the right, over the page rather than instead of
 * it.
 *
 * `Modal` is the other overlay in this app and they answer different questions.
 * A modal asks something — it is small, it is centred, and it ends in a decision
 * with two buttons. A sheet *holds a section of the page you were already on*:
 * a claim list, a route table, a config form, an audit trail. Those are tall,
 * they scroll, and they have no single answer, which is why they get their own
 * container instead of a `Modal` grown until it fits.
 *
 * The body scrolls, not the page behind it. A section that needed the whole
 * viewport to be readable was the reason these moved off the page in the first
 * place, and a sheet whose content pushed the backdrop taller would have
 * reproduced it.
 */
export function Sheet({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  width = 'md',
}: {
  title: ReactNode
  /** One line under the title, in the same place on every sheet, so the reason
   *  a section exists is not the first thing scrolled past. */
  subtitle?: ReactNode
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Pinned below the scroll area. Where a sheet's decision goes, so it stays
   *  reachable from the top of a list as well as the bottom. */
  footer?: ReactNode
  width?: 'md' | 'lg'
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <aside
        className={`${styles.sheet} ${width === 'lg' ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.heading}>
            {icon && <span className={styles.icon}>{icon}</span>}
            <div className={styles.copy}>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.foot}>{footer}</div>}
      </aside>
    </div>
  )
}
