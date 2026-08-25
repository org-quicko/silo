import { Folder, FolderPlus } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './MediaLibrary.module.css'

interface Props {
  folders: string[]
  selected: string
  canCreate: boolean
  onSelect: (folder: string) => void
  onCreate: () => void
}

/** The folder tree beside the grid. Indentation comes from the path depth. */
export function FolderRail({ folders, selected, canCreate, onSelect, onCreate }: Props) {
  return (
    <nav className={styles.rail}>
      <div className={styles.railHead}>
        <span>Folders</span>
        {canCreate && (
          <Button variant="secondary" size="sm" title="New folder" onClick={onCreate}>
            <FolderPlus size={12} />
          </Button>
        )}
      </div>

      <button
        type="button"
        className={`${styles.railItem} ${selected === '' ? styles.railItemActive : ''}`}
        onClick={() => onSelect('')}
      >
        <Folder size={12} /> All files
      </button>

      {folders.map((folder) => (
        <button
          key={folder}
          type="button"
          className={`${styles.railItem} ${folder === selected ? styles.railItemActive : ''}`}
          style={{ paddingLeft: `${10 + (folder.split('/').length - 2) * 12}px` }}
          onClick={() => onSelect(folder)}
        >
          <Folder size={12} /> {folder.split('/').pop()}
        </button>
      ))}
    </nav>
  )
}
