/** One part of a multipart body. A `filename` is what makes it a file. */
export interface MultipartPart {
  name: string
  value: string | Uint8Array
  filename?: string
  contentType?: string
}

/**
 * `multipart/form-data`, encoded by hand.
 *
 * Hand-rolled because of a property worth keeping rather than an omission:
 * `ctx.fetch` takes a body of `string | Uint8Array` and nothing else, which is
 * what makes a plugin's request a structured-cloneable **value** — the thing
 * that lets the same client run in a worker, out of process, or against a remote
 * silo over a socket without a plugin's source changing. A `FormData` would not
 * survive that boundary, so the encoding happens on this side of it.
 *
 * And it is needed at all because `POST /api/media` reads `parseBody()`: silo
 * takes an upload as a form field named `file`, the same way a browser sends one.
 * That is the route's contract, not a preference this could route around.
 *
 * The boundary is 128 random bits. A body containing its own boundary would be
 * mis-parsed, and this does not scan for one — at 2⁻¹²⁸ per upload the check
 * would cost a pass over every file to defend against something no browser's
 * `FormData` defends against either.
 */
export class MultipartBody {
  static build(parts: readonly MultipartPart[]): { contentType: string; bytes: Uint8Array } {
    const boundary = MultipartBody.boundary()
    const chunks: Uint8Array[] = []
    const encoder = new TextEncoder()

    for (const part of parts) {
      let head = `--${boundary}\r\nContent-Disposition: form-data; name="${MultipartBody.escape(part.name)}"`
      if (part.filename !== undefined) {
        head += `; filename="${MultipartBody.escape(part.filename)}"`
      }
      if (part.contentType !== undefined) {
        head += `\r\nContent-Type: ${part.contentType}`
      }
      chunks.push(encoder.encode(`${head}\r\n\r\n`))
      chunks.push(typeof part.value === 'string' ? encoder.encode(part.value) : part.value)
      chunks.push(encoder.encode('\r\n'))
    }
    chunks.push(encoder.encode(`--${boundary}--\r\n`))

    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      bytes: MultipartBody.concat(chunks),
    }
  }

  private static boundary(): string {
    const random = new Uint8Array(16)
    crypto.getRandomValues(random)
    return `silo${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }

  /**
   * A quote or a newline in a filename, defused.
   *
   * The filenames here come out of a Strapi `files` table and are hashed by
   * Strapi, so none of them would need this. It is still done, because the header
   * is a header: a `"` would end the parameter early and a `\r\n` would end the
   * part, and neither would look like a bug in this file when it happened.
   */
  private static escape(value: string): string {
    return value.replace(/["\\]/g, '_').replace(/[\r\n]/g, '')
  }

  private static concat(chunks: readonly Uint8Array[]): Uint8Array {
    let total = 0
    for (const chunk of chunks) total += chunk.byteLength
    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.byteLength
    }
    return out
  }
}
