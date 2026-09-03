import crypto from "crypto";
import type { Filter } from "@silo/shared/filter";
import { EntryUtils } from "../../domain/entry-utils";
import { ConflictError } from "../../errors/conflict-error";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaExtensions } from "../../media/media-extensions";
import { MediaLinks } from "../../media/media-links";
import { MediaPaths } from "../../media/media-paths";
import { MimeUtils } from "../../media/mime-utils";
import type { MediaAsset } from "../../media/media-asset";
import type { MediaAssetView } from "../../media/media-asset-view";
import type { MediaQuery } from "../../media/media-query";
import type { MediaUsage } from "../../media/media-usage";
import { QueryUtils } from "../../query/query-utils";
import type { SortKey } from "../../query/sort-key";
import type { ServiceContext } from "../support/service-context";
import { MediaAssetPatch, type MediaAssetPatchInput } from "./media-asset-patch";
import { MediaCatalogStore } from "./media-catalog-store";
import { MediaFilter } from "./media-filter";
import { MediaSortOrder } from "./media-sort-order";
import type { MediaUsageCounter } from "./media-usage-counter";
import { MediaUsageScopes } from "./media-usage-scopes";

/** Decides which referring entries a caller may see, so a scoped key learns
 *  that a file is in use without learning where (§8.1). */
export type MediaUsageVisibility = (
  project: string,
  env: string,
  collection: string
) => boolean;

/** One page of the media library. */
export interface MediaAssetPage {
  items: MediaAssetView[];
  total: number;
  limit: number;
  offset: number;
}

/** Uploading, searching, reading and editing catalog records. Nothing here
 *  deletes; that saga lives in `MediaDeletionService`. */
export class MediaAssetService {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;
  private readonly usageCounter: MediaUsageCounter;

  constructor(
    context: ServiceContext,
    catalog: MediaCatalogStore,
    usageCounter: MediaUsageCounter
  ) {
    this.context = context;
    this.catalog = catalog;
    this.usageCounter = usageCounter;
  }

  /** Searches the catalog. Paging comes from `Storage.list` unchanged. */
  async list(query: MediaQuery = {}): Promise<MediaAssetPage> {
    const folder =
      query.folder === undefined ? undefined : MediaPaths.normalizeFolder(query.folder);
    const filter = MediaFilter.build(query, folder);

    const limit = QueryUtils.normalizeQuery({ limit: query.limit }).limit;
    const offset = Math.max(0, query.offset || 0);
    const sort = MediaSortOrder.parse(query.sort);

    // A recursive filter rooted at "" matches everything, so it is no filter at
    // all — taking the in-memory path for it would load the whole catalog to
    // page the library's default view.
    if (folder && query.recursive) {
      return this.listRecursive(filter, sort, folder, limit, offset);
    }

    const page = await this.catalog.listAssets({ filter, sort, limit, offset });
    return {
      items: await this.usageCounter.withCounts(page.items),
      total: page.total,
      limit,
      offset,
    };
  }

  async get(id: string): Promise<MediaAssetView> {
    const [view] = await this.usageCounter.withCounts([await this.catalog.asset(id)]);
    return view;
  }

  /** Every distinct extension actually in the library, lower case and sorted
   *  — the Type filter's menu is built from what is really there rather than
   *  a fixed list that drifts from it. Same unbounded `allAssets` scan
   *  `MediaFolderService.list` already takes over the whole catalog. */
  async listExtensions(): Promise<string[]> {
    const extensions = new Set<string>();
    for (const entry of await this.catalog.allAssets()) {
      const extension = MediaExtensions.of(MediaCatalog.toAsset(entry).filename);
      if (extension) extensions.add(extension);
    }
    return [...extensions].sort();
  }

  /**
   * Referrers of an asset. Instance-global media meets scoped entries here: the
   * caller gets the true total but only the rows `visibility` admits (§8.1).
   *
   * `visible` is the true count of referrers the caller may read — how many
   * fit on the `page` requested is a different question, answered by
   * `items.length`. Before this it was `items.length` for both, which made
   * `visible` mean "how many happened to fit on the page" rather than what
   * its name and the docs promise, and let any asset with more referrers
   * than one page could hold look under-visible even when every referrer was
   * readable (D49 audit fix).
   */
  async usages(
    id: string,
    page: { limit?: number; offset?: number } = {},
    visibility?: MediaUsageVisibility
  ): Promise<{ items: MediaUsage[]; total: number; visible: number; visibleCapped: boolean }> {
    const entry = await this.catalog.asset(id);
    const tokens = MediaCatalog.tokens(entry.id, MediaCatalog.toAsset(entry).blob_key);
    const found = await this.context.store.listMediaUsages(tokens, page);

    const items = visibility
      ? found.items.filter((usage) => visibility(usage.project, usage.env, usage.collection))
      : found.items;

    if (!visibility) {
      return { items, total: found.total, visible: found.total, visibleCapped: false };
    }
    const { visible, visibleCapped } = await this.countVisible(tokens, found.total, visibility);
    return { items, total: found.total, visible, visibleCapped };
  }

