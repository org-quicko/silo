import type { HookName } from "./hook-name";

/** The `HookName` vocabulary, as values. */
export class HookNames {
  static readonly All: readonly HookName[] = [
    "entry.beforeValidate",
    "entry.beforeWrite",
    "entry.afterWrite",
    "entry.beforeDelete",
    "entry.afterDelete",
  ];

  /**
   * Hooks that run after the write has already committed.
   *
   * A fault in one of these can never fail the request — there is nothing left
   * to fail, and turning it into a 500 would invite a retry that writes the
   * entry twice (§13.9).
   */
  static readonly Terminal: readonly HookName[] = ["entry.afterWrite", "entry.afterDelete"];

  static isHookName(value: unknown): value is HookName {
    return typeof value === "string" && (HookNames.All as readonly string[]).includes(value);
  }

  static isTerminal(name: HookName): boolean {
    return (HookNames.Terminal as readonly string[]).includes(name);
  }
}
