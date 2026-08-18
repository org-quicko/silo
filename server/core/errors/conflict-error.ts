export class ConflictError extends Error {
  constructor(message: string = "conflict") {
    super(message);
    this.name = "ConflictError";
  }
}
