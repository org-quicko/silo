import styles from './Spinner.module.css'

export type SpinnerSize = 'sm' | 'md' | 'lg'

/**
 * The app's circular progress mark. Decoration only — whatever is waiting says
 * so in words beside it, so this is hidden from assistive technology.
 */
export function Spinner({ size = 'md', className }: { size?: SpinnerSize; className?: string }) {
  return (
    <span className={`${styles.spinner} ${styles[size]} ${className || ''}`} aria-hidden="true" />
  )
}
