import type { HookName } from "../../core/hooks";
import type { HookEvent } from "../../core/hooks";
import { PluginError } from "./plugin-error";
import type { PluginHost } from "./plugin-host";
import type { PluginHostOptions } from "./plugin-host-options";
import type { PluginServeRequest } from "./plugin-serve-request";
import type { PluginServeResponse } from "./plugin-serve-response";
import { PluginTimeoutError } from "./plugin-timeout-error";
import { WorkerSource } from "./worker-source";

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The dispatch's causal chain, kept so a callback arriving mid-dispatch can
   *  be told which one it belongs to (D33). */
  cause: readonly string[];
  /** When this dispatch's budget runs out, as a monotonic-ish wall clock. A
   *  `ctx.fetch` made from inside it is bounded by what is left rather than by
   *  a budget of its own, so a slow call rejects itself instead of the worker
   *  being killed for the dispatch it was slowing down (D35). */
  deadline: number;
}

/**
 * Runs one extension plugin in its own `Worker` (D31/§13.4).
 *
 * One worker per plugin, not one shared worker, so a plugin that has to be torn
 * down takes only itself with it. Cold start is ~20 ms each, paid once at boot.
 *
 * This is what makes `timeout_ms` mean anything: JavaScript has no preemption,
 * so a synchronous spin in-process ignores every timer the host sets, and only
 * a separate thread the host can `terminate()` survives one. Measured rather
 * than assumed — a `while(true){}` plugin leaves the host answering requests.
 *
 * It bounds **faults, not malice** (§13.4). Worker code holds full Bun
 * privileges and can read the database or open a socket; the trust boundary is
 * the act of installing the plugin.
 */
export class WorkerHost implements PluginHost {
  private readonly options: PluginHostOptions;
  private worker: Worker | null = null;
  private readonly waiters = new Map<number, Waiter>();
  private seq = 0;

  /**
   * Set when the worker has been torn down and must not be used again.
   *
   * There is no auto-restart. A plugin that missed its budget is usually still
   * spinning, so restarting it walks into the same wall a moment later while
   * hiding that anything happened; `on_error` already says what the operator
   * wants done when the plugin is unavailable, and this makes the answer
   * consistent instead of racing a respawn.
   */
  private dead: Error | null = null;

  /** Whether `activate()` has already run. The boot pass and a live `enable` both
   *  drive activation and neither knows about the other, so idempotence lives
   *  here rather than in a rule each caller has to remember (D36). */
  private activated = false;

  constructor(options: PluginHostOptions) {
    this.options = options;
  }

