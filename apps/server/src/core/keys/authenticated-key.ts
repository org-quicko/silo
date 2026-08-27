import type { KeyInfo } from "./key-info";

/**
 * A key that has just authenticated: its stored record, plus the id of the
 * record holding it (D38).
 *
 * `KeyInfo` is the shape written into `_keys`, and a document does not carry the
 * id of the entry it is stored in — storing one would be a second copy of the
 * envelope's own field, free to drift. But three things need to name the calling
 * key: `granted_by` on a plugin grant, `parent_id` on a minted key, and the
 * actor on an audit event. So the id is attached at authentication, where it is
 * known, and is never persisted inside the data.
 *
 * The synthetic principal `--no-auth` installs carries `id: ""`, which every
 * consumer treats as "no key" rather than as a key called the empty string —
 * see `AuthMiddleware`.
 */
export interface AuthenticatedKey extends KeyInfo {
  /** The `_keys` entry id, or `""` for the synthetic auth-disabled principal. */
  id: string;
}
