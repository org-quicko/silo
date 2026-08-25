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
 */
export class HookBus implements Hooks {
  /**
   * How many plugin-originated writes may nest.
   *
   * Small on purpose: legitimate uses are one deep (a hook writes a derived
   * entry) and two at a stretch. Anything deeper is a loop, and the value is
   * low enough that the loop is caught while the stack is still readable.
   */
  static readonly MaxDepth = 4;

  private readonly runtimes: readonly PluginRuntime[];
  private readonly logger: Logger;

  constructor(runtimes: readonly PluginRuntime[], logger: Logger) {
    this.runtimes = runtimes;
    this.logger = logger;
  }

  /**
   * The one mutating hook. Each plugin sees what the previous one produced, so
   * a chain of enrichers composes; returning nothing leaves the value alone.
   */
  async beforeValidate(event: BeforeValidateEvent): Promise<any> {
    let data = event.data;
    for (const runtime of this.runtimes) {
      if (!runtime.handles("entry.beforeValidate")) continue;
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

  private async veto(hook: HookName, event: HookEvent): Promise<void> {
    for (const runtime of this.runtimes) {
      if (runtime.handles(hook)) await this.run(runtime, hook, event);
    }
  }

  /**
   * One plugin, one hook, with the error policy applied.
   *
   * Three outcomes, and the distinction between the first two is the whole of
   * §13.9. A `ValidationError` or `ForbiddenError` is the plugin **rejecting**
   * the operation and propagates untouched, so a guard plugin produces a 400 or
   * a 403 rather than a 500. Anything else is the plugin **failing**, which is
   * the operator's `on_error` to decide. And on a hook that runs after the
   * write has committed, neither policy applies: there is nothing left to fail,
   * and turning a post-write fault into a 500 would invite a retry that writes
   * the entry twice.
   */
  private async run(runtime: PluginRuntime, hook: HookName, event: HookEvent): Promise<unknown> {
    try {
      return await runtime.dispatch(hook, event);
    } catch (caught) {
      if (ValidationError.is(caught) || caught instanceof ForbiddenError) throw caught;

      const message = caught instanceof Error ? caught.message : String(caught);
      const terminal = HookNames.isTerminal(hook);
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
