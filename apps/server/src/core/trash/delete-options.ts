import type { AuditActor } from "../audit/audit-actor";

/** What a delete needs to know about the trash (D91). */
export interface DeleteOptions {
  /** Who asked, recorded on the receipt. Defaults to `system`. */
  actor?: AuditActor;
  /** Skip the trash and destroy now. The routes ask for `trash:purge`. */
  permanent?: boolean;
}

export class DeleteOptionsUtils {
  static actorOf(options: DeleteOptions | undefined): AuditActor {
    return options?.actor ?? { kind: "system" };
  }

  static isPermanent(options: DeleteOptions | undefined): boolean {
    return options?.permanent === true;
  }
}
