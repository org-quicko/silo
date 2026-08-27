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
}
