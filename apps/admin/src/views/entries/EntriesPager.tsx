import styles from './Entries.module.css'

interface Props {
  total: number
  offset: number
  pageSize: number
  page: number
  onGoTo: (page: number) => void
}

/** The page controls under the table. */
export function EntriesPager({ total, offset, pageSize, page, onGoTo }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const shown = Math.min(pageCount, 3)

  return (
    <div className={styles.pager}>
      <span className={styles.pagerInfo}>
        {total === 0
          ? 'No entries'
          : `Showing ${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}`}
      </span>
      <div className={styles.pagerButtons}>
        <button
          className={styles.pagerButton}
          disabled={page <= 1}
          onClick={() => onGoTo(Math.max(1, page - 1))}
        >
          ‹
        </button>
        {Array.from({ length: shown }, (_, index) => index + 1).map((number) => (
          <button
            key={number}
            className={`${styles.pagerButton} ${number === page ? styles.active : ''}`}
            onClick={() => onGoTo(number)}
          >
            {number}
          </button>
        ))}
        <button
          className={styles.pagerButton}
          disabled={offset + pageSize >= total}
          onClick={() => onGoTo(page + 1)}
        >
          ›
        </button>
        <span className={styles.rowsTag}>Rows {pageSize}</span>
      </div>
    </div>
  )
}
