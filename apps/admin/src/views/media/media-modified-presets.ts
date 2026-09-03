export type ModifiedPresetKey = 'today' | '7d' | '30d' | 'this_year' | 'last_year'

/** Inclusive-after, exclusive-before ISO-8601 bounds a "Modified" pick sends
 *  the server as `modified_after`/`modified_before` (D55) — plus the label
 *  the filter pill shows for it. */
export interface ModifiedRange {
  label: string
  after?: string
  before?: string
}

/** The "Modified" filter's fixed presets and its custom range, both reduced
 *  to the same `{after, before}` shape `use-media-library` sends the server —
 *  the filter only ever needs to know a range, never which preset made it. */
export class MediaModifiedPresets {
  static readonly Options: { key: ModifiedPresetKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'this_year', label: `This year (${new Date().getFullYear()})` },
    { key: 'last_year', label: `Last year (${new Date().getFullYear() - 1})` },
  ]

  static range(key: ModifiedPresetKey): ModifiedRange {
    const now = new Date()
    switch (key) {
      case 'today':
        return { label: 'Today', after: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }
      case '7d':
        return { label: 'Last 7 days', after: new Date(now.getTime() - 7 * 86400_000).toISOString() }
      case '30d':
        return { label: 'Last 30 days', after: new Date(now.getTime() - 30 * 86400_000).toISOString() }
      case 'this_year':
        return { label: `This year (${now.getFullYear()})`, after: new Date(now.getFullYear(), 0, 1).toISOString() }
      case 'last_year': {
        const year = now.getFullYear() - 1
        return {
          label: `Last year (${year})`,
          after: new Date(year, 0, 1).toISOString(),
          before: new Date(year + 1, 0, 1).toISOString(),
        }
      }
    }
  }

  /** `from`/`to` are `<input type="date">` values (`yyyy-mm-dd`); `before` is
   *  pushed to the start of the day *after* `to` so the picked day is fully
   *  included despite the bound being exclusive. */
  static custom(from: string, to: string): ModifiedRange {
    const before = new Date(`${to}T00:00:00`)
    before.setDate(before.getDate() + 1)
    return {
      label: from === to ? from : `${from} – ${to}`,
      after: new Date(`${from}T00:00:00`).toISOString(),
      before: before.toISOString(),
    }
  }
}
