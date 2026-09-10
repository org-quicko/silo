import { PageWindow } from "../pagination/page-window.js";
import type { RowLoader } from "../pagination/row-stream.js";
import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { TransportQueryValue } from "../transport/transport-request.js";
import { MediaAsset } from "./media-asset.js";
import { MediaAssetMapper } from "./media-asset-mapper.js";
import type { MediaAssetPayload } from "./media-asset-payload.js";
import type { MediaDeleteOptions } from "./media-delete-options.js";
import { MediaDeleteReport } from "./media-delete-report.js";
import { MediaFolders } from "./media-folders.js";
import { MediaPage } from "./media-page.js";
import { MediaPageStream } from "./media-page-stream.js";
import type { MediaQuery } from "./media-query.js";
import { MediaStream } from "./media-stream.js";
import type { MediaUpload, MediaUploadBytes, MediaUploadFileOptions } from "./media-upload.js";

/** Caps a client-side `deleteMany` before it reaches the server's own cap
 * — a local refusal reads better than a 400 for the 101st id. */
const BulkDeleteCap = 100;

/** The media library: instance-global, never scoped to a project or
 * environment. */
export class Media {
  readonly folders: MediaFolders;

  constructor(private readonly transport: Transport) {
    this.folders = new MediaFolders(transport);
  }

  upload(input: MediaUploadBytes, options?: RequestOptions): Promise<MediaAsset>;
  upload(input: File | Blob, fileOptions?: MediaUploadFileOptions, options?: RequestOptions): Promise<MediaAsset>;
  async upload(
    input: MediaUpload,
    second?: RequestOptions | MediaUploadFileOptions,
    third?: RequestOptions,
  ): Promise<MediaAsset> {
    const form = new FormData();
    let folder: string | undefined;
    let options: RequestOptions | undefined;

    if (input instanceof Blob) {
      const fileOptions = (second as MediaUploadFileOptions) ?? {};
      form.set("file", input, Media.filenameOf(input, fileOptions.filename));
      folder = fileOptions.folder;
      options = third ?? fileOptions;
    } else {
      form.set("file", Media.toBlob(input.bytes, input.contentType), input.filename);
      folder = input.folder;
      options = second as RequestOptions | undefined;
    }
    if (folder) form.set("folder", folder);

    const payload = await this.transport.upload<MediaAssetPayload>(
      { method: "POST", path: ApiPath.media(), signal: options?.signal, timeoutMilliseconds: options?.timeoutMilliseconds },
      form,
    );
    return new MediaAsset(this.transport, MediaAssetMapper.toRecord(payload));
  }

  list(query: MediaQuery = {}, options?: RequestOptions): Promise<MediaPage> {
    const window = new PageWindow(query.limit ?? 50, query.offset ?? 0);
    return MediaPage.loadWindow(this.transport, Media.toWireQuery(query), window, options);
  }

  /** One `MediaAsset` at a time, across every page. */
  all(query: MediaQuery = {}, options?: RequestOptions): MediaStream {
    const wireQuery = Media.toWireQuery(query);
    const loader: RowLoader<MediaAsset> = async (window) => {
      const page = await MediaPage.loadWindow(this.transport, wireQuery, window, options);
      return { rows: [...page], window: new PageWindow(page.limit, page.offset) };
    };
    return new MediaStream(loader, query.limit ?? 50, options);
  }

  /** One whole `MediaPage` at a time, across every page. */
  pages(query: MediaQuery = {}, options?: RequestOptions): MediaPageStream {
    return new MediaPageStream(() => this.list(query, options), options);
  }

  async get(id: string, options?: RequestOptions): Promise<MediaAsset> {
    const payload = await this.transport.json<MediaAssetPayload>({
      method: "GET",
      path: ApiPath.mediaAsset(id),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    return new MediaAsset(this.transport, MediaAssetMapper.toRecord(payload));
  }

  /** Every distinct file extension actually in the library. */
  async extensions(options?: RequestOptions): Promise<string[]> {
    const body = await this.transport.json<{ items: string[] }>({
      method: "GET",
      path: ApiPath.mediaExtensions(),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    return body.items;
  }

  /** Refuses locally past {@link BulkDeleteCap} — the server caps it too,
   * and a local error reads better than a 400. Always answers `200`:
   * per-id outcomes live in the report, not in a thrown error. */
  async deleteMany(ids: readonly string[], options?: MediaDeleteOptions): Promise<MediaDeleteReport> {
    if (ids.length > BulkDeleteCap) {
      throw new Error(`deleteMany accepts at most ${BulkDeleteCap} ids per request, got ${ids.length}`);
    }
    const body = await this.transport.json<{ deleted: string[]; failed: Record<string, unknown>[] }>({
      method: "POST",
      path: ApiPath.mediaBulkDelete(),
      body: { ids: [...ids], force: options?.force === true },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    return MediaDeleteReport.fromWireBody(body);
  }

  private static toWireQuery(query: MediaQuery): Record<string, TransportQueryValue> {
    return {
      q: query.text,
      folder: query.folder,
      recursive: query.recursive,
      type: query.type,
      ext: query.extension,
      tag: query.tag,
      modified_after: query.modifiedAfter,
      modified_before: query.modifiedBefore,
      sort: query.sort,
    };
  }

  private static toBlob(bytes: Uint8Array | ArrayBuffer | Blob, contentType?: string): Blob {
    if (bytes instanceof Blob) return bytes;
    // `Uint8Array`'s `ArrayBufferLike` backing (which admits `SharedArrayBuffer`)
    // is stricter than `BlobPart` under this lib's types; a runtime `Blob`
    // accepts either, so the cast is safe.
    return new Blob([bytes as BlobPart], contentType ? { type: contentType } : undefined);
  }

  /** A `File` carries its own name; a bare `Blob` does not, and uploading it
   * as "blob" is worse than refusing outright. */
  private static filenameOf(input: Blob, explicit?: string): string {
    if (explicit) return explicit;
    if (input instanceof File && input.name) return input.name;
    throw new Error("media upload: a Blob has no filename — pass { filename } explicitly");
  }
}
