import { MediaPath } from './media-path'
import styles from './MediaLibrary.module.css'

interface Props {
  /** "" is the library root. */
  folder: string
  onSelectFolder: (path: string) => void
}

/**
 * Where in the folder tree the library currently is, one clickable crumb per
 * level. The last segment is the current folder and is text, not a button:
 * navigating to where you already are is not an action.
 */
export function MediaPathTrail({ folder, onSelectFolder }: Props) {
  const segments = MediaPath.segments(folder)

  return (
    <div className={styles.pathRow}>
      <nav className={styles.pathTrail} aria-label="Folder path">
        {folder === '' ? (
          <span className={styles.pathCurrent}>All files</span>
        ) : (
          <button type="button" className={styles.pathCrumb} onClick={() => onSelectFolder('')}>
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
                className={styles.pathCrumb}
                onClick={() => onSelectFolder(segment.path)}
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
