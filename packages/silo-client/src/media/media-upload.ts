import type { RequestOptions } from "../request-options.js";

/** The fully-described upload: everything about the file given explicitly,
 *  including its name — the only form usable with raw bytes. */
export interface MediaUploadBytes {
  bytes: Uint8Array | ArrayBuffer | Blob;
  filename: string;
  contentType?: string;
  folder?: string;
}

/** Where a `File`/`Blob` upload lands, and the filename to record when the
 *  input carries none — a `File` already has `.name`; a bare `Blob` does not. */
export interface MediaUploadFileOptions extends RequestOptions {
  folder?: string;
  filename?: string;
}

/** `Media.upload()`'s input: a fully-described upload, or a runtime
 *  `File`/`Blob`, sent with the runtime's own `FormData` and `Blob`. */
export type MediaUpload = MediaUploadBytes | File | Blob;
