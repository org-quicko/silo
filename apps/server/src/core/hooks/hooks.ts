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
 * A port for the same reason `Searcher` is one: `SiloService` dispatches
 * without importing the plugin machinery, and `core` imports no adapter.
 * `HookBus` is the implementation; `NoOpHooks` is what an instance with no
 * plugins gets, so there is one dispatch path rather than a null check at
 * every site.
 *
 * The asymmetry between the methods is the contract: `beforeValidate`
 * **returns** data because it may replace it, and everything else returns
 * `void` because it may only reject. A hook that rewrote data after validation
 * would store a value the schema never judged (§5.1).
 *
 * **The transfer paths deliberately do not dispatch** — see
 * `docs/design/plugins.md` for why an import must reproduce an archive
 * faithfully, and what an opt-in would need.
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
