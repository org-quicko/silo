export interface BlobItem {
  key: string;
  size: number;
  lastModified?: Date;
  contentType?: string;
}

export interface BlobPutOptions {
  contentType?: string;
}

export interface BlobGetResult {
  data: Uint8Array;
  contentType?: string;
  size: number;
}

/** An inclusive span of bytes within an object. */
export interface BlobRange {
  start: number;
  end: number;
}

/**
 * An object opened for reading rather than read: `body` is forwarded as it
 * arrives and never held whole. A stream is what the built-in stores answer;
 * a `Blob` is accepted for a store that only has one, and is streamed by the
 * caller rather than handed to a response, since a response over a file
 * handle was measured to read the file whole. `size` is the whole object when
 * the store knows it without a second round trip; a caller that has the size
 * from elsewhere does not need it.
 */
export interface BlobStream {
  body: Blob | ReadableStream<Uint8Array>;
  size?: number;
  contentType?: string;
}

export interface BlobStorage {
  put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void>;
  get(key: string): Promise<BlobGetResult | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<BlobItem[]>;
  exists(key: string): Promise<boolean>;
  close?(): Promise<void>;

  /**
   * The object as a body to send, or the `range` of it, without reading it
   * into memory first (D80). `null` when the store can tell up front that the
   * key is absent; a store that only learns that on read answers a body that
   * fails when read.
   *
   * Optional, so a provider plugin written against the earlier port keeps
   * working: a caller falls back to `get` and slices the bytes it was handed.
   */
  stream?(key: string, range?: BlobRange): Promise<BlobStream | null>;

  /**
   * Where a reader outside silo addresses these bytes: the URL root a blob key
   * is appended to, with no trailing slash, or `null` when this store has no
   * public face and silo has to serve them itself (D58).
   *
   * On the port rather than derived from `[blob_storage]` by whoever needs it,
   * because only the store knows how its own objects are addressed — a bucket
   * changes the answer with `force_path_style` alone, and a driver a provider
   * plugin contributed is not describable from here at all.
   *
   * Optional, so a store that has no answer says so by not implementing it.
   */
  publicRoot?(): string | null;
}
