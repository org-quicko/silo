import { Check, Lock } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../components/Button'
import { CopyButton } from '../../components/CopyButton'
import { ModalIcon } from '../../components/ModalIcon'
import type { CreatedKey } from '../../api/types/created-key'
import { ClaimGroups } from './claim-groups'
import styles from './NewKey.module.css'

/** The one and only time the secret exists outside the caller's hands (§8). */
export function NewKeySecret({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  return (
    <div className={`card ${styles.success}`}>
      <ModalIcon tone="ok" className={styles.successIcon}><Check size={20} /></ModalIcon>
      <h2>Copy this key now</h2>
      <p>silo stores only its SHA-256 hash. This secret cannot be shown again.</p>
      <div className={styles.secretBox}>
        <span className={styles.secret}>{created.key}</span>
        <CopyButton text={created.key} variant="accent" />
      </div>
      <div className={styles.summary}>
        <b>{created.label}</b>
        <span>{Claims.label(created.claims)}</span>
      </div>
      <div className={styles.groups}>
        {ClaimGroups.build(created.claims).map((group) => (
          <div className={`${styles.group} ${group.warn ? styles.groupWarn : ''}`} key={group.title}>
            <b>{group.title}</b>
            <span>{group.lines.join(' · ')}</span>
          </div>
        ))}
      </div>
      <div className={styles.successFooter}>
        <span className={styles.lockNote}><Lock size={13} /> Shown once</span>
        <Button variant="primary" onClick={onDone}>I’ve saved it</Button>
      </div>
    </div>
  )
}
