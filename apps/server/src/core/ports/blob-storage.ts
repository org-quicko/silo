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

export interface BlobStorage {
  put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void>;
  get(key: string): Promise<BlobGetResult | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<BlobItem[]>;
  exists(key: string): Promise<boolean>;
  close?(): Promise<void>;

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
