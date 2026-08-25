import path from "path";
import { MediaRefs } from "../../../core/media/media-refs";
import type { MediaUsage } from "../../../core/media/media-usage";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";

/**
 * Media references, derived by scanning rather than indexed (D23).
 *
 * Every entry file in the tree is read once and run through the one shared
 * extractor, so this adapter and SQLite cannot disagree about what counts as a
 * reference. System collections are included: `_keys` holds no media, but an
 * entry is an entry, and excluding a collection here would be a silent hole in
 * the delete guard.
 */
export class FsMediaUsageScanner {
  /** Matches the default page size the media routes ask for. */
  private static readonly FallbackLimit = 50;

  private readonly layout: FsLayout;

  constructor(layout: FsLayout) {
    this.layout = layout;
  }

  async list(
    mediaIds: string[],
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: MediaUsage[]; total: number }> {
    if (mediaIds.length === 0) return { items: [], total: 0 };

    const all = await this.scan(new Set(mediaIds));
    const limit =
      page.limit === undefined ? FsMediaUsageScanner.FallbackLimit : Math.max(0, page.limit);
    const offset = Math.max(0, page.offset || 0);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async count(mediaIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (mediaIds.length === 0) return counts;

    for (const usage of await this.scan(new Set(mediaIds))) {
      counts.set(usage.media_id, (counts.get(usage.media_id) || 0) + 1);
    }
    return counts;
  }

  private async scan(wanted: Set<string>): Promise<MediaUsage[]> {
    const found: MediaUsage[] = [];
    const projectsDir = this.layout.projectsDir;

    for (const project of await FsFiles.readSubdirs(projectsDir, true)) {
      for (const env of await FsFiles.readSubdirs(path.join(projectsDir, project), true)) {
        const contentDir = path.join(projectsDir, project, env, "content");

        for (const collection of await FsFiles.readSubdirs(contentDir, true)) {
          await FsMediaUsageScanner.scanCollection(
            path.join(contentDir, collection),
            { project, env, collection },
            wanted,
            found
          );
        }
      }
    }

    return FsMediaUsageScanner.sorted(found);
  }

  private static async scanCollection(
    collectionDir: string,
    at: { project: string; env: string; collection: string },
    wanted: Set<string>,
    found: MediaUsage[]
  ): Promise<void> {
    for (const file of await FsFiles.readNames(collectionDir)) {
      const entryId = FsLayout.idOfEntryFile(file);
      if (entryId === null) continue;

      // A torn or hand-edited file is not a reference.
      const parsed = await FsFiles.readJsonOrNull(path.join(collectionDir, file));
      if (parsed === null) continue;

      for (const token of MediaRefs.extract(parsed?.data)) {
        if (wanted.has(token)) found.push({ media_id: token, ...at, entry_id: entryId });
      }
    }
  }

  private static sorted(usages: MediaUsage[]): MediaUsage[] {
    return usages.sort(
      (left, right) =>
        left.project.localeCompare(right.project) ||
        left.env.localeCompare(right.env) ||
        left.collection.localeCompare(right.collection) ||
        left.entry_id.localeCompare(right.entry_id)
    );
  }
}
