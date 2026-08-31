import { Link } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Checkbox } from '../../components/controls/Checkbox'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import type { MediaInUseAsset } from './media-delete-outcome'
import styles from './MediaLibrary.module.css'

interface Props {
  assets: MediaInUseAsset[]
  checked: boolean
  busy: boolean
  onCheckedChange: (checked: boolean) => void
  onForceDelete: () => void
  onClose: () => void
}

/**
 * Replaces `DeleteAssetDialog` when the server refuses some of the ids: the
 * second and last dialog in the flow. Checking the box and clicking Force
 * delete retries only these ids, forced, with nothing to confirm after it.
 */
export function AssetInUseDialog({ assets, checked, busy, onCheckedChange, onForceDelete, onClose }: Props) {
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Link size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Files still in use</h3>
          <ModalBody>
            {assets.length === 1
              ? 'This file is still referenced. Delete it anyway, or remove the reference first.'
              : `${assets.length} files are still referenced. Delete them anyway, or remove the references first.`}
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.inUseAssets}>
        {assets.map((asset) => {
          const hidden = asset.usage_count - asset.visible_count
          return (
            <div key={asset.id} className={styles.inUseAsset}>
              <div className={styles.inUseHeader}>
                <span className={styles.inUseFilename}>{asset.filename}</span>
                <span className={styles.inUseCount}>
                  {asset.usage_count} {asset.usage_count === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              <div className={styles.usageList}>
                {asset.referrers.map((referrer) => (
                  <div
                    key={`${referrer.project}/${referrer.env}/${referrer.collection}/${referrer.entry_id}`}
                    className={styles.usageRow}
                  >
                    <span className={styles.usageScope}>
                      {referrer.project}/{referrer.env}
                    </span>
                    <span>
                      {referrer.collection} · {referrer.entry_id}
                    </span>
                  </div>
                ))}
                {hidden > 0 && (
                  // Media is instance-global but entries are scoped, so a key
                  // confined to one project learns the extent without
                  // learning where the rest live.
                  <div className={styles.usageHidden}>{hidden} more in projects this key cannot read.</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <label className={styles.forceGate}>
        <Checkbox checked={checked} onChange={onCheckedChange} disabled={busy} />
        I understand this will break these references.
      </label>

      <ModalActions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={!checked || busy} onClick={onForceDelete}>
          {busy ? 'Deleting…' : 'Force delete'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
