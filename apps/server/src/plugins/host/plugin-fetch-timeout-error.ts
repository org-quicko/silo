/**
 * One `ctx.fetch` that ran past what its dispatch had left (D35).
 *
 * Deliberately **not** `PluginTimeoutError`, whose remedy is to tear the worker
 * down: this one is handed back to the plugin as an ordinary rejection and the
 * worker keeps running. The distinction is the whole of phase 3's fourth
 * requirement — a hook that outlives its budget is unrecoverable until phase
 * 4's supervisor exists, so a slow *call* has to be catchable rather than fatal.
 *
 * It crosses the clone boundary as a plain error by name, which is correct: it
 * is a fault, not a rejection, so `PluginError.fromWire` must not dress it as
 * one.
 */
export class PluginFetchTimeoutError extends Error {
  readonly plugin: string;

  constructor(plugin: string, method: string, path: string, budgetMs: number) {
    super(
      `plugin "${plugin}": ctx.fetch ${method} ${path} exceeded the ${budgetMs}ms left in its dispatch`
    );
    this.name = "PluginFetchTimeoutError";
    this.plugin = plugin;
  }
}
