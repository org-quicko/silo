/** An asset's bytes plus the headers a response needs. */
export interface MediaBytes {
  data: Uint8Array;
  contentType?: string;
  size: number;
  filename?: string;
  hash?: string;
}
