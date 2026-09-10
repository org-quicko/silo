import { SiloError } from "./silo-error.js";

/** A `500` with no more specific code: the server has a bug, or hit a
 *  failure it does not describe further. */
export class InternalError extends SiloError {
  constructor(message: string, method: string, path: string) {
    super(500, "internal", message, method, path);
    this.name = "InternalError";
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}
