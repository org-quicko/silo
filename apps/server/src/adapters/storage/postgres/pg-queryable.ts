/**
 * Something a statement can run on: the pool, or one open transaction.
 *
 * The stores take this rather than the pool, so the same lookup runs inside a
 * record write's transaction or on its own without two copies of the SQL.
 *
 * Parameters are strings, numbers, booleans or null — never an object or an
 * array. JSON goes in as text and is cast in SQL (`$1::text::jsonb`), and a
 * list goes in as a JSON array read back with `jsonb_array_elements_text`, so
 * no value depends on how the driver serialises a composite (docs/design/
 * storage.md §6.6).
 */
export interface PgQueryable {
  query<Row = any>(text: string, params?: readonly PgParameter[]): Promise<Row[]>;
}

/** A value a statement can bind. */
export type PgParameter = string | number | boolean | null;
