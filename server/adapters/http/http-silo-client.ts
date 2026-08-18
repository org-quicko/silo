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

  async exportArchive(withKeys: boolean): Promise<Buffer> {
    const url = `${this.baseUrl}/api/export?with_keys=${withKeys}`;
    let response: Response;

    try {
      response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        redirect: "error",
      });
    } catch (err: any) {
      throw new ValidationError(
        `could not reach source silo at "${this.baseUrl}": ${err?.message || "request failed"}`
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

    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length === 0) {
      throw new ValidationError("source silo returned an empty export archive");
    }
    return archive;
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
