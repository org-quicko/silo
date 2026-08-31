import { DangerConfirm } from '../../components/modal/DangerConfirm'

interface Props {
  from: string
  to: string
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Offered only after a plain rename refuses because `to` already exists
 * (D49). Merging is genuinely non-reversible: the two subtrees become one,
 * and renaming back cannot separate them again, so this is `DangerConfirm`
 * rather than the checkbox `AssetInUseDialog` uses for a recoverable force.
 */
export function MergeFolderDialog({ from, to, busy, onConfirm, onClose }: Props) {
  return (
    <DangerConfirm
      title="Merge into an existing folder?"
      confirmWord={to}
      confirmLabel="Merge folders"
      busyLabel="Merging…"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onClose}
    >
      <b>{to}</b> already exists. Moving <b>{from}</b> there joins every file and folder into it.
      This cannot be undone.
    </DangerConfirm>
  )
}
