import type { HookName } from "./hook-name";

/** The `HookName` vocabulary, as values. */
export class HookNames {
  static readonly All: readonly HookName[] = [
    "entry.beforeValidate",
    "entry.beforeWrite",
    "entry.afterWrite",
    "entry.beforeDelete",
    "entry.afterDelete",
    "collection.afterDelete",
  ];

  /**
   * Hooks that run after the write has already committed.
   *
   * A fault in one of these can never fail the request — there is nothing left
   * to fail, and turning it into a 500 would invite a retry that writes the
   * entry twice (§13.9).
   */
  static readonly Terminal: readonly HookName[] = [
    "entry.afterWrite",
    "entry.afterDelete",
    "collection.afterDelete",
  ];

  /**
   * Hooks that can change or stop a write, as opposed to observing one.
   *
   * The grant UI leads with these (D34): a plugin holding `entry.beforeValidate`
   * over a collection can rewrite everything written to it, which is a strictly
   * larger authority than `entries:update` and must not be presented as a
   * lesser one.
   */
  static readonly Intervening: readonly HookName[] = [
    "entry.beforeValidate",
    "entry.beforeWrite",
    "entry.beforeDelete",
  ];

  static isHookName(value: unknown): value is HookName {
    return typeof value === "string" && (HookNames.All as readonly string[]).includes(value);
  }

  static isTerminal(name: HookName): boolean {
    return (HookNames.Terminal as readonly string[]).includes(name);
  }

  static isIntervening(name: HookName): boolean {
    return (HookNames.Intervening as readonly string[]).includes(name);
  }
}
