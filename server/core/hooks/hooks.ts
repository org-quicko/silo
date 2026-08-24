import type {
  AfterDeleteEvent,
  AfterWriteEvent,
  BeforeDeleteEvent,
  BeforeValidateEvent,
  BeforeWriteEvent,
} from "./events";

/**
 * The hook port (D31/§13.5).
 *
 * A port for the same reason `Searcher` is one (D30): `Service` must be able to
 * dispatch without importing the plugin machinery, and `core` imports no
 * adapter. `HookBus` (`server/plugins/`) is the implementation; `NoOpHooks` is
 * what an instance with no plugins gets, so there is one dispatch path rather
 * than a null check at every site.
 *
 * The asymmetry between the methods is the contract, not an accident:
 * `beforeValidate` **returns** data because it may replace it, and everything
 * else returns `void` because it may only reject. A hook that could rewrite
 * data after validation would store a value the schema never judged (§5.1).
 *
 * ## What dispatches, and what deliberately does not
 *
 * Every write that goes through `Service` dispatches: the HTTP CRUD routes, and
 * a plugin's own `ctx.entries.*` calls.
 *
 * **The transfer paths do not.** `Importer` and `ScopeCopier` write through
 * `Storage.put` directly, and that is left as it is rather than routed through
 * here, because an import is meant to *reproduce an archive faithfully*. A
 * mutating hook running during import would make export→import non-idempotent
 * and break the property D5 exists for — that an fs-backed instance is a live
 * export, so `cp` and `rsync` are backup and replication. It also follows the
 * precedent already set by `--validate`: import does not apply the API's schema
 * checks unless asked, so applying the API's plugin checks unconditionally
 * would be the inconsistent choice.
 *
 * This is a **scope decision, not an oversight**, and it is the one place the
 * "domain hooks rather than HTTP middleware" argument does not yet pay off in
 * full. Reaching those paths needs an opt-in of its own (an import-time flag,
 * and a decision about which of the five may run), which is additive and is
 * §12.8 work. `HookOrigin` already carries `"import"` so that landing it later
 * changes no payload shape.
 */
export interface Hooks {
  /** Returns the data to carry forward — the plugin's replacement, or the
   *  value passed in when no plugin changed it. */
  beforeValidate(event: BeforeValidateEvent): Promise<any>;

  /** Throws to reject the write. `ValidationError`/`ForbiddenError` surface as
   *  400/403; anything else is a plugin fault (§13.9). */
  beforeWrite(event: BeforeWriteEvent): Promise<void>;

  /** Best-effort and at-most-once. Never fails the request: the write has
   *  committed, so there is nothing left to fail and a 500 would invite a
   *  retry that writes twice. Durable delivery waits on the change feed
   *  (§12.1). */
  afterWrite(event: AfterWriteEvent): Promise<void>;

  beforeDelete(event: BeforeDeleteEvent): Promise<void>;

  /** Best-effort, as `afterWrite`. */
  afterDelete(event: AfterDeleteEvent): Promise<void>;
}
