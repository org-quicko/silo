import { createHash } from 'crypto'

/**
 * The name Strapi actually gave a table, when the one its schema declares is too
 * long to be one.
 *
 * Strapi caps a database identifier at 55 characters and shortens anything past
 * that to its first 50 plus a five-character digest, so a content type whose
 * `collectionName` is 57 characters is stored under a name **its own schema does
 * not contain**:
 *
 * | declared | stored |
 * | :-- | :-- |
 * | `com_quicko_it_file_2026_incomes_bnp_settlements_templates` | `com_quicko_it_file_2026_incomes_bnp_settlements_teec0f2` |
 *
 * Reading `collectionName` and asking whether that table exists therefore
 * reports a content type as missing from an export that holds every one of its
 * rows — which is what it did, for exactly the two longest names in a real
 * instance.
 *
 * The digest is **shake256** and not one of the four hashes that would have been
 * a better guess, which is the whole reason this is a file rather than a
 * `slice`: sha256, sha1, md5 and sha3 all produce a plausible five characters
 * and none of them produce Strapi's. Verified against a live export before it
 * was written down.
 */
export class StrapiIdentifiers {
  /** Strapi's `MAX_DB_IDENTIFIER_LENGTH`. */
  static readonly MaxLength = 55
  static readonly HashLength = 5
  /** How much of the declared name survives shortening. */
  static readonly KeptLength = StrapiIdentifiers.MaxLength - StrapiIdentifiers.HashLength

  /** `name` as Strapi would have stored it. */
  static shorten(name: string): string {
    if (name.length <= StrapiIdentifiers.MaxLength) return name
    return name.slice(0, StrapiIdentifiers.KeptLength) + StrapiIdentifiers.digest(name)
  }

  /** Every spelling `name` could be stored under, the declared one first. */
  static spellings(name: string): string[] {
    const shortened = StrapiIdentifiers.shorten(name)
    return shortened === name ? [name] : [name, shortened]
  }

  /**
   * Whether `stored` could be the shortened form of `declared`.
   *
   * Compares the surviving prefix rather than recomputing the digest, because
   * the caller reaches this with a name it derived — a pluralised component
   * table — whose exact spelling it does not have, and the digest is over the
   * spelling. The prefix narrows the candidates; proving one is the caller's.
   */
  static sharePrefix(stored: string, declared: string): boolean {
    if (stored.length !== StrapiIdentifiers.MaxLength) return false
    if (declared.length < StrapiIdentifiers.KeptLength) return false
    return stored.slice(0, StrapiIdentifiers.KeptLength) === declared.slice(0, StrapiIdentifiers.KeptLength)
  }

  private static digest(name: string): string {
    return createHash('shake256', { outputLength: StrapiIdentifiers.HashLength })
      .update(name)
      .digest('hex')
      .slice(0, StrapiIdentifiers.HashLength)
  }
}
