import type { HookName } from "../../core/hooks";
import type { HookEvent } from "../../core/hooks";
import { PluginError } from "./plugin-error";
import type { PluginHost } from "./plugin-host";
import type { PluginHostOptions } from "./plugin-host-options";
import { PluginTimeoutError } from "./plugin-timeout-error";
import { WorkerSource } from "./worker-source";

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The dispatch's causal chain, kept so a callback arriving mid-dispatch can
   *  be told which one it belongs to (D33). */
  cause: readonly string[];
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
    const missing = this.options.declared.filter((h) => !exported.includes(h));
    if (missing.length > 0) {
      throw new Error(
        `plugin "${this.options.name}": declares ${missing.join(", ")} but exports no such function.`
      );
    }
    return this.options.declared;
  }

  async dispatch(hook: HookName, event: HookEvent): Promise<unknown> {
    if (this.dead) throw this.dead;
    const worker = this.worker;
    if (!worker) throw new Error(`plugin "${this.options.name}": not started`);

    // The chain stays host-side and crosses as a count. A plugin needs to know
    // how deeply nested it is; it has no business learning which *other*
    // plugins are installed, which the chain would disclose on every event.
    const { chain, ...payload } = event;
    const id = ++this.seq;

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        const err = new PluginTimeoutError(this.options.name, hook, this.options.timeoutMs);
        this.kill(err);
        reject(err);
      }, this.options.timeoutMs);

      this.waiters.set(id, { resolve, reject, timer, cause: chain });
      worker.postMessage({
        t: "dispatch",
        id,
        hook,
        event: { ...payload, depth: chain.length },
      });
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
   * The chain comes from the waiter the worker correlated this call to, not
   * from the message — a plugin that named its own nesting could hand itself an
   * empty one and escape both the cycle skip and the depth bound (D33). An
   * unknown dispatch id is an empty chain: a call from a timer or a future
   * `activate()` is genuinely uncaused, and `PluginContext` still appends the
   * plugin itself.
   */
  private async serveRpc(msg: any): Promise<void> {
    const cause = this.waiters.get(msg.dispatch)?.cause ?? [];
    try {
      const value = await this.options.rpc.call(msg.method, msg.args ?? [], cause);
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

  async stop(): Promise<void> {
    if (!this.dead) this.dead = new Error(`plugin "${this.options.name}": stopped`);
    this.kill(this.dead);
  }
}
