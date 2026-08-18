import type { HTMLAttributes } from 'react'
import styles from './Modal.module.css'

export function ModalBody({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={[styles.body, className].filter(Boolean).join(' ')} {...props} />
}
