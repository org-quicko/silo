import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { AccessLevel } from '@silo/shared/access-level'
import { CopyButton } from '../../components/buttons/CopyButton'
import { Pill } from '../../components/feedback/Pill'
import { ClaimGroups } from '../../claims/claim-groups'
import styles from './NewKey.module.css'

const ACCESS_TEXT: Record<AccessLevel, string> = {
  root: 'Full access',
  write: 'Read & write',
  read: 'Read-only',
  none: 'No access',
}

const ACCESS_TONE: Record<AccessLevel, 'accent' | 'ok' | 'muted'> = {
  root: 'accent',
  write: 'ok',
  read: 'ok',
  none: 'muted',
}

/**
 * What the key will be able to do, in sentences, with the exact claims one
 * disclosure away.
 *
 * The access pill uses the same four words as the top bar's session pill, so
 * the thing you mint here reads identically to the thing you see after
 * connecting with it.
 */
export function NewKeyReview({
  claims,
  scopeLabel,
  project,
  env,
  canDelegate,
}: {
  claims: string[]
  scopeLabel: string
  /** The scope the access pill is evaluated in — the key's own reach. */
  project?: string
  env?: string
  canDelegate: boolean
}) {
  const [rawOpen, setRawOpen] = useState(false)
  const level = Claims.accessLevel(claims, project, env)
  const groups = ClaimGroups.build(claims)

  return (
    <section className={`card ${styles.review}`}>
      <div className={styles.reviewHead}>
        <div>
          <b>This key will have</b>
          <span>{scopeLabel}</span>
        </div>
        <div className={styles.reviewPills}>
          <Pill tone={ACCESS_TONE[level]} dot>{ACCESS_TEXT[level]}</Pill>
          <Pill>{Claims.label(claims)}</Pill>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className={styles.reviewEmpty}>Nothing yet — pick what this key can do.</p>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <div className={`${styles.group} ${group.warn ? styles.groupWarn : ''}`} key={group.title}>
              <b>{group.title}</b>
              <span>{group.lines.join(' · ')}</span>
            </div>
          ))}
        </div>
      )}

      {!canDelegate && (
        <div className="banner banner-warn">
          <AlertTriangle size={14} />
          <span>The current key cannot delegate this complete claim set.</span>
        </div>
      )}

      <div className={styles.rawToggleRow}>
        <button type="button" className={styles.rawToggle} onClick={() => setRawOpen(!rawOpen)}>
          {rawOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {rawOpen ? 'Hide' : 'Show'} raw claims
        </button>
        {rawOpen && claims.length > 0 && <CopyButton text={claims.join('\n')} label="Copy claims" />}
      </div>
      {rawOpen && (
        <div className={styles.codeList}>
          {claims.map((claim) => <code key={claim}>{claim}</code>)}
        </div>
      )}
    </section>
  )
}
