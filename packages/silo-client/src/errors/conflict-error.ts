import { SiloError } from "./silo-error.js";

/** A `409`. `code` defaults to `"conflict"` (a stale revision); a subclass
 *  like {@link MediaInUseError} passes its own more specific wire code. */
export class ConflictError extends SiloError {
  constructor(message: string, method: string, path: string, code: string = "conflict") {
    super(409, code, message, method, path);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}
