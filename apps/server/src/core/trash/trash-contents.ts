/**
 * What rode along with an explicitly deleted thing, counted once at delete
 * time so drawing the trash list never counts anything.
 */
export interface TrashContents {
  collections: number;
  entries: number;
  assets: number;
  bytes: number;
}

export class TrashContentsUtils {
  static empty(): TrashContents {
    return { collections: 0, entries: 0, assets: 0, bytes: 0 };
  }

  static add(into: TrashContents, other: Partial<TrashContents>): TrashContents {
    into.collections += other.collections ?? 0;
    into.entries += other.entries ?? 0;
    into.assets += other.assets ?? 0;
    into.bytes += other.bytes ?? 0;
    return into;
  }
}
