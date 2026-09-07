import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { RenameResult } from '../../../api/types/scope-record'
import { RenameConfirmDialog } from '../rename/RenameConfirmDialog'
import { useRenameFlow, type RenameSubject } from '../rename/use-rename-flow'
import styles from './SettingsLedger.module.css'

interface Props {
  subject: RenameSubject
  /** False when the key cannot rename this, which renders the name as plain
   *  text — an affordance the server will refuse is worse than none. */
  allowed: boolean
  rename: (name: string, dryRun: boolean) => Promise<RenameResult>
  onRenamed: (name: string) => void | Promise<void>
}

/**
 * Renaming as an inline edit of the page title: click the name, type, Enter.
 *
 * It replaces a form whose resting state was broken — the field came pre-filled
 * with the current name, so its Rename button sat disabled until you typed.
 * The two-step preview behind it is unchanged (D51); this only changes where
 * the new name is typed.
 */
export function RenameableTitle({ subject, allowed, rename, onRenamed }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(subject.currentName)
  const flow = useRenameFlow({
    subject,
    rename,
    onRenamed: async (name) => {
      setEditing(false)
      await onRenamed(name)
    },
  })

  if (!allowed) return <>{subject.currentName}</>

  const commit = () => {
    const wanted = draft.trim()
    if (!wanted || wanted === subject.currentName) {
      setEditing(false)
      setDraft(subject.currentName)
      return
    }
    flow.start(wanted)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(subject.currentName)
  }

  return (
    <>
      {editing ? (
        <span>
          <input
            className={styles.renameInput}
            value={draft}
            autoFocus
            spellCheck={false}
            disabled={flow.busy}
            aria-label={`Rename ${subject.noun}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
            // Blur cancels rather than commits: a click anywhere else is far
            // likelier to be "I changed my mind" than a deliberate rename.
            onBlur={() => !flow.preview && !flow.busy && cancel()}
          />
          {flow.error && <span className={styles.renameError}>{flow.error}</span>}
        </span>
      ) : (
        <button
          type="button"
          className={styles.renameButton}
          title={`Rename this ${subject.noun}`}
          onClick={() => {
            setDraft(subject.currentName)
            setEditing(true)
          }}
        >
          {subject.currentName}
          <Pencil size={13} />
        </button>
      )}

      {flow.preview && (
        <RenameConfirmDialog
          noun={subject.noun}
          preview={flow.preview}
          busy={flow.busy}
          onConfirm={flow.confirm}
          onCancel={() => {
            flow.cancel()
            cancel()
          }}
        />
      )}
    </>
  )
}
