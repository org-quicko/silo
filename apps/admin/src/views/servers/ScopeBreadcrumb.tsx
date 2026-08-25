import styles from './ServerManager.module.css'

interface Props {
  server: string | null
  project: string | null
  env: string | null
}

/** The footer trail, showing how far the three columns have been walked. */
export function ScopeBreadcrumb({ server, project, env }: Props) {
  const steps: Array<[string | null, string]> = [
    [server, 'Select server'],
    [project, 'Select project'],
    [env, 'Select environment'],
  ]

  return (
    <div className={styles.breadcrumb}>
      {steps.map(([value, placeholder], index) => (
        <span key={placeholder} style={{ display: 'contents' }}>
          {index > 0 && <span className={styles.breadcrumbSep}>›</span>}
          <span
            className={`${styles.breadcrumbItem} ${value ? styles.breadcrumbItemActive : ''}`}
          >
            {value || placeholder}
          </span>
        </span>
      ))}
    </div>
  )
}
