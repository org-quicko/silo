import { RefreshCw, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import type { RescanReport } from '../../api/types/rescan-report'
import styles from './Plugins.module.css'

/** The four outcomes worth naming, in the order an operator reads them. */
const SECTIONS: { key: keyof RescanReport; label: string }[] = [
  { key: 'started', label: 'started' },
  { key: 'restarted', label: 'restarted' },
  { key: 'stopped', label: 'stopped' },
  { key: 'unchanged', label: 'left alone' },
  { key: 'skipped', label: 'skipped' },
]

/**
 * What a rescan did.
 *
 * "Left alone" is reported rather than omitted because it is a decision: a
 * rescan deliberately does not restart a plugin nothing changed, which is the
 * difference between it and a naive reload that discards every in-flight
 * dispatch on the instance.
 */
export function RescanResult({ report, onDismiss }: { report: RescanReport; onDismiss: () => void }) {
  const lines = SECTIONS.map(({ key, label }) => {
    const names = report[key] as string[]
    return names.length === 0 ? null : `${label}: ${names.join(', ')}`
  }).filter(Boolean) as string[]

  const tone = report.failed.length > 0 ? 'banner-bad' : 'banner-ok'

  return (
    <div className={`banner ${tone} ${styles.rescanBanner}`}>
      <RefreshCw size={14} />
      <div className={styles.rescanBody}>
        <b>silo.toml re-read.</b>
        <span>{lines.length > 0 ? lines.join(' · ') : 'Nothing changed.'}</span>
        {report.failed.map((failure) => (
          <span key={failure.name} className={styles.rescanFailure}>
            {failure.name} did not load: {failure.error}
          </span>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={onDismiss} title="Dismiss">
        <X size={13} />
      </Button>
    </div>
  )
}
