import { X } from 'lucide-react'

interface Props {
  /** Empty hides the notice, which is how each of the library's message
   *  states doubles as its own visibility flag. */
  message: string
  className: string
  onDismiss: () => void
}

/**
 * One dismissible message above the library's contents.
 *
 * The library keeps three of these in separate state cells on purpose: a
 * staged deletion, a delete that found nothing, and an ordinary failure are
 * cleared at different times, and `reload` blanking one must not blank the
 * others. Only the tone differs, so the markup lives here once.
 */
export function MediaNotice({ message, className, onDismiss }: Props) {
  if (!message) return null

  return (
    <div className={className}>
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  )
}
