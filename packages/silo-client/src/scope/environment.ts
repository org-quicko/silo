/**
 * An environment as the listing and create routes answer it. `id` is the
 * record's ULID and never changes; `name` is what every path addresses.
 */
export interface Environment {
  readonly id: string;
  readonly name: string;
}
