export class ForbiddenError extends Error {
  constructor(message: string = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
