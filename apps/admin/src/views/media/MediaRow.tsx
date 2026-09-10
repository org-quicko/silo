import { Eye, FileText, Link, Pencil, Trash2 } from 'lucide-react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Button } from '../../components/buttons/Button'
import { Checkbox } from '../../components/controls/Checkbox'
import { ByteSize } from '../../utils/byte-size'
import { Formatters } from '../../utils/formatters'
import table from '../../components/data/DataTable.module.css'
import styles from './MediaLibrary.module.css'
import { MediaFileUrl } from './media-file-url'

interface Props {
  asset: MediaAsset
  baseUrl: string
  canEdit: boolean
  /** Also whether the row is selectable at all — the checkbox is a bulk
   *  delete tool, so it needs the same claim the trash icon does. */
  canDelete: boolean
  gridCols: string
  selected: boolean
  onToggleSelect: () => void
  onPreview: (asset: MediaAsset) => void
  onEdit: () => void
  onDelete: () => void
  onDragStart?: (e: React.DragEvent) => void
}

/** `MediaCard`'s row form for list view — same facts, same hover-revealed
 *  actions, with native media preview and drag-and-drop support. */
export function MediaRow({
  asset,
  baseUrl,
  canEdit,
  canDelete,
  gridCols,
  selected,
  onToggleSelect,
  onPreview,
  onEdit,
  onDelete,
  onDragStart,
}: Props) {
  const fileUrl = MediaFileUrl.of(asset, baseUrl)
  const used = asset.usage_count || 0
  const isImage = asset.content_type.startsWith('image/')

  return (
    <div
      className={`${table.row} ${styles.fileRow}`}
      style={{ ['--cols' as any]: gridCols }}
      draggable={canEdit}
      onDragStart={onDragStart}
    >
      {canDelete && (
        <div className={`${table.cell} ${styles.checkboxCell}`}>
          <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`Select ${asset.filename}`} />
        </div>
      )}
      <button
        type="button"
        className={`${table.cell} ${table.clickable} ${styles.rowName} ${styles.rowNameButton}`}
        onClick={() => onPreview(asset)}
      >
        <span className={styles.rowIcon}>
          {isImage ? <img src={fileUrl} alt="" loading="lazy" /> : <FileText size={15} />}
        </span>
        <span className={table.title} title={asset.filename}>
          {asset.filename}
        </span>
      </button>
      <div className={table.cell}>{ByteSize.format(asset.size)}</div>
      <div className={table.cell} title={new Date(asset.updated_at).toLocaleString()}>
        {Formatters.relativeTime(asset.updated_at)}
      </div>
      <div className={`${table.cell} ${table.actions} ${styles.rowActions}`}>
        <Button
          variant="secondary"
          size="sm"
          className={styles.iconAction}
          title="Preview file"
          onClick={() => onPreview(asset)}
        >
          <Eye size={14} />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className={styles.iconAction}
          title="Copy the public URL"
          onClick={() => navigator.clipboard.writeText(fileUrl)}
        >
          <Link size={14} />
        </Button>
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.iconAction}
            title="Rename or move"
            onClick={onEdit}
          >
            <Pencil size={14} />
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
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
