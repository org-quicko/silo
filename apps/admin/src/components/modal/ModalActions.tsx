import type { HTMLAttributes } from 'react'
import styles from './Modal.module.css'

export function ModalActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.actions, className].filter(Boolean).join(' ')} {...props} />
}
