import { FileText, Link, Pencil, Trash2 } from 'lucide-react'
import { MediaRef } from '@silo/shared/media-ref'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { ByteSize } from '../../utils/byte-size'
import { MediaUsageBadge } from './media-usage-badge'
import styles from './MediaLibrary.module.css'

interface Props {
  asset: MediaAsset
  /** The server's base URL; the asset's own `url` is rooted at it. */
  baseUrl: string
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}

/** One asset in the grid: preview, facts, and the four things you can do to it. */
export function MediaCard({ asset, baseUrl, canEdit, canDelete, onEdit, onDelete }: Props) {
  const fileUrl = `${baseUrl}${asset.url}`
  const used = asset.usage_count || 0
  const isImage = asset.content_type.startsWith('image/')

  const badgeClass =
    asset.state === 'deleting'
      ? styles.stalledBadge
      : used > 0
        ? styles.usedBadge
        : undefined

  return (
    <div className={styles.card}>
      <div className={styles.preview}>
        {isImage ? (
          <img src={fileUrl} alt={asset.filename} loading="lazy" />
        ) : (
          <div className={styles.previewIcon}>
            <FileText size={36} strokeWidth={1.5} />
          </div>
        )}
      </div>

      <div className={styles.info}>
        <span className={styles.name} title={asset.filename}>
          {asset.filename}
        </span>
        <div className={styles.meta}>
          <span>{ByteSize.format(asset.size)}</span>
          <span className={badgeClass} title={MediaUsageBadge.title(asset)}>
            {MediaUsageBadge.label(asset)}
          </span>
        </div>
        {asset.folder && <span className={styles.folderTag}>{asset.folder}</span>}
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          className={styles.copyAction}
          title="Copy the reference to paste into an entry"
          onClick={() => navigator.clipboard.writeText(MediaRef.url(asset.id))}
        >
          <Link size={11} /> Ref
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className={styles.copyAction}
          title="Copy the public URL"
          onClick={() => navigator.clipboard.writeText(fileUrl)}
        >
          <Link size={11} /> URL
        </Button>
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.iconAction}
            title="Rename or move"
            onClick={onEdit}
          >
            <Pencil size={11} />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="dangerGhost"
            size="sm"
            className={styles.iconAction}
            title={used > 0 ? 'Referenced by entries' : 'Delete file'}
            onClick={onDelete}
          >
            <Trash2 size={11} />
          </Button>
        )}
      </div>
    </div>
  )
}
