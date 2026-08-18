// Small display helpers shared across views.
export class Formatters {
  static relativeTime(iso: string): string {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return ''
    const s = Math.floor((Date.now() - then) / 1000)
    if (s < 45) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d}d ago`
    const mo = Math.floor(d / 30)
    if (mo < 12) return `${mo}mo ago`
    return `${Math.floor(mo / 12)}y ago`
  }

  static shortDate(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
  }

  static shortId(id: string): string {
    if (id.length <= 12) return id
    return id.slice(0, 8) + '…' + id.slice(-3)
  }

}
