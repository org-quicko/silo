import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { router } from './router'

/**
 * An anchor that navigates in-app. Rendering a real `href` is the point: the
 * target shows in the status bar, and ⌘/ctrl/middle-click still opens a new
 * tab (the modifier checks below bail out and let the browser handle it).
 */
export function Link({
  to,
  replace = false,
  className,
  style,
  title,
  children,
  onNavigate,
  'aria-current': ariaCurrent,
}: {
  to: string
  replace?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  children: ReactNode
  onNavigate?: () => void
  /** Set to `"page"` on the link representing the view already open. */
  'aria-current'?: 'page'
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onNavigate?.()
    router.navigate(to, { replace })
  }
  return (
    <a href={to} className={className} style={style} title={title} aria-current={ariaCurrent} onClick={onClick}>
      {children}
    </a>
  )
}
