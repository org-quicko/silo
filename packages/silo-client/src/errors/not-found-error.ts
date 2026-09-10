import { SiloError } from "./silo-error.js";

/** A `404`: the project, environment, collection, entry, or asset named in
 *  the path does not exist. */
export class NotFoundError extends SiloError {
  constructor(message: string, method: string, path: string) {
    super(404, "not_found", message, method, path);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}
