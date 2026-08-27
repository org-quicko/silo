export class UnauthorizedError extends Error {
  constructor(message: string = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
