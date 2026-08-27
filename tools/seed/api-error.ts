/** An API error carrying what the server actually said, not just a status. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly path: string) {
    super(`${status} ${code} on ${path}: ${message}`);
    this.name = "ApiError";
  }
}
