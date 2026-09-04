import type { MediaAsset } from '../../api/types/media-asset'
import { AssetInUseDialog } from './AssetInUseDialog'
import { DeleteAssetDialog } from './DeleteAssetDialog'
import { MediaForceAvailability } from './media-force-availability'
import { MergeFolderDialog } from './MergeFolderDialog'
import { NewFolderDialog } from './NewFolderDialog'
import { PurgeLibraryDialog } from './PurgeLibraryDialog'
import { RenameAssetDialog } from './RenameAssetDialog'
import { RenameFolderDialog } from './RenameFolderDialog'
import type { useMediaDeleteFlow } from './use-media-delete-flow'
import type { useMediaPurge } from './use-media-purge'
import type { useMediaRenameFolderFlow } from './use-media-rename-folder-flow'

interface Props {
  claims: string[]
  editing: MediaAsset | null
  editingBusy: boolean
  deleteFlow: ReturnType<typeof useMediaDeleteFlow>
  purgeFlow: ReturnType<typeof useMediaPurge>
  renameFolderFlow: ReturnType<typeof useMediaRenameFolderFlow>
  onRenameAsset: (filename: string, folder: string) => void
  onCloseRenameAsset: () => void
  creatingFolder: boolean
  creatingFolderBusy: boolean
  newFolderParent: string
  onCreateFolder: (name: string) => void
  onCloseNewFolder: () => void
}

/**
 * Every overlay the library can open, in one place.
 *
 * The flows decide *which* is showing and are passed whole rather than
 * unpacked: each already owns a mutually exclusive pair (a confirm and its
 * follow-up), so splitting one across a prop list would put that exclusivity
 * back in the caller's hands. `MediaLibraryView` is then the page and this is
 * what the page can ask.
 */
export function MediaDialogs({
  claims,
  editing,
  editingBusy,
  deleteFlow,
  purgeFlow,
  renameFolderFlow,
  onRenameAsset,
  onCloseRenameAsset,
  creatingFolder,
  creatingFolderBusy,
  newFolderParent,
  onCreateFolder,
  onCloseNewFolder,
}: Props) {
  return (
    <>
      {editing && (
        <RenameAssetDialog
          asset={editing}
          busy={editingBusy}
          onSave={onRenameAsset}
          onClose={onCloseRenameAsset}
        />
      )}

      {creatingFolder && (
        <NewFolderDialog
          parent={newFolderParent}
          busy={creatingFolderBusy}
          onCreate={onCreateFolder}
          onClose={onCloseNewFolder}
        />
      )}

      {renameFolderFlow.path !== null && !renameFolderFlow.mergeOffer && (
        <RenameFolderDialog
          path={renameFolderFlow.path}
          busy={renameFolderFlow.busy}
          onSave={renameFolderFlow.save}
          onClose={renameFolderFlow.cancel}
        />
      )}

      {renameFolderFlow.mergeOffer && (
        <MergeFolderDialog
          from={renameFolderFlow.mergeOffer.from}
          to={renameFolderFlow.mergeOffer.to}
          busy={renameFolderFlow.busy}
          onConfirm={renameFolderFlow.confirmMerge}
          onClose={renameFolderFlow.cancel}
        />
      )}

      {purgeFlow.purging && (
        <PurgeLibraryDialog
          busy={purgeFlow.busy}
          error={purgeFlow.error}
          onConfirm={purgeFlow.confirm}
          onClose={purgeFlow.cancel}
        />
      )}

      {deleteFlow.subject && !deleteFlow.inUse && (
        <DeleteAssetDialog
          subject={deleteFlow.subject}
          busy={deleteFlow.busy}
          onConfirm={deleteFlow.confirm}
          onClose={deleteFlow.cancel}
        />
      )}

      {deleteFlow.inUse && (
        <AssetInUseDialog
          assets={deleteFlow.inUse}
          checked={deleteFlow.forceChecked}
          busy={deleteFlow.busy}
          forceUnavailable={MediaForceAvailability.unavailable(deleteFlow.inUse, claims)}
          onCheckedChange={deleteFlow.setForceChecked}
          onForceDelete={deleteFlow.forceDelete}
          onClose={deleteFlow.cancel}
        />
      )}
    </>
  )
}
