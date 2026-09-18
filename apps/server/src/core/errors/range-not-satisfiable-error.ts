/** A `Range` request that lies wholly outside the object: HTTP 416. */
export class RangeNotSatisfiableError extends Error {
  readonly size: number;

  constructor(size: number) {
    super(`requested range is outside the ${size}-byte object`);
    this.name = "RangeNotSatisfiableError";
    this.size = size;
  }
}
