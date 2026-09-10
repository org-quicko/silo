import { SiloError } from "./silo-error.js";
import type { ValidationDetail } from "./validation-detail.js";

/** A `400`: the request was malformed, with one entry per field the
 *  validator rejected. */
export class ValidationFailedError extends SiloError {
  readonly details: ValidationDetail[];

  constructor(message: string, method: string, path: string, details: ValidationDetail[]) {
    super(400, "validation_failed", message, method, path);
    this.name = "ValidationFailedError";
    this.details = details;
    Object.setPrototypeOf(this, ValidationFailedError.prototype);
  }

  /** Builds from the wire's `error.details`, which is an array of
   *  `{path, message}` when the server sent one and `[]` otherwise. */
  static fromWireDetails(message: string, method: string, path: string, details: unknown): ValidationFailedError {
    const array = Array.isArray(details) ? (details as ValidationDetail[]) : [];
    return new ValidationFailedError(message, method, path, array);
  }
}
