import type { HTMLAttributes } from 'react'
import styles from './Modal.module.css'

export function ModalCopy({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.copy, className].filter(Boolean).join(' ')} {...props} />
}
