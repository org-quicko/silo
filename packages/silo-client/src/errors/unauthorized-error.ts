import { SiloError } from "./silo-error.js";

/** A `401`: no key, or a key the server does not recognise. */
export class UnauthorizedError extends SiloError {
  constructor(message: string, method: string, path: string) {
    super(401, "unauthorized", message, method, path);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}
