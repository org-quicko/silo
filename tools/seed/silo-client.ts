import { ApiError } from "./api-error";

/**
 * The thinnest client the seeder needs: `POST` and `GET` against `/api`, with
 * the silo error envelope decoded. Retries cover a connection refused mid-run
 * and a `5xx`; a `4xx` is a defect in the generated payload and stops the run
 * immediately, because the alternative is thousands of silently skipped entries
 * and a summary that claims success.
 */
export class SiloClient {
  private static readonly Retries = 3;

  constructor(private readonly baseUrl: string, private readonly key: string) {}

  async get<T>(path: string): Promise<T> {
    return this.send<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SiloClient.Retries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (response.ok) {
          const text = await response.text();
          return (text ? JSON.parse(text) : undefined) as T;
        }

        const error = await SiloClient.decodeError(response, path);
        if (response.status < 500) throw error;
        lastError = error;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status < 500) throw caught;
        lastError = caught;
      }
      await Bun.sleep(200 * attempt);
    }
    throw lastError;
  }

  private static async decodeError(response: Response, path: string): Promise<ApiError> {
    const text = await response.text().catch(() => "");
    try {
      const envelope = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown[] } };
      const detail = envelope.error?.details?.length ? ` (${JSON.stringify(envelope.error.details)})` : "";
      return new ApiError(
        response.status,
        envelope.error?.code ?? "unknown",
        `${envelope.error?.message ?? text}${detail}`,
        path,
      );
    } catch {
      return new ApiError(response.status, "unknown", text || response.statusText, path);
    }
  }
}
