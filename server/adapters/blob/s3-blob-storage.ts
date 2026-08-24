import { S3Client, type S3Options } from "bun";
import type { BlobStorage, BlobItem, BlobPutOptions, BlobGetResult } from "../../core/ports/blob-storage";
import { MimeUtils } from "../../core/media/mime-utils";

export interface S3BlobStorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /**
   * Path-style addressing (`<endpoint>/<bucket>/<key>`) instead of
   * virtual-hosted (`<bucket>.<endpoint>/<key>`). Unset means virtual-hosted,
   * which is what AWS itself wants; MinIO and most self-hosted gateways need
   * this on.
   */
  forcePathStyle?: boolean;
  /** Pre-built client, for tests. Bypasses every option above. */
  s3Client?: S3Client;
}

/**
 * Blob storage on S3 and anything that speaks its API.
 *
 * Built on Bun's own `S3Client` rather than `@aws-sdk/client-s3`: the six
 * methods of the `BlobStorage` port are a five-verb subset of S3, and the SDK
 * charged 24 transitive packages and 487 KB of the minified server bundle for
 * it — in a binary that ships as one file, on a runtime that already has a
 * signed S3 client compiled in.
 */
export class S3BlobStorage implements BlobStorage {
  private client: S3Client;

  constructor(options: S3BlobStorageOptions) {
    if (options.s3Client) {
      this.client = options.s3Client;
      return;
    }

    const config: S3Options = {
      bucket: options.bucket,
      region: options.region || "us-east-1",
    };

    if (options.endpoint) {
      config.endpoint = options.endpoint;
    }
    // Bun states the addressing mode as the *positive* of the one the AWS SDK
    // names, and its default is the opposite one: `forcePathStyle` absent has
    // always meant virtual-hosted here, so leaving this unmapped would quietly
    // repoint every existing AWS deployment at path-style URLs. Bun also
    // ignores an unknown `forcePathStyle` key without complaint, which is why
    // this is an explicit inversion rather than a rename.
    config.virtualHostedStyle = !(options.forcePathStyle ?? false);

    if (options.accessKeyId && options.secretAccessKey) {
      config.accessKeyId = options.accessKeyId;
      config.secretAccessKey = options.secretAccessKey;
    }

    this.client = new S3Client(config);
  }

  /** A 404 for the key asked about, as opposed to a 403 on the bucket or a
   *  gateway that is simply down — neither of which may read as "absent". */
  private static isMissing(err: any): boolean {
    return err?.code === "NoSuchKey" || err?.code === "NotFound";
  }

  async put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void> {
    await this.client.write(key, data, { type: options?.contentType });
  }

  async get(key: string): Promise<BlobGetResult | null> {
    try {
      const data = await this.client.file(key).bytes();
      return {
        data,
        // Derived from the key, not fetched. Bun exposes the stored
        // Content-Type only through `stat()`, which is a second round trip per
        // read — and a HEAD that a bucket policy granting `s3:GetObject` alone
        // refuses, turning reads that work today into failures. `FsBlobStorage`
        // already answers this by extension, blob keys carry one (`<ulid><ext>`,
        // D23), and every caller in `Service` reads the catalog's
        // `content_type` first and falls back to exactly this lookup.
        contentType: MimeUtils.lookup(key),
        size: data.length,
      };
    } catch (err: any) {
      if (S3BlobStorage.isMissing(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (err: any) {
      // Deleting what is not there is not an error, matching `FsBlobStorage`
      // and S3 itself — but an S3-compatible gateway may still 404 where AWS
      // returns 204.
      if (!S3BlobStorage.isMissing(err)) throw err;
    }
  }

  /**
   * Every object under `prefix`, following continuation tokens.
   *
   * The pagination is not incidental: `ListObjectsV2` caps a response at 1000
   * keys, and the previous implementation issued exactly one, so an instance
   * with more media than that silently exported a truncated library —
   * `Exporter.exportDir` walks this method to decide what bytes go in the
   * archive.
   */
  async list(prefix: string = ""): Promise<BlobItem[]> {
    const items: BlobItem[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await this.client.list({ prefix, continuationToken });
      for (const obj of page?.contents ?? []) {
        items.push({
          key: obj.key,
          size: obj.size ?? 0,
          // Bun hands back the raw ISO string the ListBucketResult carried;
          // the port promises a Date.
          lastModified: obj.lastModified ? new Date(obj.lastModified) : undefined,
        });
      }
      continuationToken = page?.isTruncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);

    return items;
  }

  async exists(key: string): Promise<boolean> {
    return await this.client.exists(key);
  }

  async close(): Promise<void> {
    // Nothing to release: Bun's S3Client holds no connection pool of its own to
    // destroy, unlike the SDK client this replaced.
  }
}
