/**
 * HTTP 409. `code` is the response's error code: `conflict` unless a refusal
 * needs a name a client can act on, such as `atomic_commit_unsupported`.
 */
export class ConflictError extends Error {
  readonly code: string;

  constructor(message: string = "conflict", code: string = "conflict") {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}
