/**
 * The four keys silo puts on every entry alongside the author's own fields.
 *
 * `rev` is here because `replace()` and `delete()` require the revision the
 * caller expects and a mismatch is a `409`, so the number has to survive the
 * trip from a read to a write. The timestamps are ISO-8601 strings rather than
 * `Date`s, and `created_at` keeps the wire's spelling, because a row read from
 * one call and handed to the next unchanged is worth more than a prettier one.
 *
 * No field can collide with these: silo refuses a schema declaring one and an
 * entry carrying one (D62).
 */
export interface EntryEnvelope {
  id: string;
  rev: number;
  created_at: string;
  updated_at: string;
}
