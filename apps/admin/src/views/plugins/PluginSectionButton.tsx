import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Pill } from '../../components/feedback/Pill'
import styles from './PluginDetail.module.css'

/**
 * One of the plugin page's sections, closed.
 *
 * The sections themselves — the grant, the routes, the config, the trail — are
 * long, and four of them stacked open turned this page into something an
 * operator scrolled rather than read. Each is now a sheet, and this is what is
 * left on the page in its place.
 *
 * **The status stays out here.** That is the whole design constraint: D40's
 * property is that the page answers *is anything waiting on me* without being
 * opened, so a button that said only "Permissions" would have hidden the one
 * thing that was never meant to be a click away. The pill carries the answer
 * and the sheet carries the controls.
 */
export function PluginSectionButton({
  icon,
  title,
  summary,
  status,
  tone = 'muted',
  onOpen,
}: {
  icon: ReactNode
  title: string
  summary: ReactNode
  /** The section's state in a few words. Absent only where a section has no
   *  state worth reporting closed. */
  status?: ReactNode
  tone?: 'ok' | 'warn' | 'muted'
  onOpen: () => void
}) {
  return (
    <button type="button" className={styles.sectionButton} onClick={onOpen}>
      <span className={styles.sectionIcon}>{icon}</span>
      <span className={styles.sectionCopy}>
        <span className={styles.sectionTop}>
          <b>{title}</b>
          {status && <Pill tone={tone}>{status}</Pill>}
        </span>
        <span className={styles.sectionSummary}>{summary}</span>
      </span>
      <ChevronRight size={15} className={styles.sectionChevron} />
    </button>
  )
}
