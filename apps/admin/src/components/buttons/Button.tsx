import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerGhost' | 'dashed'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
}) {
  const classes = [
    styles.button,
    styles[variant],
    size === 'sm' ? styles.small : '',
    className || '',
  ].filter(Boolean).join(' ')

  return <button className={classes} {...props} />
}
