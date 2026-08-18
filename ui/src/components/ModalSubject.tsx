import type { ReactNode } from 'react'
import styles from './Modal.module.css'

export function ModalSubject({ mark, title, subtitle }: { mark: ReactNode; title: ReactNode; subtitle: ReactNode }) {
  return (
    <div className={styles.subject}>
      <span className={styles.subjectMark}>{mark}</span>
      <div className={styles.subjectCopy}>
        <span className={styles.subjectTitle}>{title}</span>
        <span className={styles.subjectSubtitle}>{subtitle}</span>
      </div>
    </div>
  )
}
