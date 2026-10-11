import { Settings } from 'lucide-react'
import styles from './ScopeBrowser.module.css'

/**
 * A row's way through to what configures it: hidden until the row is hovered,
 * so a column of forty names is a list of names and not a list of gears.
 *
 * Shared by all three columns rather than written out per column, for the
 * reason `BrowserColumn` itself is: the server column had the only copy, and a
 * second and third would be three places to keep one affordance in step.
 *
 * It stops the click before the row sees it — opening settings is not choosing
 * the row, and on the environment column choosing a chosen row opens the
 * workspace.
 */
export function ColumnSettingsButton({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.itemSettings}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      title={title}
      aria-label={title}
    >
      <Settings size={13} />
    </button>
  )
}
