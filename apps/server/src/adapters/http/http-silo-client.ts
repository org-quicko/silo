import { ValidationError } from "@silo/shared/validation-error";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/** Reads a portable export from another running silo instance. */
export class HttpSiloClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;

  constructor(sourceUrl: string, apiKey: string, fetcher: Fetcher = fetch) {
    this.baseUrl = HttpSiloClient.normalizeUrl(sourceUrl);
    this.apiKey = apiKey.trim();
    this.fetcher = fetcher;

    if (!this.apiKey) {
      throw new ValidationError("source_api_key is required");
    }
  }

  /**
   * The source's archive, as a stream.
   *
   * The source streams `/api/export`, and reading that into a `Buffer` here
   * undid it on the destination: a copy allocated as much memory as the source
   * instance's media library, which is the whole of what an archive carries.
   *
   * The one thing the buffered version could do for free was see that the
   * archive was empty. That check is kept by pulling the first chunk before
   * answering and putting it back at the head of the stream the caller gets —
   * so an empty source is still a clear error rather than a tar failure, and
   * nothing beyond one chunk is held to find out.
   */
  async exportArchiveStream(withKeys: boolean): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.baseUrl}/api/export?with_keys=${withKeys}`;
    let response: Response;

    try {
      response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        redirect: "error",
      });
    } catch (caught: any) {
      throw new ValidationError(
        `could not reach source silo at "${this.baseUrl}": ${caught?.message || "request failed"}`
      );
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ValidationError("source silo key must permit export");
      }
      const message = await HttpSiloClient.readError(response);
      throw new ValidationError(
        `source silo export failed (${response.status}): ${message}`
      );
    }

    if (!response.body) {
      throw new ValidationError("source silo returned an empty export archive");
    }
    return HttpSiloClient.nonEmptyStream(response.body);
  }

  /**
   * `body` with its first chunk read and pushed back on, so an archive with no
   * bytes in it is refused before the caller starts extracting one.
   */
  private static async nonEmptyStream(
    body: ReadableStream<Uint8Array>
  ): Promise<ReadableStream<Uint8Array>> {
    const reader = body.getReader();
    let first: Uint8Array | undefined;
    // A zero-length chunk is not the end of the archive, so keep pulling until
    // there are bytes or there is nothing left.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > 0) {
        first = value;
        break;
      }
    }

    if (!first) {
      reader.releaseLock();
      throw new ValidationError("source silo returned an empty export archive");
    }

    const head = first;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason);
      },
    });
  }

  private static normalizeUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new ValidationError("source_url is required");
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ValidationError("source_url must be a valid http or https URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("source_url must use http or https");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new ValidationError(
        "source_url must not contain credentials, a query string, or a fragment"
      );
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  }

  private static async readError(response: Response): Promise<string> {
    const fallback = response.statusText || "request failed";
    try {
      const body = await response.text();
      if (!body) return fallback;
      const parsed = JSON.parse(body);
      return parsed?.error?.message || fallback;
    } catch {
      return fallback;
    }
  }
}
