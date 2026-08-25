import type { ResolvedGrant } from "./resolved-grant";

/**
 * One plugin's authority, in a cell that both readers share (D39, phase 4).
 *
 * A `ResolvedGrant` used to be captured twice at load: once on `PluginRuntime`,
 * where `HookBus` reads it to decide whether an event may cross into the worker,
 * and once inside `PluginContext`, where it becomes the injected principal. Two
 * copies of one fact is exactly the shape §13.15 refused to half-fix — a plugin
 * whose `ctx` is dead while its hooks still fire is not a smaller bug than one
 * that keeps both, it is a **new inconsistent state**, and it is what revoking
 * against two snapshots produces if either is missed.
 *
 * So there is one cell and two readers, and `set` is the whole of live
 * revocation: the next hook delivery and the next `ctx.fetch` read the same
 * assignment, in that order or the other, and neither can see the old grant
 * after it. Nothing is torn down — a plugin is an API key with code attached,
 * and changing what a key may do has never meant restarting whoever holds it.
 */
export class PluginAuthority {
  private grant: ResolvedGrant;

  constructor(grant: ResolvedGrant) {
    this.grant = grant;
  }

  /** Read at every decision point rather than destructured once, which is the
   *  only discipline that makes the cell mean anything. */
  current(): ResolvedGrant {
    return this.grant;
  }

  set(grant: ResolvedGrant): void {
    this.grant = grant;
  }
}
