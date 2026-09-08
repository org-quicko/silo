import { VariableTemplate } from "@silo/shared/variable-template";

/**
 * Every variable name a payload references (D57).
 *
 * `MediaRefs.extract`'s counterpart, and the thing that makes resolution cost
 * nothing in the ordinary case: a response whose content holds no `{{…}}` at
 * all asks storage for no variables, exactly as `MediaLinkResolver` skips its
 * lookups when a payload names no asset. Content that *does* reference
 * something pays one filtered read for the whole response, never one per
 * reference, because a project's declarations arrive together.
 */
export class VariableRefs {
  /** The walk is bounded the same way `VariableResolver`'s is, and for the same
   *  reason: an untyped property accepts a document of caller-chosen depth. */
  private static readonly MaxDepth = 64;

  /** The distinct names `payload` references, in first-seen order. */
  static extract(payload: unknown): string[] {
    const names = new Set<string>();
    VariableRefs.walk(payload, names, 0);
    return [...names];
  }

  private static walk(node: unknown, names: Set<string>, depth: number): void {
    if (typeof node === "string") {
      for (const name of VariableTemplate.names(node)) names.add(name);
      return;
    }
    if (node === null || typeof node !== "object" || depth >= VariableRefs.MaxDepth) return;

    if (Array.isArray(node)) {
      for (const item of node) VariableRefs.walk(item, names, depth + 1);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      VariableRefs.walk(value, names, depth + 1);
    }
  }
}
