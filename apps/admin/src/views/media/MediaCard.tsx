import { useState } from 'react'
import { Check, Eye, FileText, Image as ImageIcon, Link, MoreHorizontal } from 'lucide-react'
import type { MediaAsset } from '../../api/types/media-asset'
import { Checkbox } from '../../components/controls/Checkbox'
import { MediaCardMenu } from './MediaCardMenu'
import { MediaFileUrl } from './media-file-url'
import { useCopyToClipboard } from './use-copy-to-clipboard'
import styles from './MediaLibrary.module.css'

interface Props {
  asset: MediaAsset
  /** The server's base URL; the asset's own `url` is rooted at it. */
  baseUrl: string
  canEdit: boolean
  /** Also whether the card is selectable at all — the checkbox is a bulk
   *  delete tool, so it needs the same claim the trash icon does. */
  canDelete: boolean
  selected: boolean
  onToggleSelect: () => void
  onPreview: (asset: MediaAsset) => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
  onDragStart?: (e: React.DragEvent) => void
}

/** One asset in the grid: a header row naming it, a preview thumbnail, and — revealed
 *  on hover so the tile stays quiet at rest — a select checkbox, a copy-link
 *  shortcut, a preview shortcut, and a "more" menu for rename/move/delete. */
export function MediaCard({
  asset,
  baseUrl,
  canEdit,
  canDelete,
  selected,
  onToggleSelect,
  onPreview,
  onEdit,
  onMove,
  onDelete,
  onDragStart,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const link = useCopyToClipboard('Link copied')
  const fileUrl = MediaFileUrl.of(asset, baseUrl)
  const used = asset.usage_count || 0
  const isImage = asset.content_type.startsWith('image/')

  const handleCardClick = () => {
    onPreview(asset)
  }

  return (
    <div
      className={`${styles.assetCard} ${selected ? styles.cardSelected : ''} ${menuOpen ? styles.cardMenuOpen : ''}`}
      role="button"
      tabIndex={0}
      draggable={canEdit}
      aria-label={selected ? `${asset.filename}, selected` : asset.filename}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleCardClick()
      }}
      onDragStart={onDragStart}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardHeadIcon}>{isImage ? <ImageIcon size={16} /> : <FileText size={16} />}</span>
        <span className={styles.cardHeadName} title={asset.filename}>
          {asset.filename}
        </span>
        <button
          type="button"
          className={styles.cardMore}
          title="More"
          aria-label="More options"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((open) => !open)
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>

      <div className={styles.thumb}>
        {canDelete && (
          <span className={styles.thumbCheckbox} onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`Select ${asset.filename}`} />
          </span>
        )}
        {isImage ? (
          <img src={fileUrl} alt={asset.filename} loading="lazy" />
        ) : (
          <FileText size={36} strokeWidth={1.5} className={styles.thumbIcon} />
        )}
        <div className={styles.quickActions}>
          <button
            type="button"
            className={styles.quickActionButton}
            title="Preview file"
            onClick={(e) => {
              e.stopPropagation()
              onPreview(asset)
            }}
          >
            <Eye size={12.5} />
          </button>
          <button
            type="button"
            className={styles.quickActionButton}
            title="Copy the public URL"
            onClick={(e) => {
              e.stopPropagation()
              link.copy(fileUrl)
            }}
          >
            {link.copied ? <Check size={12.5} /> : <Link size={12.5} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <MediaCardMenu
          onPreview={() => {
            setMenuOpen(false)
            onPreview(asset)
          }}
          onCopyLink={() => {
            setMenuOpen(false)
            link.copy(fileUrl)
          }}
          canRename={canEdit}
          onRename={() => {
            setMenuOpen(false)
            onEdit()
          }}
          canMove={canEdit}
          onMove={() => {
            setMenuOpen(false)
            onMove()
          }}
          canDelete={canDelete}
          deleteTitle={used > 0 ? 'Referenced by entries' : 'Delete file'}
          onDelete={() => {
            setMenuOpen(false)
            onDelete()
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}
