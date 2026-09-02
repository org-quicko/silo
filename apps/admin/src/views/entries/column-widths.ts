const STORAGE_KEY = 'silo_column_widths'

/**
 * The entries table's column widths, per (server, project, env, collection).
 *
 * A width is one reader's ergonomics on one screen rather than part of what the
 * view means, so it stays out of the URL that carries the search, the filter,
 * the sort and the column selection: a link should open the same *view*, not
 * impose the sender's column widths on it.
 *
 * A column nobody has dragged has no entry here at all and keeps the table's
 * own proportional track, which is what lets a resized table still fill the
 * width it is given.
 */
export class ColumnWidths {
  /** Narrow enough to park a column out of the way, wide enough to grab again. */
  static readonly Min = 72
  /** The trailing row-menu cell, which is fixed and never resizable. */
  static readonly Actions = 44
  /** The label column is the entry's own, so it has no schema property to be keyed by. */
  static readonly PrimaryKey = '$primary'

  static key(serverId: string, project: string, env: string, collection: string): string {
    return `${serverId}/${project}/${env}/${collection}`
  }

  /** `grid-template-columns` for the whole row: label, the chosen columns, updated, actions. */
  static template(extra: readonly string[], widths: Record<string, number>): string {
    const track = (name: string, flex: string) => {
      const width = widths[name]
      return typeof width === 'number' ? `${width}px` : `minmax(0,${flex})`
    }
    return [
      track(ColumnWidths.PrimaryKey, '1.9fr'),
      ...extra.map((name) => track(name, '1fr')),
      'minmax(0,0.8fr)',
      `${ColumnWidths.Actions}px`,
    ].join(' ')
  }

  /**
   * The widest this column may be dragged: everything else keeps `Min`, so a
   * drag can crowd its neighbours but never push a column off the table. The
   * table has no horizontal scroll, so a width it cannot fit is a width lost.
   */
  static max(containerWidth: number, dataColumns: number): number {
    const others = Math.max(0, dataColumns - 1)
    return Math.max(ColumnWidths.Min, containerWidth - ColumnWidths.Actions - ColumnWidths.Min * others)
  }

  static clamp(width: number, max: number): number {
    return Math.round(Math.min(Math.max(width, ColumnWidths.Min), Math.max(max, ColumnWidths.Min)))
  }

  /** Stored widths for one table. Anything unreadable is dropped rather than repaired: the column simply goes back to its default track. */
  static read(key: string): Record<string, number> {
    const stored = ColumnWidths.readAll()[key]
    if (!stored || typeof stored !== 'object') return {}
    const widths: Record<string, number> = {}
    for (const [name, width] of Object.entries(stored)) {
      if (typeof width === 'number' && Number.isFinite(width) && width >= ColumnWidths.Min) widths[name] = Math.round(width)
    }
    return widths
  }

  static write(key: string, widths: Record<string, number>): void {
    const all = ColumnWidths.readAll()
    if (Object.keys(widths).length === 0) delete all[key]
    else all[key] = widths
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // A full or blocked store costs a preference, never the table.
    }
  }

  private static readAll(): Record<string, Record<string, number>> {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
}
