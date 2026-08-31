import { ValidationError } from "@silo/shared/validation-error";
import { ConflictError } from "../../errors/conflict-error";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Renames or moves a folder — and every asset and descendant folder beneath
 * it (D49).
 *
 * No entry is touched and no blob moves. Assets are referenced by stable id
 * (D23) and blob keys are flat, content-free of organisation — the exact
 * property that makes a folder's own rename pure catalog metadata, carried
 * one level up: rewriting `folder` on every asset in the subtree is still
 * just a field, on records nothing else names by path.
 *
 * No cap on subtree size. A large rename holds the write lock for many
 * record writes — `docs/design/http-api.md` §8.1 names that cost rather than
 * inventing a limit that would leave a large library with no way to rename a
 * folder at all.
 *
 * No `Storage` adapter offers a transaction spanning that many records, so the
 * rename is **staged** exactly as a deletion is (D23): declare the move, apply
 * it, clear the declaration. A process that dies mid-move leaves the
 * `_media_folder_moves` marker behind and {@link resumePending} finishes the
 * job at the next start, which is why {@link apply} re-derives everything from
 * the paths and holds no state of its own — a replay has to be able to run
 * against a subtree that is already half-moved.
 *
 * The saga is what makes this recoverable; `options.merge` is a separate
 * decision about what a caller may ask for. Without it a collision at `to`
 * refuses (`ConflictError`); with it the subtree joins whatever already sits
 * at `to`, including same-named assets, which is legal — a filename is
 * display metadata, never addressing (D23).
 */
export class MediaFolderMoveService {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  async rename(
    fromInput: unknown,
    toInput: unknown,
    options?: { merge?: boolean }
  ): Promise<{ from: string; to: string }> {
    const from = MediaFolderMoveService.require(fromInput);
    const to = MediaFolderMoveService.require(toInput);
    const merge = options?.merge === true;

    return this.context.withWriteLock(async () => {
      if (MediaPaths.isWithin(to, from)) {
        throw new ValidationError(`cannot move "${from}" into itself or a descendant ("${to}")`);
      }

      const existing = await this.allPaths();
      if (!existing.has(from)) throw new NotFoundError(`folder "${from}" not found`);
      if (existing.has(to) && !merge) {
        throw new ConflictError(`folder "${to}" already exists`);
      }

      // A descendant's rewritten path is stored as a field and never passes
      // back through `normalizeFolder`, so a move under a deeper parent would
      // otherwise store paths past `MediaPaths.MaxDepth` — refused for a fresh
      // upload but reachable this way. Checked on the deepest one, before
      // anything is written, since a refusal part-way would leave the subtree
      // half-renamed. Unaffected by `merge`: joining an existing folder does
      // not change how deep the moved subtree ends up.
      MediaPaths.normalizeFolder(
        MediaFolderMoveService.moved(MediaFolderMoveService.deepestWithin(existing, from), from, to),
      );

      // Staged before the first write and cleared after the last, so the only
      // states a crash can leave are "no marker, nothing started" and "marker,
      // possibly half-applied" — never "half-applied and no record that it
      // was". Every refusal above happens first, so a marker never describes a
      // move that was not allowed.
      const marker = await this.catalog.putMove({ from, to });
      await this.apply(from, to);
      await this.catalog.deleteMove(marker);

      return { from, to };
    });
  }

  /**
   * Carries any move the process died partway through to completion (D49).
   * Called at startup, beside `MediaDeletionService.resumePending`.
   *
   * Failures are counted, never thrown: a rename staged days ago must not stop
   * the server booting, the same judgement the deletion saga's resume makes.
   */
  async resumePending(): Promise<{ finished: number; pending: number }> {
    return this.context.withWriteLock(async () => {
      let finished = 0;
      let pending = 0;

      for (const entry of await this.catalog.allMoves()) {
        const move = MediaCatalog.toMove(entry);
        if (!move) {
          // A marker naming nothing cannot be replayed, and leaving it would
          // make every future start retry a move it can never describe.
          await this.catalog.deleteMove(entry.id);
          continue;
        }
        try {
          await this.apply(move.from, move.to);
          await this.catalog.deleteMove(entry.id);
          finished++;
        } catch {
          pending++;
        }
      }

      return { finished, pending };
    });
  }

