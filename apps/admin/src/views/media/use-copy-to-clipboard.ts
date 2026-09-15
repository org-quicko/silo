import { useState } from 'react'
import { ToastManager } from '../../utils/toast-manager'

/** How long the button that was pressed keeps its tick — long enough to be
 *  seen, short enough that a second copy reads as a second copy. */
const AcknowledgementMs = 1500

/**
 * Copying to the clipboard, with both acknowledgements that go with it: the
 * app-wide toast, and a tick on the control that was pressed.
 *
 * One hook rather than the same four lines per button. Written as four lines
 * per button they drifted — the list view's copy link had ended up with
 * neither acknowledgement while the grid's had both, and nothing about either
 * call site said they were meant to agree.
 */
export function useCopyToClipboard(message: string) {
  const [copied, setCopied] = useState(false)

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), AcknowledgementMs)
    ToastManager.show(message)
  }

  return { copied, copy }
}
