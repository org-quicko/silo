import { useEffect, useRef, useState } from 'react'
import { ArrowDownAZ, Braces, Check, Copy, Maximize2, Minimize2, WrapText } from 'lucide-react'
import styles from './JsonToolbar.module.css'

export interface JsonToolbarProps {
  text: string
  locked?: boolean
  invalid?: boolean
  empty?: boolean
  lineWrap?: boolean
  onFormat?: () => void
  onMinify?: () => void
  onSortKeys?: () => void
  onToggleWrap?: () => void
  onExpand?: () => void
  showCopy?: boolean
}

/**
 * Compact toolbar of non-submitting (`type="button"`) actions for JSON editors:
 * format, compact, sort keys, wrap toggle, copy, and expand.
 */
export function JsonToolbar({
  text,
  locked = false,
  invalid = false,
  empty = false,
  lineWrap = false,
  onFormat,
  onMinify,
  onSortKeys,
  onToggleWrap,
  onExpand,
  showCopy = true,
}: JsonToolbarProps) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const mutateDisabled = locked || invalid || empty

  const handleCopy = () => {
    if (empty || typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setCopied(false)
      }, 1500)
    })
  }

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="JSON actions">
      {onFormat && (
        <button
          type="button"
          className={styles.action}
          disabled={mutateDisabled}
          title="Format JSON (pretty-print)"
          onClick={onFormat}
        >
          <Braces size={12} />
          <span>Format</span>
        </button>
      )}
      {onMinify && (
        <button
          type="button"
          className={styles.action}
          disabled={mutateDisabled}
          title="Compact JSON onto one line"
          onClick={onMinify}
        >
          <Minimize2 size={12} />
          <span>Compact</span>
        </button>
      )}
      {onSortKeys && (
        <button
          type="button"
          className={styles.action}
          disabled={mutateDisabled}
          title="Sort object keys alphabetically"
          onClick={onSortKeys}
        >
          <ArrowDownAZ size={12} />
          <span>Sort keys</span>
        </button>
      )}
      {onToggleWrap && (
        <button
          type="button"
          className={`${styles.action} ${lineWrap ? styles.active : ''}`}
          aria-pressed={lineWrap}
          title="Toggle line wrapping"
          onClick={onToggleWrap}
        >
          <WrapText size={12} />
          <span>Wrap</span>
        </button>
      )}
      {showCopy && (
        <button
          type="button"
          className={`${styles.action} ${copied ? styles.copied : ''}`}
          disabled={empty}
          title="Copy JSON to clipboard"
          onClick={handleCopy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      )}
      {onExpand && (
        <button
          type="button"
          className={styles.action}
          title="Open expanded editor"
          onClick={onExpand}
        >
          <Maximize2 size={12} />
          <span>Expand</span>
        </button>
      )}
    </div>
  )
}
