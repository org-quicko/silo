/**
 * Turning what a caller passed into the two things a multipart part needs: a
 * `Blob` and a filename.
 *
 * Shared by `Media.upload` and `MediaAsset.replace` (D67) rather than copied
 * into the second. The filename is not cosmetic on either path — the server
 * reads the extension off it to decide what the library accepts, and on a
 * replace to decide whether the file's type is changing at all — so the two
 * entry points must derive it the same way.
 */
export class MediaFile {
  static toBlob(bytes: Uint8Array | ArrayBuffer | Blob, contentType?: string): Blob {
    if (bytes instanceof Blob) return bytes;
    // `Uint8Array`'s `ArrayBufferLike` backing (which admits `SharedArrayBuffer`)
    // is stricter than `BlobPart` under this lib's types; a runtime `Blob`
    // accepts either, so the cast is safe.
    return new Blob([bytes as BlobPart], contentType ? { type: contentType } : undefined);
  }

  /** A `File` carries its own name; a bare `Blob` does not, and sending it
   * as "blob" is worse than refusing outright. */
  static nameOf(input: Blob, explicit?: string): string {
    if (explicit) return explicit;
    if (input instanceof File && input.name) return input.name;
    throw new Error("media: a Blob has no filename — pass { filename } explicitly");
  }
}