  /**
   * The true count of referrers `visibility` admits, counted up to
   * `MediaUsageScopes.EnumerationCap` — the same bound the force-authority
   * check pages to, reused rather than a second cap invented for this. Past
   * it, the count is a lower bound over whatever the scan actually reached,
   * and `visibleCapped` says so explicitly rather than leaving a caller to
   * infer "not exact" from `visible` falling short of `total` on its own.
   */
  private async countVisible(
    tokens: string[],
    total: number,
    visibility: MediaUsageVisibility
  ): Promise<{ visible: number; visibleCapped: boolean }> {
    const enumerated = await this.context.store.listMediaUsages(tokens, {
      limit: MediaUsageScopes.EnumerationCap,
      offset: 0,
    });
    const visible = enumerated.items.filter((usage) =>
      visibility(usage.project, usage.env, usage.collection)
    ).length;
    return { visible, visibleCapped: total > MediaUsageScopes.EnumerationCap };
  }

  async save(
    originalName: string,
    fileData: Uint8Array,
    mimeType?: string,
    folder?: string
  ): Promise<MediaAssetView> {
    const filename = MediaPaths.normalizeFilename(originalName);
    // Before the bytes are read anywhere and well before they are written: a
    // refused upload must leave nothing behind for `reconcile` to find.
    MediaExtensions.assert(this.context.mediaConfig.extensions, filename);

    const id = EntryUtils.newID();
    const blobKey = MediaPaths.blobKey(id, filename);
    const contentType = mimeType && mimeType.trim() ? mimeType : MimeUtils.lookup(filename);

    return this.context.withWriteLock(async () => {
      // Bytes first: a blob with no catalog record is an orphan reconcile can
      // adopt or report, whereas a record with no bytes is a broken asset every
      // reader trips over.
      await this.context.blobStorage.put(blobKey, fileData, { contentType });

      const asset: MediaAsset = {
        filename,
        folder: MediaPaths.normalizeFolder(folder),
        blob_key: blobKey,
        size: fileData.length,
        content_type: contentType,
        hash: crypto.createHash("sha256").update(fileData).digest("hex"),
        state: "active",
        tags: [],
      };
      return MediaCatalog.toView(
        await this.catalog.putAsset(id, asset),
        0,
        MediaLinks.of(this.context.mediaConfig, "")
      );
    });
  }

  /** Rename, move, or retag. None of it touches the blob or any entry. */
  async update(id: string, patch: MediaAssetPatchInput): Promise<MediaAssetView> {
    return this.context.withWriteLock(async () => {
      const entry = await this.catalog.asset(id);
      const asset = MediaCatalog.toAsset(entry);
      if (asset.state === "deleting") {
        throw new ConflictError(`media asset "${id}" is being deleted`);
      }

      const patched = MediaAssetPatch.apply(asset, patch);
      // A rename is the other way a filename enters the library, so the
      // allowlist has to hold here too. Without it "report.png" becomes
      // "report.exe" after upload and the check is decoration.
      MediaExtensions.assert(this.context.mediaConfig.extensions, patched.filename);

      const updated = await this.catalog.putAsset(id, patched);
      const [view] = await this.usageCounter.withCounts([updated]);
      return view;
    });
  }

  /**
   * A recursive folder filter cannot be one AST op — `contains` on a string
   * would also match "/marketing-old" for "/marketing" — so it is applied after
   * the fact rather than adding a `prefix` op both adapters would have to
   * implement forever.
   */
  private async listRecursive(
    filter: Filter | undefined,
    sort: SortKey[],
    folder: string,
    limit: number,
    offset: number
  ): Promise<MediaAssetPage> {
    const { items } = await this.catalog.listAssets({
      filter,
      sort,
      limit: MediaCatalogStore.WholeCatalog,
      offset: 0,
    });
    const within = items.filter((entry) =>
      MediaPaths.isWithin(MediaCatalog.toAsset(entry).folder, folder)
    );
    return {
      items: await this.usageCounter.withCounts(within.slice(offset, offset + limit)),
      total: within.length,
      limit,
      offset,
    };
  }
}
