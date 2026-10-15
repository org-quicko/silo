import type { TrashActor, TrashItem, TrashKind } from '../../api/types/trash-item'

/** The words the trash page says. Kept together so the list, the row and the
 *  dialogs cannot drift apart. */
export class TrashLabels {
  static readonly kinds: Record<TrashKind, string> = {
    project: 'Project',
    environment: 'Environment',
    collection: 'Collection',
    entry: 'Entry',
    media: 'Media',
    media_folder: 'Folder',
  }

  /** The origin, as the breadcrumb a row prints. Empty when the thing had no
   *  container, which only a project has. */
  static origin(item: TrashItem): string[] {
    if (item.kind === 'media' || item.kind === 'media_folder') {
      return item.origin.folder ? [item.origin.folder] : ['Library root']
    }
    return [item.origin.project_name, item.origin.env_name, item.origin.collection_name].filter(
      (segment): segment is string => Boolean(segment),
    )
  }

  /**
   * What rode along, and its size.
   *
   * A leaf gets its size alone: an entry row reading "1 entry" is counting
   * itself, which says nothing. The counts exist to tell a reader that one row
   * stands for many things, so they only appear where that is true.
   */
  static contents(item: TrashItem): string {
    const { contents } = item
    const parts: string[] = []
    if (item.kind !== 'entry' && item.kind !== 'media') {
      if (contents.collections > 1) {
        parts.push(TrashLabels.count(contents.collections, 'collection'))
      }
      if (contents.entries > 0) parts.push(TrashLabels.count(contents.entries, 'entry', 'entries'))
      if (contents.assets > 0) parts.push(TrashLabels.count(contents.assets, 'file'))
    }
    if (contents.bytes > 0) parts.push(TrashLabels.bytes(contents.bytes))
    return parts.join(' · ')
  }

  static actor(actor: TrashActor): string {
    if (actor.kind === 'cli') return 'the command line'
    if (actor.kind === 'system') return 'silo'
    return actor.label || 'a key'
  }

  /** "2 hours ago", "yesterday", "3 days ago". Relative because the question a
   *  trash row answers is how recent, not when exactly; the exact stamp is on
   *  the title attribute. */
  static since(iso: string): string {
    const elapsed = Date.now() - Date.parse(iso)
    if (!Number.isFinite(elapsed)) return iso
    const minutes = Math.floor(elapsed / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return TrashLabels.count(minutes, 'minute') + ' ago'
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return TrashLabels.count(hours, 'hour') + ' ago'
    const days = Math.floor(hours / 24)
    if (days === 1) return 'yesterday'
    return TrashLabels.count(days, 'day') + ' ago'
  }

  /** "in 28d", or "kept" when retention is off for this instance. */
  static expiry(iso: string | null): string {
    if (!iso) return 'kept'
    const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)
    if (!Number.isFinite(days)) return 'kept'
    if (days <= 0) return 'due'
    return `in ${days}d`
  }

  static bytes(value: number): string {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = value
    let unit = 0
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024
      unit += 1
    }
    return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`
  }

  private static count(value: number, singular: string, plural = `${singular}s`): string {
    return `${value} ${value === 1 ? singular : plural}`
  }
}
