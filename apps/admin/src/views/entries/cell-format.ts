import { MediaField } from '@silo/shared/media-field'

/**
 * Pure value-shaping for `CellValue` (handoff 1e), split out of the rendering
 * component so the "what does this schema/value pair mean" logic can be
 * tested and read without JSX in the way.
 */
export class CellFormat {
  /**
   * Mirrors the widget heuristic `forms/build-ui-schema.ts` uses to pick the
   * media widget: the `x-silo-type` keyword, or a `ui:widget`/format hint the
   * schema editor also treats as media. Both sides need to agree on what
   * counts, or a field editable as media would list as a plain string.
   */
  static isMediaField(prop: any): boolean {
    if (!prop) return false
    if (MediaField.is(prop)) return true
    const widget = prop['x-silo-ui']?.widget
    if (widget === 'media') return true
    return prop.type === 'string' && prop.format === 'uri' && widget === 'media'
  }

  /** Roughly a line's worth of characters — past this a string is prose, not a value. */
  static readonly LongTextChars = 80

  /** Body text rather than a short value: long enough to be prose, or declared as media. */
  static isLongText(prop: any, value: string): boolean {
    return value.length > CellFormat.LongTextChars || typeof prop?.contentMediaType === 'string'
  }

  /** `https://silo.dev/docs/pricing?x=1` → `silo.dev/docs/pricing` — scheme dropped, query dropped, path kept. */
  static formatUri(raw: string): string {
    try {
      const u = new URL(raw)
      const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
      return u.host + path
    } catch {
      return raw
    }
  }

  /**
   * The `oneOf`/`anyOf` branch a value matches, by its `title` — or `null`
   * when no branch can be told apart, which is the caller's cue to fall back
   * to a bare key count instead of guessing.
   */
  static matchBranch(prop: any, value: Record<string, unknown>): string | null {
    const branches: any[] = prop?.oneOf ?? prop?.anyOf
    if (!Array.isArray(branches) || branches.length === 0) return null

    // A branch whose full `required` list is present is an exact match.
    for (const b of branches) {
      const required: string[] = Array.isArray(b?.required) ? b.required : []
      if (required.length > 0 && required.every((k) => value[k] !== undefined) && b.title) {
        return b.title
      }
    }
    // No branch declares `required` (or none matched fully) — fall back to
    // whichever branch's declared properties overlap the value the most.
    let best: any = null
    let bestScore = 0
    for (const b of branches) {
      const props = Object.keys(b?.properties ?? {})
      const score = props.filter((k) => value[k] !== undefined).length
      if (score > bestScore) {
        bestScore = score
        best = b
      }
    }
    return best?.title ?? null
  }

  /** How many fraction digits a `multipleOf` implies — `0.01` → 2, `5` → 0. */
  static decimalsFromMultipleOf(multipleOf: unknown): number | null {
    if (typeof multipleOf !== 'number' || !Number.isFinite(multipleOf) || multipleOf <= 0) return null
    const text = String(multipleOf)
    const dot = text.indexOf('.')
    return dot === -1 ? 0 : text.length - dot - 1
  }

  static formatNumber(value: number, multipleOf: unknown): string {
    const decimals = CellFormat.decimalsFromMultipleOf(multipleOf)
    return decimals === null
      ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }

  /** Relative under a week, an absolute short date after — the table-cell twin of `Formatters.relativeTime`. */
  static smartDate(iso: string): string {
    const then = new Date(iso)
    const ms = then.getTime()
    if (Number.isNaN(ms)) return ''
    const days = (Date.now() - ms) / 86_400_000
    if (Math.abs(days) < 7) {
      const s = Math.round((Date.now() - ms) / 1000)
      const abs = Math.abs(s)
      if (abs < 45) return 'just now'
      const m = Math.round(abs / 60)
      if (m < 60) return s > 0 ? `${m}m ago` : `in ${m}m`
      const h = Math.round(m / 60)
      if (h < 24) return s > 0 ? `${h}h ago` : `in ${h}h`
      const d = Math.round(h / 24)
      return s > 0 ? `${d}d ago` : `in ${d}d`
    }
    return then.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  }
}
