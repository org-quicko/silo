import styles from './StatTile.module.css'

/**
 * One number from an import/copy result — created, updated, deleted,
 * unchanged. Shared because export/import, direct server copy, and env→env
 * copy all report the same four counts, and they were three identical local
 * copies of this before.
 */
export function StatTile({
  n,
  label,
  tone,
  prefix,
}: {
  n: number
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  prefix?: string
}) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statNumber} ${styles[tone]}`}>
        {prefix || ''}
        {n}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}
