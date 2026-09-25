import type { PgParameter } from "./pg-queryable";

/**
 * The parameters of one statement, collected as it is built.
 *
 * Postgres numbers its placeholders, so a value used in several places is
 * bound once and named by the same `$n` each time. SQLite's `?` forced the
 * compiler to push a path once per use; here `add` is called once per value.
 */
export class PgParams {
  readonly values: PgParameter[] = [];

  add(value: PgParameter): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** The count so far, for {@link PgParams.rewind}. */
  mark(): number {
    return this.values.length;
  }

  /**
   * Drops every value added since `mark`. A leaf that turns out to match
   * nothing compiles to `false` and uses none of the values its path bound,
   * and Postgres refuses a statement with a parameter it cannot type (42P18).
   */
  rewind(mark: number): void {
    this.values.length = mark;
  }

  /** A JSON value, bound as text and cast, never as a driver object (§6.6). */
  json(value: unknown): string {
    return `${this.add(JSON.stringify(value))}::text::jsonb`;
  }
}
