import { ValidationError } from "@silo/shared/validation-error";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { HookNames, type HookName } from "../../core/hooks";
import type { Hooks } from "../../core/hooks/hooks";
import type {
  AfterDeleteEvent,
  AfterWriteEvent,
  BeforeDeleteEvent,
  BeforeValidateEvent,
  BeforeWriteEvent,
  CollectionDeletedEvent,
  HookEvent,
} from "../../core/hooks";
import type { Logger } from "../../logging/logger";
import type { PluginRuntime } from "./plugin-runtime";

/**
 * Dispatches one hook across every plugin that registered it (D31/§13.5).
 *
 * Order is the order of the `[[plugins]]` array — config-owned, deterministic,
 * and something an operator can change without touching a plugin. Deriving it
 * from a priority number in each manifest would make ordering a thing plugins
 * compete over, and there would be no single place to read the answer.
 *
 * The set is read through a **supplier** rather than held (D39, phase 4). A bus
 * that captured the list at construction would keep dispatching into a plugin
 * disabled a moment ago, and would never see one enabled a moment ago — and
 * since `PluginRegistry` is what a rescan rebuilds, the snapshot and the
 * registry would disagree for as long as the process ran. One function call per
 * hook buys the guarantee that "what is loaded" has exactly one answer.
 */
export class HookBus implements Hooks {
  /**
   * How many plugin-originated writes may nest.
   *
   * Since D33 a cycle is unrepresentable — `shouldDispatch` refuses a plugin
   * already in the causal chain — so this is no longer what stops a loop. It
   * caps how many *distinct* plugins may chain off one request, which is small
   * on purpose: legitimate uses are one deep (a hook writes a derived entry)
   * and two at a stretch.
   */
  static readonly MaxDepth = 4;

  private readonly runtimes: () => readonly PluginRuntime[];
  private readonly logger: Logger;

  constructor(runtimes: () => readonly PluginRuntime[], logger: Logger) {
    this.runtimes = runtimes;
    this.logger = logger;
  }

  /**
   * The one mutating hook. Each plugin sees what the previous one produced, so
   * a chain of enrichers composes; returning nothing leaves the value alone.
   */
  async beforeValidate(event: BeforeValidateEvent): Promise<any> {
    let data = event.data;
    for (const runtime of this.runtimes()) {
      if (!this.shouldDispatch(runtime, "entry.beforeValidate", event)) continue;
      const result = await this.run(runtime, "entry.beforeValidate", { ...event, data });
      if (result && typeof result === "object" && "data" in (result as any)) {
        data = (result as any).data;
      }
    }
    return data;
  }

  async beforeWrite(event: BeforeWriteEvent): Promise<void> {
    await this.veto("entry.beforeWrite", event);
  }

  async beforeDelete(event: BeforeDeleteEvent): Promise<void> {
    await this.veto("entry.beforeDelete", event);
  }

  async afterWrite(event: AfterWriteEvent): Promise<void> {
    await this.veto("entry.afterWrite", event);
  }

  async afterDelete(event: AfterDeleteEvent): Promise<void> {
    await this.veto("entry.afterDelete", event);
  }

  /**
   * The collection-level hook (D36, closing D37's F6).
   *
   * Nothing here is special-cased, and that is the whole reason the fix is one
   * name in the vocabulary rather than a mechanism: the claim check, the causal
   * skip and the terminal error policy are the same three questions
   * `shouldDispatch` and `run` already ask, and the answer to "may this plugin
   * hear that a collection was erased" is `hooks:<project>/<env>/<collection>`
   * with no grammar change at all.
   */
  async afterCollectionDelete(event: CollectionDeletedEvent): Promise<void> {
    await this.veto("collection.afterDelete", event);
  }

  private async veto(hook: HookName, event: HookEvent): Promise<void> {
    for (const runtime of this.runtimes()) {
      if (this.shouldDispatch(runtime, hook, event)) await this.run(runtime, hook, event);
    }
  }

  /**
   * Whether this plugin hears about this event (D33).
   *
   * A plugin already in the event's causal chain is **skipped**: it is being
   * told about a write its own hook caused, and delivering that would re-enter
   * it. Skipping makes a cycle unrepresentable rather than merely bounded —
   * `A -> B -> A` cannot form, because A is in the chain by the time B writes.
   *
   * It is also what a well-behaved plugin already did by hand, by testing
   * `origin` for its own name. Doing it here means a plugin that forgets can no
   * longer take its own worker down (which is exactly what the shipped `mirror`
   * fixture demonstrated), and the guard covers indirect loops the manual
   * check never could.
   *
   * The claim check (D34) is the other half, and it runs **here** rather than
   * inside the worker or after the fact: an event that a plugin may not receive
   * must not cross the boundary at all, or the check is an audit trail rather
   * than a confidentiality boundary. Before D34 there was no check — a plugin
   * granted nothing saw and could rewrite every write in the instance.
   */
  private shouldDispatch(runtime: PluginRuntime, hook: HookName, event: HookEvent): boolean {
    if (!runtime.handles(hook)) return false;
    if (event.chain.includes(runtime.name)) return false;
    return runtime.mayReceive(hook, event.scope.project, event.scope.env, event.collection);
  }

  /**
   * One plugin, one hook, with the error policy applied.
   *
   * Three outcomes, and the distinction between the first two is the whole of
   * §13.9. A `ValidationError` or `ForbiddenError` is the plugin **rejecting**
   * the operation and propagates untouched, so a guard plugin produces a 400 or
   * a 403 rather than a 500. Anything else is the plugin **failing**, which is
   * the operator's `on_error` to decide.
   *
   * **Terminal is asked first, and that ordering is the rule, not a detail.**
   * After the write has committed there is nothing left to reject, so a refusal
   * is as meaningless as a fault and is dropped the same way. Asking about the
   * error's class first instead let a post-commit `ForbiddenError` — a plugin
   * granted delivery but not the claim its `ctx` write needs, which is the
   * ordinary outcome of narrowing a grant — surface as a **403 on a request
   * that succeeded**, naming a claim the caller neither needed nor lacked.
   */
  private async run(runtime: PluginRuntime, hook: HookName, event: HookEvent): Promise<unknown> {
    try {
      return await runtime.dispatch(hook, event);
    } catch (caught) {
      const terminal = HookNames.isTerminal(hook);
      if (!terminal && (ValidationError.is(caught) || caught instanceof ForbiddenError)) {
        throw caught;
      }

      const message = caught instanceof Error ? caught.message : String(caught);
      const skipped = terminal || runtime.config.on_error === "skip";

      this.logger.error("plugin hook failed", {
        plugin: runtime.name,
        hook,
        collection: event.collection,
        outcome: terminal ? "dropped" : skipped ? "skipped" : "failed",
        message,
      });

      if (skipped) return null;
      throw new Error(`plugin "${runtime.name}" failed in ${hook}: ${message}`);
    }
  }
}
