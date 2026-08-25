import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Pill.module.css'

export function Pill({
  tone = 'muted',
  dot = false,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'
  dot?: boolean
  children: ReactNode
}) {
  const classes = [styles.pill, styles[tone], className || ''].filter(Boolean).join(' ')
  return (
    <span className={classes} {...props}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  )
}
