import { Link } from 'lucide-react'
import type { MediaInUse } from '../../api/types/media-usage'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import styles from './MediaLibrary.module.css'

interface Props {
  filename: string
  inUse: MediaInUse
  onClose: () => void
}

/** Why a delete was refused, and where the references are. */
export function AssetInUseDialog({ filename, inUse, onClose }: Props) {
  const hidden = inUse.usage_count - inUse.visible_count

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalIcon tone="bad">
          <Link size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>This file is still in use</h3>
          <ModalBody>
            {filename} is referenced by {inUse.usage_count}{' '}
            {inUse.usage_count === 1 ? 'entry' : 'entries'}. Remove the reference from each
            one, then delete the file.
          </ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.usageList}>
        {inUse.referrers.map((referrer) => (
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
          // Media is instance-global but entries are scoped, so a key confined
          // to one project learns the extent without learning where the rest
          // live.
          <div className={styles.usageHidden}>
            {hidden} more in projects this key cannot read.
          </div>
        )}
      </div>

      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalActions>
    </Modal>
  )
}
