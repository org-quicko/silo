/** What a plugin may call back into. Implemented by `PluginContext`, which
 *  checks every call against the claims the operator granted. */
export interface PluginRpc {
  call(method: string, args: readonly unknown[]): Promise<unknown>;
  log(level: string, message: string, fields?: Record<string, unknown>): void;
}
