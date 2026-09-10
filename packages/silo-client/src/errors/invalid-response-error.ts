/**
 * A `2xx` carried a body its route does not promise — an HTML proxy page in
 * front of a JSON route, say. Distinct from `SiloError`: the request
 * succeeded, and what is wrong is the shape of the answer, not a refusal.
 */
export class InvalidResponseError extends Error {
  readonly method: string;
  readonly path: string;
  readonly contentType: string;

  constructor(method: string, path: string, contentType: string) {
    super(`${method} ${path} answered with content-type "${contentType}", not the JSON this route promises`);
    this.name = "InvalidResponseError";
    this.method = method;
    this.path = path;
    this.contentType = contentType;
    Object.setPrototypeOf(this, InvalidResponseError.prototype);
  }
}
