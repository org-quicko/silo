import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Pagination.module.css'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

interface Props {
  page: number
  pageSize: number
  total: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  /** False when a bordered row above this one (a table's last data row)
   *  already draws the line between them — two adjacent borders there would
   *  double up into one thick one. True (the default) draws its own, for a
   *  grid or anything else with nothing bordered right above it. */
  bordered?: boolean
}

/** The row-count bar under every paginated table: a rows-per-page selector,
 *  the current range against the total, and prev/next — no page-number
 *  buttons, since a page jump is rarely faster than one more click through a
 *  handful of neighbors and the numbers cost width every row-count change
 *  would have to reflow anyway. */
export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
  bordered = true,
}: Props) {
  const offset = (page - 1) * pageSize
  const start = total === 0 ? 0 : offset + 1
  const end = Math.min(offset + pageSize, total)

  return (
    <div className={`${styles.pagination} ${bordered ? '' : styles.unbordered}`}>
      <div className={styles.group}>
        <span className={styles.label}>Rows per page:</span>
        <select
          className={styles.pageSizeSelect}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label="Rows per page"
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <span className={styles.range}>
        {start}–{end} of {total}
      </span>

      <div className={styles.arrows}>
        <button
          type="button"
          className={styles.arrow}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className={styles.arrow}
          disabled={offset + pageSize >= total}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
