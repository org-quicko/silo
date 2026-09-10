/**
 * The base for every error the server itself answered: it received the
 * request and refused it. `status` and `code` are the wire's;
 * `method` and `path` say what was being attempted.
 */
export class SiloError extends Error {
  readonly status: number;
  readonly code: string;
  readonly method: string;
  readonly path: string;

  constructor(status: number, code: string, message: string, method: string, path: string) {
    super(message);
    this.name = "SiloError";
    this.status = status;
    this.code = code;
    this.method = method;
    this.path = path;
    // Keeps `instanceof` working under a downlevel target, where `extends
    // Error` alone can leave the prototype chain broken.
    Object.setPrototypeOf(this, SiloError.prototype);
  }
}
