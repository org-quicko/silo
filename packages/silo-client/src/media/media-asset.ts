import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import { MediaAssetMapper } from "./media-asset-mapper.js";
import type { MediaAssetPayload } from "./media-asset-payload.js";
import type { MediaDeleteOptions } from "./media-delete-options.js";
import { MediaReference } from "./media-reference.js";
import type { MediaUsageQuery } from "./media-usage-page.js";
import { MediaUsagePage } from "./media-usage-page.js";

/** `MediaAsset`'s mapped state — `MediaAssetMapper.toRecord`'s output. */
export interface MediaAssetRecord {
  id: string;
  filename: string;
  folder: string;
  blobKey: string;
  sizeInBytes: number;
  contentType: string;
  hash: string;
  state: "active" | "deleting";
  tags: string[];
  url: string;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A catalogued media asset, live: the mapped record plus the operations on
 * it (symmetrical with `Entry`). A mutating call adopts the server's answer
 * in place and returns `this`.
 *
 * `reference` (`silo://media/<id>`) is what an entry field should hold;
 * `url` is only where to fetch today's bytes. A rename or move keeps the
 * same `reference` but can change `url` — storing `url` in an entry is the
 * mistake a later rename silently breaks.
 */
export class MediaAsset {
  private record: MediaAssetRecord;

  constructor(
    private readonly transport: Transport,
    record: MediaAssetRecord,
  ) {
    this.record = record;
  }

  get id(): string { return this.record.id; }
  get filename(): string { return this.record.filename; }
  get folder(): string { return this.record.folder; }
  get sizeInBytes(): number { return this.record.sizeInBytes; }
  get contentType(): string { return this.record.contentType; }
  get hash(): string { return this.record.hash; }
  get state(): "active" | "deleting" { return this.record.state; }
  get tags(): readonly string[] { return this.record.tags; }
  get url(): string { return this.record.url; }
  get usageCount(): number { return this.record.usageCount; }
  get createdAt(): Date { return this.record.createdAt; }
  get updatedAt(): Date { return this.record.updatedAt; }
  get blobKey(): string { return this.record.blobKey; }

  /** `silo://media/<id>` — store THIS in an entry field, never `url` (see
   * the class doc). */
  get reference(): string {
    return MediaReference.of(this.id);
  }

  async rename(filename: string, options?: RequestOptions): Promise<this> {
    return this.patch({ filename }, options);
  }

  async moveTo(folder: string, options?: RequestOptions): Promise<this> {
    return this.patch({ folder }, options);
  }

  /** REPLACES the tag list — `PATCH` replaces, it does not append. */
  async setTags(tags: readonly string[], options?: RequestOptions): Promise<this> {
    return this.patch({ tags: [...tags] }, options);
  }

  /** Refused while an entry references it; `{ force: true }` also needs
   * `entries:update` on every scope this asset reaches. */
  async delete(options?: MediaDeleteOptions): Promise<void> {
    await this.transport.empty({
      method: "DELETE",
      path: ApiPath.mediaAsset(this.id),
      query: options?.force ? { force: true } : undefined,
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  usages(query: MediaUsageQuery = {}, options?: RequestOptions): Promise<MediaUsagePage> {
    return MediaUsagePage.load(this.transport, this.id, query, options);
  }

  async refresh(options?: RequestOptions): Promise<this> {
    const payload = await this.transport.json<MediaAssetPayload>({
      method: "GET",
      path: ApiPath.mediaAsset(this.id),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    this.record = MediaAssetMapper.toRecord(payload);
    return this;
  }

  toJSON(): MediaAssetRecord {
    return { ...this.record };
  }

  private async patch(body: Record<string, unknown>, options?: RequestOptions): Promise<this> {
    const payload = await this.transport.json<MediaAssetPayload>({
      method: "PATCH",
      path: ApiPath.mediaAsset(this.id),
      body,
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    this.record = MediaAssetMapper.toRecord(payload);
    return this;
  }
}
