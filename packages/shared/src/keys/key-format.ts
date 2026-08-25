/**
 * The public shape of an API key secret.
 *
 * The server mints secrets and stores a truncated display prefix on each key
 * record; the admin UI derives the same prefix from the key it holds so it can
 * mark which listed key is the one in use. Both must truncate identically, so
 * the prefix and length live here instead of being mirrored by hand.
 *
 * Secret *generation* and hashing stay server-side — they need crypto.
 */
export class KeyFormat {
  static readonly Prefix = "silo_";
  static readonly DisplayLength = 12;

  static displayPrefix(secret: string): string {
    return secret.slice(0, KeyFormat.DisplayLength) + "…";
  }

  static looksLikeKey(value: string): boolean {
    return value.startsWith(KeyFormat.Prefix);
  }
}
