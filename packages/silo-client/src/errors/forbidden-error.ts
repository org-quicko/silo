import { SiloError } from "./silo-error.js";

/** A `403`: the key is valid but does not hold the claim this call needs. */
export class ForbiddenError extends SiloError {
  constructor(message: string, method: string, path: string) {
    super(403, "forbidden", message, method, path);
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}
