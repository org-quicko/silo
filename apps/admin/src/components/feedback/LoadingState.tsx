import { Spinner, type SpinnerSize } from './Spinner'
import styles from './LoadingState.module.css'

interface Props {
  /** What is being waited for. It is usually the only thing on screen, so it
   *  names the subject rather than saying "Loading". */
  message: string
  /** Centre in the viewport rather than in the space the caller gives it: for
   *  a state that *is* the screen. */
  fill?: boolean
  /** Spinner and message side by side, for a state sitting inside a card or a
   *  dropdown rather than owning a page. */
  inline?: boolean
  size?: SpinnerSize
}

/** The one waiting state: a circular loader with what it is waiting for. */
export function LoadingState({ message, fill, inline, size = 'md' }: Props) {
  const classes = [styles.state, fill ? styles.fill : '', inline ? styles.inline : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} role="status" aria-live="polite">
      <Spinner size={size} />
      <span>{message}</span>
    </div>
  )
}
