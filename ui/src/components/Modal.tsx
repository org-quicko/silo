import { useEffect } from 'react'
import type { ReactNode } from 'react'
import styles from './Modal.module.css'

// Modal renders a hatched-backdrop overlay; Esc and backdrop click close it.
export function Modal({
  onClose,
  children,
  size = 'md',
}: {
  onClose: () => void
  children: ReactNode
  size?: 'md' | 'lg'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={`${styles.dialog} ${size === 'lg' ? styles.large : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
