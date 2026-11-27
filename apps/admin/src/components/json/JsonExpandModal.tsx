import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '../buttons/Button'
import { Modal } from '../modal/Modal'
import styles from './JsonExpandModal.module.css'

export interface JsonExpandModalProps {
  title: string
  subtitle?: string
  headerControls?: ReactNode
  toolbar?: ReactNode
  footer?: ReactNode
  onClose: () => void
  children: ReactNode
}

/**
 * Full-width `xl` modal shell for editing large JSON values, entries, or
 * collection schemas without losing inline edits.
 */
export function JsonExpandModal({
  title,
  subtitle,
  headerControls,
  toolbar,
  footer,
  onClose,
  children,
}: JsonExpandModalProps) {
  return (
    <Modal size="xl" onClose={onClose}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.title}>{title}</h3>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
        <div className={styles.controls}>
          {headerControls}
          {toolbar}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            <X size={13} /> Done
          </Button>
        </div>
      </div>

      <div className={styles.body}>{children}</div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </Modal>
  )
}
