import styles from './Toggle.module.css'

export function Toggle({
  on,
  onChange,
  size = 'md',
  title,
  disabled = false,
}: {
  on: boolean
  onChange: (v: boolean) => void
  size?: 'md' | 'sm'
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      data-size={size}
      role="switch"
      aria-checked={on}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className={styles.knob} />
    </button>
  )
}
