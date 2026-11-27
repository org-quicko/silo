import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { ModalStack } from './modal-stack'
import styles from './Modal.module.css'

// Modal renders a hatched-backdrop overlay; Esc closes only the topmost modal.
export function Modal({
  onClose,
  children,
  size = 'md',
}: {
  onClose: () => void
  children: ReactNode
  size?: 'md' | 'lg' | 'xl'
}) {
  const modalId = useId()
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    ModalStack.push(modalId)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!ModalStack.isTop(modalId)) return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      ModalStack.remove(modalId)
      window.removeEventListener('keydown', onKey)
    }
  }, [modalId])

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`${styles.dialog} ${size === 'lg' ? styles.large : size === 'xl' ? styles.xlarge : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
