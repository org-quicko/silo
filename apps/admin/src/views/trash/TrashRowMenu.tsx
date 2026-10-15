import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './Trash.module.css'

/** Room the menu needs below its button before it opens upward instead. */
const MenuHeight = 96

/**
 * A row's "more" menu. It opens upward when the row sits near the bottom of
 * the scrolling page, so the last row's menu is never cut off.
 */
export function TrashRowMenu({ canPurge, onPurge }: { canPurge: boolean; onPurge: () => void }) {
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocument = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocument)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocument)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (!open && ref.current) {
      const button = ref.current.getBoundingClientRect()
      const page = ref.current.closest('.content')?.getBoundingClientRect()
      const floor = page ? page.bottom : window.innerHeight
      setUpward(floor - button.bottom < MenuHeight)
    }
    setOpen((current) => !current)
  }

  return (
    <div ref={ref} className={styles.menuWrap}>
      <Button size="sm" className={styles.menuButton} aria-label="More actions" title="More actions" onClick={toggle}>
        <MoreHorizontal size={14} />
      </Button>
      {open && (
        <div className={`${styles.menu} ${upward ? styles.menuUp : ''}`} role="menu">
          {/* Hidden rather than disabled without `trash:purge`: an affordance
              the server will refuse is worse than none. */}
          {canPurge ? (
            <button
              type="button"
              role="menuitem"
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => {
                setOpen(false)
                onPurge()
              }}
            >
              <Trash2 size={14} /> <span>Delete permanently</span>
            </button>
          ) : (
            <span className={`${styles.menuItem} ${styles.menuItemQuiet}`}>No other actions</span>
          )}
        </div>
      )}
    </div>
  )
}
