import type { RequestOptions } from "../request-options.js";

/** The fully-described replacement: raw bytes plus the name whose extension
 *  the server checks against the one the asset already has. No `folder` — a
 *  replace changes bytes and nothing else about where the asset sits. */
export interface MediaReplaceBytes {
  bytes: Uint8Array | ArrayBuffer | Blob;
  filename: string;
  contentType?: string;
}

/** The filename to read when the input carries none — a `File` has `.name`,
 *  a bare `Blob` does not, and the extension is what the server checks. */
export interface MediaReplaceOptions extends RequestOptions {
  filename?: string;
}

/** `MediaAsset.replace()`'s input: a fully-described replacement, or a
 *  runtime `File`/`Blob`. */
export type MediaReplace = MediaReplaceBytes | File | Blob;