  async start(): Promise<readonly HookName[]> {
    const worker = new Worker(WorkerSource.url(), { type: "module" });
    this.worker = worker;

    return await new Promise<readonly HookName[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill(new PluginTimeoutError(this.options.name, "start", this.options.timeoutMs));
        reject(new Error(`plugin "${this.options.name}": worker did not start within ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      worker.onerror = (event: any) => {
        clearTimeout(timer);
        reject(new Error(`plugin "${this.options.name}": ${event?.message ?? String(event)}`));
      };

      worker.onmessage = (event: MessageEvent) => {
        const msg: any = event.data;

        if (msg.t === "booted") {
          worker.postMessage({
            t: "init",
            entry: this.options.entry,
            config: this.options.config,
            declared: this.options.declared,
            routes: this.options.routes,
            runtime: this.options.runtime,
          });
          return;
        }

        if (msg.t === "ready") {
          clearTimeout(timer);
          worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
          // Replace the start-time handler. Without this the original stays
          // installed, closing over an already-settled promise, so a worker
          // that dies mid-dispatch resolves nothing and every pending call
          // waits out its full budget — a crash reported as a timeout, which
          // sends whoever debugs it looking for a slow plugin instead of a
          // broken one.
          worker.onerror = (e: any) =>
            this.kill(new Error(`plugin "${this.options.name}": worker died — ${e?.message ?? String(e)}`));
          // Inside the try, because this runs in a message callback rather than
          // in the executor: a throw here would escape into the event handler
          // and leave `start()` hanging until its timeout instead of rejecting
          // with the reason.
          try {
            resolve(this.reconcile(msg.hooks));
          } catch (caught) {
            reject(caught as Error);
          }
          return;
        }

        if (msg.t === "init-error") {
          clearTimeout(timer);
          const err = PluginError.fromWire(msg.error);
          reject(new Error(`plugin "${this.options.name}": failed to load — ${err.message}`));
        }
      };
    });
  }

  /**
   * The hooks the module actually exports, checked against what it declared.
   *
   * A declared hook with no matching export is refused rather than ignored:
   * the manifest is what an operator reads to know what a plugin does, and a
   * plugin that declares `entry.beforeWrite` and does not implement it looks
   * from the outside exactly like one whose guard is running.
   */
  private reconcile(exported: string[]): readonly HookName[] {
    const declared = [...this.options.declared, ...this.options.routes];
    if (this.options.runtime) declared.push("activate", "deactivate");
    const missing = declared.filter((h) => !exported.includes(h));
    if (missing.length > 0) {
      throw new Error(
        `plugin "${this.options.name}": declares ${missing.join(", ")} but exports no such function.`
      );
    }
    return this.options.declared;
  }

  async dispatch(hook: HookName, event: HookEvent): Promise<unknown> {
    // The chain stays host-side and crosses as a count. A plugin needs to know
    // how deeply nested it is; it has no business learning which *other*
    // plugins are installed, which the chain would disclose on every event.
    const { chain, ...payload } = event;
    return await this.call(hook, chain, (id) => ({
      t: "dispatch",
      id,
      hook,
      event: { ...payload, depth: chain.length },
    }));
  }

  /**
   * Serve one route (D36, phase 6).
   *
   * The chain is empty because a request is where causality *starts* — nobody's
   * hook caused it. `PluginContext` appends this plugin to whatever it is given,
   * so a `ctx` write from a route handler still carries the plugin's own name
   * and still cannot re-enter the plugin's own hooks (D33). What stops a plugin
   * reaching its **own route** through `ctx.fetch` is the same chain, read one
   * level up by `ExtRoutes`.
   */
  async serve(key: string, request: PluginServeRequest): Promise<PluginServeResponse> {
    const answer = await this.call(key, [], (id) => ({ t: "serve", id, key, request }));
    return answer as PluginServeResponse;
  }

  /**
   * Run `activate(ctx)` once (D36).
   *
   * Bounded by `timeout_ms` like any other call, so a plugin that hangs in
   * `activate` is torn down rather than holding the boot open — and because a
   * refused start is the honest outcome, the rejection propagates instead of
   * being logged. The chain is empty: activation is where causality *starts*, so
   * a `ctx` write from here dispatches hooks to every other plugin and, through
   * `PluginContext` appending this plugin's own name, never back to this one.
   */
  async activate(): Promise<void> {
    if (!this.options.runtime || this.activated) return;
    this.activated = true;
    try {
      await this.call("activate", [], (id) => ({ t: "activate", id }));
    } catch (caught) {
      // Named, the way `HookBus.run` names a failing hook. A plugin's `activate`
      // throws the plugin's *own* error — a `NotFoundError` about a collection,
      // say — and unwrapped that refuses the start with a sentence mentioning
      // neither a plugin nor activation. Measured on a running instance: the
      // whole report was `silo: collection "default/prod/mirrors" not found`.
      const message = caught instanceof Error ? caught.message : String(caught);
      throw new Error(`plugin "${this.options.name}" failed in activate: ${message}`);
    }
  }

  /**
   * Run `deactivate(ctx)` and swallow whatever it does (D36).
   *
   * Best-effort on purpose, and for the reason `entry.afterWrite` is: by the time
   * this runs the decision to stop has been taken, and there is nothing a failure
   * here could usefully change. A plugin that hangs in `deactivate` costs one
   * `timeout_ms` and is then terminated regardless, which is what stops a badly
   * written cleanup from holding a shutdown or a `disable` open forever.
   */
  private async deactivate(): Promise<void> {
    if (!this.options.runtime || !this.activated || this.dead) return;
    await this.call("deactivate", [], (id) => ({ t: "deactivate", id })).catch(() => {});
  }

  /**
   * One round trip into the worker, bounded and correlated.
   *
   * Shared by `dispatch` and `serve` because every property that makes the
   * timeout mean anything is the same for both: one budget, one waiter, and a
   * tear-down that is permanent. Two copies of this would be two places for
   * "does missing the budget kill the worker" to be answered, and §13.9 needs
   * exactly one.
   */
  private async call(
    what: string,
    chain: readonly string[],
    message: (id: number) => Record<string, unknown>
  ): Promise<unknown> {
    if (this.dead) throw this.dead;
    const worker = this.worker;
    if (!worker) throw new Error(`plugin "${this.options.name}": not started`);

    const id = ++this.seq;
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        const err = new PluginTimeoutError(this.options.name, what, this.options.timeoutMs);
        this.kill(err);
        reject(err);
      }, this.options.timeoutMs);

      this.waiters.set(id, {
        resolve,
        reject,
        timer,
        cause: chain,
        deadline: Date.now() + this.options.timeoutMs,
      });
      worker.postMessage(message(id));
    });
  }

  private onMessage(msg: any): void {
    if (msg.t === "result") {
      const waiter = this.waiters.get(msg.id);
      if (!waiter) return;
      this.waiters.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.ok) waiter.resolve(msg.value);
      else waiter.reject(PluginError.fromWire(msg.error));
      return;
    }

    if (msg.t === "log") {
      this.options.rpc.log(msg.level, msg.message, msg.fields);
      return;
    }

    if (msg.t === "rpc") {
      // Not awaited: the worker is blocked on its own promise, and awaiting
      // here would serialise every plugin's callbacks behind one another.
      void this.serveRpc(msg);
    }
  }

  /**
   * The chain and the budget both come from the waiter the worker correlated
   * this call to, not from the message — a plugin that named its own nesting
   * could hand itself an empty one and escape both the cycle skip and the depth
   * bound (D33), and a plugin that named its own deadline could hand itself an
   * unbounded one (D35).
   *
   * An unknown dispatch id is an empty chain and the full budget: a call from a
   * timer or a future `activate()` is genuinely uncaused and has no deadline
   * over it, so it gets one of its own rather than none at all.
   */
  private async serveRpc(msg: any): Promise<void> {
    const waiter = this.waiters.get(msg.dispatch);
    const dispatch = {
      cause: waiter?.cause ?? [],
      budgetMs: waiter ? waiter.deadline - Date.now() : this.options.timeoutMs,
    };
    try {
      const value = await this.options.rpc.call(msg.method, msg.args ?? [], dispatch);
      this.worker?.postMessage({ t: "rpc-result", id: msg.id, ok: true, value: value ?? null });
    } catch (caught) {
      this.worker?.postMessage({ t: "rpc-result", id: msg.id, ok: false, error: PluginError.toWire(caught) });
    }
  }

  /** Tear the worker down and fail everything still waiting on it. */
  private kill(cause: Error): void {
    this.dead = cause;
    for (const [id, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      this.waiters.delete(id);
      waiter.reject(cause);
    }
    try {
      this.worker?.terminate();
    } catch {
      // Terminating an already-dead worker is not a failure worth reporting.
    }
    this.worker = null;
  }

  /** What `kill` recorded, so a management surface can report a worker that
   *  died hours ago instead of showing it as healthy (D39). */
  failure(): Error | null {
    return this.dead;
  }

  /**
   * Let the plugin clean up, then tear the worker down.
   *
   * `deactivate` runs **before** `dead` is set, because a host marked dead
   * refuses every call including this one — and after it, unconditionally, so a
   * plugin whose cleanup throws or hangs still stops.
   */
  async stop(): Promise<void> {
    await this.deactivate();
    if (!this.dead) this.dead = new Error(`plugin "${this.options.name}": stopped`);
    this.kill(this.dead);
  }
}
