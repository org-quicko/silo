import type { ReactNode } from 'react'
import { AlertTriangle, Info, RotateCw } from 'lucide-react'
import styles from './SettingsLedger.module.css'

const icons = { warn: AlertTriangle, bad: AlertTriangle, info: Info, restart: RotateCw }

/**
 * A condition that holds for the whole page — the config file is read-only,
 * auth is switched off, saved values are waiting for a restart.
 *
 * It sits under the page head rather than beside a control, because it is the
 * reason a control behaves as it does and not a fact about that one field.
 */
export function SettingsAlert({
  tone = 'warn',
  title,
  children,
}: {
  tone?: 'warn' | 'bad' | 'info' | 'restart'
  title?: string
  children: ReactNode
}) {
  const Icon = icons[tone]
  const shade = tone === 'bad' ? styles.alertBad : tone === 'warn' ? '' : styles.alertInfo

  return (
    <div className={`${styles.alert} ${shade}`}>
      <Icon size={15} />
      <div>
        {title && <b>{title}</b>}
        <p>{children}</p>
      </div>
    </div>
  )
}
