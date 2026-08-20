import React, { useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'
import { ModalActions } from './ModalActions'
import { ModalBody } from './ModalBody'
import { ModalCopy } from './ModalCopy'
import { ModalHeader } from './ModalHeader'
import { ModalIcon } from './ModalIcon'
import styles from './DangerConfirm.module.css'

/**
 * A destructive confirmation that will not arm until the user types the
 * subject's name back. Reserved for actions no undo exists for — deleting a
 * project or an environment takes every collection and entry under it with it,
 * and those are exactly the cases where a reflexive click on "Delete" is the
 * likeliest way to lose data.
 */
export function DangerConfirm({
  title,
  confirmWord,
  confirmLabel,
  busy = false,
  error,
  children,
  onConfirm,
  onCancel,
}: {
  title: string
  /** Typed back verbatim before the action arms — normally the subject's id. */
  confirmWord: string
  confirmLabel: string
  busy?: boolean
  error?: string
  children: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const armed = typed === confirmWord && !busy

  return (
    <Modal onClose={busy ? () => {} : onCancel}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <AlertTriangle size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>{title}</h3>
          <ModalBody>{children}</ModalBody>
        </ModalCopy>
      </ModalHeader>

      <form
        className={styles.gate}
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault()
          if (armed) onConfirm()
        }}
      >
        <label className={styles.label} htmlFor="danger-confirm">
          Type <code>{confirmWord}</code> to confirm.
        </label>
        <input
          id="danger-confirm"
          className={styles.input}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          autoComplete="off"
          autoFocus
        />
        {error && <span className={styles.error}>{error}</span>}
      </form>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" disabled={!armed} onClick={onConfirm}>
          {busy ? 'Deleting…' : confirmLabel}
        </Button>
      </ModalActions>
    </Modal>
  )
}
