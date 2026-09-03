import { AlertTriangle, Pencil } from 'lucide-react'
import type { RenameResult } from '../../../api/types/scope-record'
import { Button } from '../../../components/buttons/Button'
import { Modal } from '../../../components/modal/Modal'
import { ModalActions } from '../../../components/modal/ModalActions'
import { ModalBody } from '../../../components/modal/ModalBody'
import { ModalCopy } from '../../../components/modal/ModalCopy'
import { ModalHeader } from '../../../components/modal/ModalHeader'
import { ModalIcon } from '../../../components/modal/ModalIcon'
import styles from './Rename.module.css'

interface Props {
  noun: string
  preview: RenameResult
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * What the rename will do, before it does it.
 *
 * The second list is the one that earns this dialog. Those claims are left
 * exactly as they are, and their reach still changes, so this is the only place
 * an operator can find out.
 */
export function RenameConfirmDialog({ noun, preview, busy, onConfirm, onCancel }: Props) {
  const rewritten = preview.rewritten_claims
  const affected = preview.pattern_affected_claims

  return (
    <Modal onClose={busy ? () => {} : onCancel}>
      <ModalHeader>
        <ModalIcon tone={affected.length > 0 ? 'bad' : 'ok'}>
          {affected.length > 0 ? <AlertTriangle size={20} /> : <Pencil size={20} />}
        </ModalIcon>
        <ModalCopy>
          <h3>
            Rename to {preview.to}?
          </h3>
          <ModalBody>
            Every path and every claim naming <b>{preview.from}</b> changes to{' '}
            <b>{preview.to}</b>. Entries, ids and revisions are untouched.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.claimLists}>
        <section>
          <h4>Claims that follow the rename</h4>
          {rewritten.length === 0 ? (
            <p className={styles.none}>None. No key names this {noun} directly.</p>
          ) : (
            <ul className={styles.claims}>
              {rewritten.map((claim) => (
                <li key={claim}>
                  <code>{claim}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        {affected.length > 0 && (
          <section className={styles.warning}>
            <h4>Claims that change reach but are not rewritten</h4>
            <p>
              These use a wildcard, so they are patterns over names rather than references
              to this {noun}. They stop reaching it under the old name and will reach
              anything created with that name later.
            </p>
            <ul className={styles.claims}>
              {affected.map((claim) => (
                <li key={claim}>
                  <code>{claim}</code>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Renaming…' : `Rename ${noun}`}
        </Button>
      </ModalActions>
    </Modal>
  )
}
