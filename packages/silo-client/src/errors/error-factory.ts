import { ConflictError } from "./conflict-error.js";
import type { ErrorPayload } from "./error-payload.js";
import { ForbiddenError } from "./forbidden-error.js";
import { InternalError } from "./internal-error.js";
import { MediaDeleteStalledError } from "./media-delete-stalled-error.js";
import { MediaInUseError } from "./media-in-use-error.js";
import { NotFoundError } from "./not-found-error.js";
import { SiloError } from "./silo-error.js";
import { UnauthorizedError } from "./unauthorized-error.js";
import { ValidationFailedError } from "./validation-failed-error.js";

/**
 * Turns a non-2xx response body into the right error class. Reads
 * the wire's `code` first and falls back to HTTP status when the code is
 * missing or unrecognised, so it survives a body that is not JSON at all —
 * an HTML proxy error page, say — without throwing.
 */
export class ErrorFactory {
  static fromResponseBody(status: number, method: string, path: string, rawBody: string): SiloError {
    const payload = ErrorFactory.parse(rawBody);
    if (!payload) {
      const message = rawBody.trim().length > 0 ? rawBody : `request failed with status ${status}`;
      return ErrorFactory.byStatus(status, message, method, path);
    }

    const { code, message, details } = payload.error;
    switch (code) {
      case "validation_failed":
        return ValidationFailedError.fromWireDetails(message, method, path, details);
      case "unauthorized":
        return new UnauthorizedError(message, method, path);
      case "forbidden":
        return new ForbiddenError(message, method, path);
      case "not_found":
        return new NotFoundError(message, method, path);
      case "conflict":
        return new ConflictError(message, method, path);
      case "media_in_use":
        return MediaInUseError.fromWireDetails(message, method, path, details);
      case "media_delete_stalled":
        return MediaDeleteStalledError.fromWireDetails(message, method, path, details);
      case "internal":
        return new InternalError(message, method, path);
      default:
        return ErrorFactory.byStatus(status, message, method, path);
    }
  }

  /** An unrecognised code, or none at all: fall back on the HTTP status, and
   * on `SiloError` itself when even the status is not one this client
   * otherwise names a class for. */
  private static byStatus(status: number, message: string, method: string, path: string): SiloError {
    switch (status) {
      case 400:
        return new ValidationFailedError(message, method, path, []);
      case 401:
        return new UnauthorizedError(message, method, path);
      case 403:
        return new ForbiddenError(message, method, path);
      case 404:
        return new NotFoundError(message, method, path);
      case 409:
        return new ConflictError(message, method, path);
      default:
        return new SiloError(status, "unknown", message, method, path);
    }
  }

  private static parse(rawBody: string): ErrorPayload | null {
    if (!rawBody) return null;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed && typeof parsed === "object" && "error" in parsed) return parsed as ErrorPayload;
      return null;
    } catch {
      return null;
    }
  }
}
