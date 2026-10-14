import { ValidationError } from "@silo/shared/validation-error";
import type { Scope } from "../../core/domain/scope";
import type { TransferPackageSource } from "../../core/ports/transfer-package-source";
import { HttpSiloClient } from "./http-silo-client";

/**
 * Another silo's `POST …/envs/{env}/package` (D108), as a prepared transfer
 * pulls it (D109).
 *
 * Redirects are refused, as for a copy. A source that does not answer with a
 * gzip body is refused before a byte is read, and a source too old to have
 * the route is told apart from a missing name, so the caller learns which
 * side has to change.
 */
export class HttpPackageSource implements TransferPackageSource {
  readonly url: string;
  private readonly apiKey: string;
  private readonly from: Scope;
  private readonly body: unknown;

  constructor(sourceUrl: string, apiKey: string, from: Scope, body: unknown) {
    this.url = HttpSiloClient.normalizeUrl(sourceUrl);
    this.apiKey = apiKey.trim();
    this.from = from;
    this.body = body;
  }

  async open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const project = encodeURIComponent(this.from.project);
    const env = encodeURIComponent(this.from.env);
    let response: Response;
    try {
      response = await fetch(`${this.url}/api/projects/${project}/envs/${env}/package`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(this.body),
        redirect: "error",
        signal,
      });
    } catch (caught: any) {
      if (signal.aborted) throw caught;
      throw new ValidationError(`could not reach source silo at "${this.url}": ${caught?.message || "request failed"}`);
    }

    if (!response.ok) throw await HttpPackageSource.refusal(response);
    const type = response.headers.get("Content-Type") ?? "";
    if (!type.startsWith("application/gzip") || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new ValidationError(`"${this.url}" did not answer with a transfer package; the source needs silo 1.6.0 or later`);
    }
    return HttpPackageSource.guarded(response.body, signal);
  }

  /** Why the source said no. A 404 with no silo error in it is a server without the route. */
  private static async refusal(response: Response): Promise<ValidationError> {
    let message = "";
    try {
      message = JSON.parse(await response.text())?.error?.message ?? "";
    } catch {
      message = "";
    }
    if ((response.status === 404 && (!message || message === "not found")) || response.status === 405) {
      return new ValidationError("the source does not send transfer packages; it needs silo 1.6.0 or later");
    }
    const reason = message || response.statusText || "request failed";
    if (response.status === 401 || response.status === 403) {
      return new ValidationError(`the source refused the key: ${reason}`);
    }
    return new ValidationError(`the source refused the package (${response.status}): ${reason}`);
  }

  /** The body, with a broken connection reported as the source's failure, not this server's. */
  private static guarded(body: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (caught: any) {
          controller.error(
            signal.aborted
              ? caught
              : new ValidationError(`the source stopped sending the package: ${caught?.message || "connection lost"}`)
          );
        }
      },
      cancel(reason) {
        void reader.cancel(reason).catch(() => {});
      },
    });
  }
}
