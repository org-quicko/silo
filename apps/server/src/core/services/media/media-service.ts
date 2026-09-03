import type { Entry } from "../../domain/entry";
import type { MediaAssetView } from "../../media/media-asset-view";
import type { MediaLinks } from "../../media/media-links";
import type { MediaBytes } from "../../media/media-bytes";
import type { MediaQuery } from "../../media/media-query";
import type { MediaReconcileResult } from "../../media/media-reconcile-result";
import type { MediaUsage } from "../../media/media-usage";
import type { ServiceContext } from "../support/service-context";
import type { MediaAssetPatchInput } from "./media-asset-patch";
import {
  MediaAssetService,
  type MediaAssetPage,
  type MediaUsageVisibility,
} from "./media-asset-service";
import { MediaCatalogStore } from "./media-catalog-store";
import { MediaDelivery } from "./media-delivery";
import { MediaDeletionService } from "./media-deletion-service";
import { MediaFolderMoveService } from "./media-folder-move-service";
import { MediaFolderService } from "./media-folder-service";
import { MediaLinkResolver } from "./media-link-resolver";
import type { MediaForceReach } from "./media-usage-scopes";
import { MediaUsageScopes } from "./media-usage-scopes";
import type { MediaPurgeOutcome, MediaPurgeResult } from "./media-purge-service";
import { MediaPurgeService } from "./media-purge-service";
import { MediaReconciler } from "./media-reconciler";
import { MediaReferenceGuard } from "./media-reference-guard";
import { MediaUsageCounter } from "./media-usage-counter";

/**
 * The media library (D23), instance-global: one library for the whole server,
 * not one per project/env, and `media:*` stays unscoped.
 *
 * A facade over collaborators, so callers see one media surface rather than
 * having to know which of them owns a given verb.
 */
export class MediaService {
  private readonly assets: MediaAssetService;
  private readonly delivery: MediaDelivery;
  private readonly folders: MediaFolderService;
  private readonly folderMove: MediaFolderMoveService;
  private readonly deletion: MediaDeletionService;
  private readonly reconciler: MediaReconciler;
  private readonly linkResolver: MediaLinkResolver;
  private readonly usageScopes: MediaUsageScopes;
  private readonly purgeService: MediaPurgeService;

  /** The entry write path checks new references through this (§8.1). */
  readonly referenceGuard: MediaReferenceGuard;

  constructor(context: ServiceContext) {
    const catalog = new MediaCatalogStore(context);

    this.assets = new MediaAssetService(context, catalog, new MediaUsageCounter(context));
    this.delivery = new MediaDelivery(context, catalog);
    this.folders = new MediaFolderService(context, catalog);
    this.folderMove = new MediaFolderMoveService(context, catalog);
    this.deletion = new MediaDeletionService(context, catalog);
    this.reconciler = new MediaReconciler(context, catalog, this.deletion);
    this.referenceGuard = new MediaReferenceGuard(catalog);
    this.linkResolver = new MediaLinkResolver(context, catalog);
    this.usageScopes = new MediaUsageScopes(context, catalog);
    this.purgeService = new MediaPurgeService(context, catalog);
  }

  /**
   * How this response should render media references (D46).
   *
   * Every route that resolves media fields calls this first and passes the
   * result to `EntryUtils.toApiResponse`, rather than passing an origin string:
   * the answer depends on `[media]`, and — always, since D48 — on the catalog,
   * which is also what lets a reference to a force-deleted asset resolve to
   * `null` instead of a link that 404s.
   */
  links(requestBase: string, payload: unknown): Promise<MediaLinks> {
    return this.linkResolver.forPayload(requestBase, payload);
  }

  list(query: MediaQuery = {}): Promise<MediaAssetPage> {
    return this.assets.list(query);
  }

  get(id: string): Promise<MediaAssetView> {
    return this.assets.get(id);
  }

  /** Every distinct file extension in the library — the admin's Type filter
   *  menu (D51). */
  listExtensions(): Promise<string[]> {
    return this.assets.listExtensions();
  }

  usages(
    id: string,
    page: { limit?: number; offset?: number } = {},
    visibility?: MediaUsageVisibility
  ): Promise<{ items: MediaUsage[]; total: number; visible: number; visibleCapped: boolean }> {
    return this.assets.usages(id, page, visibility);
  }

  save(
    originalName: string,
    fileData: Uint8Array,
    mimeType?: string,
    folder?: string
  ): Promise<MediaAssetView> {
    return this.assets.save(originalName, fileData, mimeType, folder);
  }

  update(id: string, patch: MediaAssetPatchInput): Promise<MediaAssetView> {
    return this.assets.update(id, patch);
  }

  bytes(idOrKey: string): Promise<MediaBytes | null> {
    return this.delivery.bytes(idOrKey);
  }

  /** `force` skips the usage check and deletes over a live reference (D48). */
  delete(id: string, options?: { force?: boolean }): Promise<void> {
    return this.deletion.delete(id, options);
  }

  /** Finishes any folder move the process died partway through (D49). */
  resumePendingFolderMoves(): Promise<{ finished: number; pending: number }> {
    return this.folderMove.resumePending();
  }

  resumePendingDeletions(): Promise<{ finished: number; pending: number }> {
    return this.deletion.resumePending();
  }

  listFolders(): Promise<string[]> {
    return this.folders.list();
  }

  createFolder(folderPath: unknown): Promise<string> {
    return this.folders.create(folderPath);
  }

  deleteFolder(folderPath: unknown): Promise<void> {
    return this.folders.delete(folderPath);
  }

  /** Renames or moves a folder, its descendant folders, and every asset
   *  within — no entry touched, no blob moved (D49). `merge` allows the move
   *  into an existing folder instead of refusing on collision — the opt-in
   *  that finishes an interrupted rename as well as an ordinary merge. */
  renameFolder(from: unknown, to: unknown, options?: { merge?: boolean }): Promise<{ from: string; to: string }> {
    return this.folderMove.rename(from, to, options);
  }

  /** Every asset in `folderPath`'s subtree, for a recursive folder delete's
   *  force-authority check and its delete loop, both run by `MediaFolderRoutes`
   *  before either touches the catalog (D49). */
  async folderAssetIds(folderPath: unknown): Promise<string[]> {
    return (await this.folders.assetsWithin(folderPath)).map((entry: Entry) => entry.id);
  }

  /** Removes every explicit folder record at or beneath `folderPath` — called
   *  by `MediaFolderRoutes` once a recursive delete confirms the subtree is
   *  actually empty (D49). */
  finishFolderDeletion(folderPath: unknown): Promise<number> {
    return this.folders.deleteRecordsWithin(folderPath);
  }

  reconcile(): Promise<MediaReconcileResult> {
    return this.reconciler.run();
  }

  /** The true, unfiltered scopes a media force-delete of `ids` would reach
   *  (D49) — what `RouteAuth.requireForcedMediaDelete` checks claims against. */
  forceReach(ids: readonly string[]): Promise<MediaForceReach> {
    return this.usageScopes.reach(ids);
  }

  /** Empties the whole library: every catalog asset, then every folder record
   *  (D49). `requireForce` and `deleteBatch` are the http layer's own
   *  concerns, injected rather than imported across the boundary. */
  purge(
    force: boolean,
    requireForce: (ids: string[]) => Promise<void>,
    deleteBatch: (ids: string[], force: boolean) => Promise<MediaPurgeOutcome>
  ): Promise<MediaPurgeResult> {
    return this.purgeService.run(force, requireForce, deleteBatch);
  }
}
