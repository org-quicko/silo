import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import { MediaPath } from './media-path'
import styles from './MediaLibrary.module.css'

interface Props {
  /** "" is the library root. */
  folder: string
  canDrop?: boolean
  onSelectFolder: (path: string) => void
  onDropToFolder?: (targetFolder: string, assets: MediaAsset[], folderPaths: string[]) => void
}

/**
 * Where in the folder tree the library currently is, one clickable crumb per
 * level. Ancestor crumbs act as drop targets when dragging items.
 */
export function MediaPathTrail({ folder, canDrop = false, onSelectFolder, onDropToFolder }: Props) {
  const segments = MediaPath.segments(folder)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  const handleDragOver = (e: React.DragEvent) => {
    if (!canDrop) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnter = (targetPath: string) => (e: React.DragEvent) => {
    if (!canDrop) return
    e.preventDefault()
    setDragOverPath(targetPath)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!canDrop) return
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null)
    }
  }

  const handleDrop = (targetPath: string) => (e: React.DragEvent) => {
    if (!canDrop) return
    e.preventDefault()
    setDragOverPath(null)
    try {
      const raw = e.dataTransfer.getData('application/json')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.assets || parsed.folderPaths) {
          onDropToFolder?.(targetPath, parsed.assets || [], parsed.folderPaths || [])
        }
      }
    } catch {
      // Ignore invalid drag format
    }
  }

  return (
    <div className={styles.pathRow}>
      <nav className={styles.pathTrail} aria-label="Folder path">
        {folder === '' ? (
          <span className={styles.pathCurrent}>All files</span>
        ) : (
          <button
            type="button"
            className={`${styles.pathCrumb} ${dragOverPath === '' ? styles.crumbDropTarget : ''}`}
            onClick={() => onSelectFolder('')}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter('')}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop('')}
          >
            All files
          </button>
        )}
        {segments.map((segment, index) => (
          <span key={segment.path} className={styles.pathSegment}>
            <span className={styles.pathSep}>/</span>
            {index === segments.length - 1 ? (
              <span className={styles.pathCurrent}>{segment.name}</span>
            ) : (
              <button
                type="button"
                className={`${styles.pathCrumb} ${dragOverPath === segment.path ? styles.crumbDropTarget : ''}`}
                onClick={() => onSelectFolder(segment.path)}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter(segment.path)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(segment.path)}
              >
                {segment.name}
              </button>
            )}
          </span>
        ))}
      </nav>
    </div>
  )
}
