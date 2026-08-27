import type { HTMLAttributes } from 'react'
import styles from './Modal.module.css'

export function ModalHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.header, className].filter(Boolean).join(' ')} {...props} />
}
