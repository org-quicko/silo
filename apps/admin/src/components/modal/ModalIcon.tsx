import type { HTMLAttributes } from 'react'
import styles from './Modal.module.css'

export function ModalIcon({ tone, className, ...props }: HTMLAttributes<HTMLDivElement> & { tone: 'bad' | 'ok' | 'accent' }) {
  return <div className={[styles.icon, styles[tone], className].filter(Boolean).join(' ')} {...props} />
}
