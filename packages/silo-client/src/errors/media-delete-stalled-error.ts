import { SiloError } from "./silo-error.js";

/**
 * A `500` where the asset was staged for deletion but the blob store refused
 * to remove its bytes. Not a refusal like {@link MediaInUseError} — it is a
 * storage failure the caller fixes by fixing the blob store, or by running
 * the remedy this error names.
 */
export class MediaDeleteStalledError extends SiloError {
  readonly remedy: string;

  constructor(message: string, method: string, path: string, remedy: string) {
    super(500, "media_delete_stalled", message, method, path);
    this.name = "MediaDeleteStalledError";
    this.remedy = remedy;
    Object.setPrototypeOf(this, MediaDeleteStalledError.prototype);
  }

  /** Builds from the wire's `error.details` object, which carries `remedy`
   *  alongside fields this client does not otherwise surface. */
  static fromWireDetails(message: string, method: string, path: string, details: unknown): MediaDeleteStalledError {
    const object = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
    const remedy = typeof object.remedy === "string" ? object.remedy : "";
    return new MediaDeleteStalledError(message, method, path, remedy);
  }
}
