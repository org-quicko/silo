import { useRef, useState } from 'react'
import styles from './ColumnResizer.module.css'

/**
 * The boundary between two column headings: drag it to set this column's width,
 * double-click to hand the column back to the table's own sizing.
 *
 * `onPreview` runs on every pointer move and is expected to paint the width
 * directly; only `onCommit` reaches React state, so dragging never re-renders a
 * page of rows per frame. Hidden from assistive tech: it adjusts presentation
 * only, and every cell it can widen is already readable in the entry itself.
 */
export function ColumnResizer({
  clamp,
  onPreview,
  onCommit,
  onReset,
}: {
  /** Applies the column's own limits to a dragged width. */
  clamp: (width: number) => number
  onPreview: (width: number) => void
  onCommit: (width: number) => void
  onReset: () => void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // The heading is the column: its rendered width is the one the drag starts from.
  const widthAt = (clientX: number) => clamp(drag.current!.width + clientX - drag.current!.x)

  return (
    <span
      className={`${styles.resizer} ${dragging ? styles.dragging : ''}`}
      aria-hidden="true"
      title="Drag to resize, double-click to reset"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        const heading = event.currentTarget.parentElement
        if (!heading) return
        event.preventDefault()
        event.stopPropagation()
        drag.current = { x: event.clientX, width: heading.getBoundingClientRect().width }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (drag.current) onPreview(widthAt(event.clientX))
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        const width = widthAt(event.clientX)
        drag.current = null
        setDragging(false)
        event.currentTarget.releasePointerCapture(event.pointerId)
        onCommit(width)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
    >
      <span className={styles.line} />
    </span>
  )
}
