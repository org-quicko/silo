import type { HTMLAttributes } from 'react'
import styles from './Modal.module.css'

/** What went wrong with the action this dialog is asking for, said inside the
 *  dialog. A reader looking at a dialog is not looking at the page behind it,
 *  so a failure that lands in the page's own banner reads as nothing
 *  happening at all. */
export function ModalError({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p role="alert" className={[styles.error, className].filter(Boolean).join(' ')} {...props} />
}
