import { FileText, Link, Pencil, Trash2 } from 'lucide-react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { ByteSize } from '../../utils/byte-size'
import { Formatters } from '../../utils/formatters'
import { MediaUsageBadge } from './media-usage-badge'
import table from '../../components/data/DataTable.module.css'
import styles from './MediaLibrary.module.css'
import { MediaFileUrl } from './media-file-url'

interface Props {
  asset: MediaAsset
  baseUrl: string
  canEdit: boolean
  canDelete: boolean
  gridCols: string
  onEdit: () => void
  onDelete: () => void
}

/** `MediaCard`'s row form for list view — same facts, same hover-revealed
 *  actions, laid out across the shared `DataTable` grid instead of a tile. */
export function MediaRow({ asset, baseUrl, canEdit, canDelete, gridCols, onEdit, onDelete }: Props) {
  const fileUrl = MediaFileUrl.of(asset, baseUrl)
  const used = asset.usage_count || 0
  const isImage = asset.content_type.startsWith('image/')

  const badgeClass =
    asset.state === 'deleting'
      ? styles.stalledBadge
      : used > 0
        ? styles.usedBadge
        : undefined

  return (
    <div className={`${table.row} ${styles.fileRow}`} style={{ ['--cols' as any]: gridCols }}>
      <div className={`${table.cell} ${styles.rowName}`}>
        <span className={styles.rowIcon}>
          {isImage ? <img src={fileUrl} alt="" loading="lazy" /> : <FileText size={15} />}
        </span>
        <span className={table.title} title={asset.filename}>
          {asset.filename}
        </span>
      </div>
      <div className={table.cell}>{ByteSize.format(asset.size)}</div>
      <div className={table.cell} title={new Date(asset.updated_at).toLocaleString()}>
        {Formatters.relativeTime(asset.updated_at)}
      </div>
      <div className={table.cell}>
        <span className={badgeClass} title={MediaUsageBadge.title(asset)}>
          {MediaUsageBadge.label(asset)}
        </span>
      </div>
      <div className={`${table.cell} ${table.actions} ${styles.rowActions}`}>
        <Button
          variant="secondary"
          size="sm"
          className={styles.iconAction}
          title="Copy the public URL"
          onClick={() => navigator.clipboard.writeText(fileUrl)}
        >
          <Link size={11} />
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
