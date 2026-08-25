/**
 * A dispatch that outlived its budget (§13.9).
 *
 * Its own class because the remedy differs from every other plugin fault: the
 * host is torn down rather than retried, since a plugin that missed its budget
 * is usually still running and will never answer.
 */
export class PluginTimeoutError extends Error {
  readonly plugin: string;
  readonly hook: string;

  constructor(plugin: string, hook: string, timeoutMs: number) {
    super(`plugin "${plugin}" exceeded ${timeoutMs}ms in ${hook}`);
    this.name = "PluginTimeoutError";
    this.plugin = plugin;
    this.hook = hook;
  }
}
