import { Pencil } from 'lucide-react'
import { useState } from 'react'
import type { RenameResult } from '../../../api/types/scope-record'
import { Button } from '../../../components/buttons/Button'
import { RenameEligibility } from './rename-eligibility'
import { RenameConfirmDialog } from './RenameConfirmDialog'
import { useRenameFlow, type RenameSubject } from './use-rename-flow'
import styles from './Rename.module.css'

interface Props {
  subject: RenameSubject
  /** False when the key cannot rename this, which hides the control entirely —
   *  an affordance the server will refuse is worse than no affordance. */
  allowed: boolean
  /** Imperative commit-time re-check (e.g. schema became dirty during dry-run). */
  canCommit?: () => boolean
  /** Why it is unavailable, shown in place of the control. */
  unavailableReason?: string
  rename: (name: string, dryRun: boolean) => Promise<RenameResult>
  runCommit?: (
    commit: (isCurrent: () => boolean, mutationIdAtStart?: number | null) => Promise<void>,
  ) => Promise<void>
  onRenamed: (
    name: string,
    isCurrent?: () => boolean,
    mutationIdAtStart?: number | null,
  ) => void | Promise<void>
  /** Why a new name cannot be used, or null. Shown as it is typed, and the
   *  rename waits until it passes, so no preview offers a name the server refuses. */
  validate?: (name: string) => string | null
}

/** The rename control, shared by the project, environment and collection
 *  pages so all three ask the same question the same way (D51). */
export function RenameForm({
  subject,
  allowed,
  canCommit,
  unavailableReason,
  rename,
  runCommit,
  onRenamed,
  validate,
}: Props) {
  const [draft, setDraft] = useState(subject.currentName)
  const flow = useRenameFlow({ subject, allowed, canCommit, rename, runCommit, onRenamed })
  const dialogVisible = RenameEligibility.isDialogVisible({
    allowed,
    busy: flow.busy,
    hasPreview: flow.preview !== null,
  })

  if (!allowed && !dialogVisible) {
    return (
      <div className={styles.form}>
        <p className={styles.hint}>{unavailableReason}</p>
      </div>
    )
  }

  const unchanged = draft.trim() === subject.currentName || draft.trim().length === 0
  const problem = unchanged ? null : validate?.(draft.trim()) ?? null

  return (
    <>
      <div className={styles.form}>
        <div className={styles.row}>
          <label>
            <span>Name</span>
            <input
              value={draft}
              disabled={!allowed || flow.busy}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!allowed || flow.busy || unchanged || problem !== null}
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
        {problem && <p className={styles.error}>{problem}</p>}
        {flow.error && <p className={styles.error}>{flow.error}</p>}
      </div>

      {dialogVisible && flow.preview && (
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