  /**
   * The record rewrites themselves — step 2 of the saga, and **idempotent**,
   * which is what lets a replay run against a subtree that is already
   * partly moved: it selects by "still within `from`", so anything already at
   * `to` is simply not selected. Assumes the caller holds the write lock and
   * has already validated the move.
   */
  private async apply(from: string, to: string): Promise<void> {
    const folders = await this.catalog.allFolders();
    // Which paths already hold an explicit record, kept current as the loop
    // writes: `putFolder` mints a fresh id, so putting one for a path that
    // already has a record would leave two records naming one folder —
    // invisible in `MediaFolderService.list`, which dedupes through a `Set`,
    // and accumulating on every merge into the same destination.
    const explicit = new Set(folders.map((entry) => MediaCatalog.folderOf(entry)));

    for (const entry of folders) {
      const path = MediaCatalog.folderOf(entry);
      if (MediaPaths.isWithin(path, from)) {
        const destination = MediaFolderMoveService.moved(path, from, to);
        // Put the moved record before deleting the old one, so a crash between
        // the two calls leaves *both* records rather than neither: a harmless
        // duplicate on the read side, never a vanished record. Skipped when the
        // destination already has one, which is both the merge case and the
        // replay case — the record the delete would be racing already stands.
        if (!explicit.has(destination)) {
          await this.catalog.putFolder(destination);
          explicit.add(destination);
        }
        await this.catalog.deleteFolder(entry.id);
      }
    }

    // One write per asset, to its own unchanged id — never a delete followed
    // by a put — so there is no analogous loss window here.
    for (const entry of await this.catalog.allAssets()) {
      const asset = MediaCatalog.toAsset(entry);
      if (MediaPaths.isWithin(asset.folder, from)) {
        await this.catalog.putAsset(entry.id, {
          ...asset,
          folder: MediaFolderMoveService.moved(asset.folder, from, to),
        });
      }
    }
  }

  /** Every explicit-or-implied folder path, including ancestors — the same
   *  existence rule `MediaFolderService.list` computes, duplicated rather
   *  than shared because it needs no ancestor bookkeeping beyond membership. */
  private async allPaths(): Promise<Set<string>> {
    const paths = new Set<string>();
    for (const entry of await this.catalog.allFolders()) {
      for (const ancestor of MediaPaths.ancestors(MediaCatalog.folderOf(entry))) paths.add(ancestor);
    }
    for (const entry of await this.catalog.allAssets()) {
      for (const ancestor of MediaPaths.ancestors(MediaCatalog.toAsset(entry).folder)) paths.add(ancestor);
    }
    return paths;
  }

  /** The deepest path at or under `folderPath`, whose rewrite is the one that
   *  hits the depth ceiling first. */
  private static deepestWithin(paths: ReadonlySet<string>, folderPath: string): string {
    let deepest = folderPath;
    let depth = MediaPaths.ancestors(folderPath).length;
    for (const path of paths) {
      if (!MediaPaths.isWithin(path, folderPath)) continue;
      const candidate = MediaPaths.ancestors(path).length;
      if (candidate > depth) {
        deepest = path;
        depth = candidate;
      }
    }
    return deepest;
  }

  /** `path` (which is `from` or a descendant of it) rewritten onto `to`. */
  private static moved(path: string, from: string, to: string): string {
    return path === from ? to : to + path.slice(from.length);
  }

  private static require(folderPath: unknown): string {
    const normalized = MediaPaths.normalizeFolder(folderPath);
    if (!normalized) throw new ValidationError("folder path is required");
    return normalized;
  }
}
