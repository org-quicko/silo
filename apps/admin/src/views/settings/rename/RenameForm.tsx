import { Pencil } from 'lucide-react'
import { useState } from 'react'
import type { RenameResult } from '../../../api/types/scope-record'
import { Button } from '../../../components/buttons/Button'
import { RenameConfirmDialog } from './RenameConfirmDialog'
import { useRenameFlow, type RenameSubject } from './use-rename-flow'
import styles from './Rename.module.css'

interface Props {
  subject: RenameSubject
  /** False when the key cannot rename this, which hides the control entirely —
   *  an affordance the server will refuse is worse than no affordance. */
  allowed: boolean
  /** Why it is unavailable, shown in place of the control. */
  unavailableReason?: string
  rename: (name: string, dryRun: boolean) => Promise<RenameResult>
  onRenamed: (name: string) => void | Promise<void>
}

/** The rename control, shared by the project, environment and collection
 *  pages so all three ask the same question the same way (D51). */
export function RenameForm({
  subject,
  allowed,
  unavailableReason,
  rename,
  onRenamed,
}: Props) {
  const [draft, setDraft] = useState(subject.currentName)
  const flow = useRenameFlow({ subject, rename, onRenamed })

  if (!allowed) {
    return (
      <div className={styles.form}>
        <p className={styles.hint}>{unavailableReason}</p>
      </div>
    )
  }

  const unchanged = draft.trim() === subject.currentName || draft.trim().length === 0

  return (
    <>
      <div className={styles.form}>
        <div className={styles.row}>
          <label>
            <span>Name</span>
            <input
              value={draft}
              disabled={flow.busy}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={flow.busy || unchanged}
            onClick={() => flow.start(draft)}
          >
            <Pencil size={14} />
            <span>Rename</span>
          </Button>
        </div>
        <p className={styles.hint}>
          Lowercase letter first, then letters, numbers, dashes or underscores. The id above
          does not change.
        </p>
        {flow.error && <p className={styles.error}>{flow.error}</p>}
      </div>

      {flow.preview && (
        <RenameConfirmDialog
          noun={subject.noun}
          preview={flow.preview}
          busy={flow.busy}
          onConfirm={flow.confirm}
          onCancel={flow.cancel}
        />
      )}
    </>
  )
}
