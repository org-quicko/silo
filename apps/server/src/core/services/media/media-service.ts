import type { MediaAssetView } from "../../media/media-asset-view";
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
import { MediaFolderService } from "./media-folder-service";
import { MediaReconciler } from "./media-reconciler";
import { MediaReferenceGuard } from "./media-reference-guard";
import { MediaUsageCounter } from "./media-usage-counter";

/**
 * The media library (D23), instance-global: one library for the whole server,
 * not one per project/env, and `media:*` stays unscoped.
 *
 * A facade over six collaborators, so callers see one media surface rather than
 * having to know which of them owns a given verb.
 */
export class MediaService {
  private readonly assets: MediaAssetService;
  private readonly delivery: MediaDelivery;
  private readonly folders: MediaFolderService;
  private readonly deletion: MediaDeletionService;
  private readonly reconciler: MediaReconciler;

  /** The entry write path checks new references through this (§8.1). */
  readonly referenceGuard: MediaReferenceGuard;

  constructor(context: ServiceContext) {
    const catalog = new MediaCatalogStore(context);

    this.assets = new MediaAssetService(context, catalog, new MediaUsageCounter(context));
    this.delivery = new MediaDelivery(context, catalog);
    this.folders = new MediaFolderService(context, catalog);
    this.deletion = new MediaDeletionService(context, catalog);
    this.reconciler = new MediaReconciler(context, catalog, this.deletion);
    this.referenceGuard = new MediaReferenceGuard(catalog);
  }

  list(query: MediaQuery = {}): Promise<MediaAssetPage> {
    return this.assets.list(query);
  }

  get(id: string): Promise<MediaAssetView> {
    return this.assets.get(id);
  }

  usages(
    id: string,
    page: { limit?: number; offset?: number } = {},
    visibility?: MediaUsageVisibility
  ): Promise<{ items: MediaUsage[]; total: number; visible: number }> {
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

  delete(id: string): Promise<void> {
    return this.deletion.delete(id);
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

  reconcile(): Promise<MediaReconcileResult> {
    return this.reconciler.run();
  }
}
