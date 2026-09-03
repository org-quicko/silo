import { SystemCollections } from "../domain/system-collections";
import type { KeyInfo } from "../keys/key-info";
import type { AuditActor } from "./audit-actor";

/** The reserved collection, and the two actors every caller builds. */
export class AuditUtils {
  static readonly AuditCollection = SystemCollections.Audit;

  /**
   * The actor for a request that presented a key.
   *
   * Takes the id separately because `KeyInfo` is the *stored* shape and does not
   * carry the id of the record storing it — `AuthenticatedKey` is what pairs the
   * two, and it exists precisely so this and `granted_by` have something to
   * name.
   */
  static key(id: string, info: Pick<KeyInfo, "label">): AuditActor {
    return { kind: "key", id, label: info.label };
  }

  /** The offline commands, which hold no key. See `AuditActor`. */
  static cli(): AuditActor {
    return { kind: "cli" };
  }
}
