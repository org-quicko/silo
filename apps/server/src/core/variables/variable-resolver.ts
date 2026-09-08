import { VariableTemplate } from "@silo/shared/variable-template";
import type { VariableValues } from "./variable-values";

/**
 * Walks an entry's data and substitutes `{{NAME}}` in every string it holds
 * (D57).
 *
 * `MediaResolver`'s counterpart, with one deliberate difference: this walk is
 * **not schema-driven**. A media field is media because the schema says so, but
 * a template is a template because the author typed it, so gating substitution
 * on a declared field kind would mean the syntax worked in the fields somebody
 * remembered to mark and silently did not in the rest. Walking every string
 * costs nothing extra here — the walk already had to descend the whole value
 * for media — and the blast radius is small, because a name nothing declares is
 * copied through untouched (`VariableTemplate`).
 *
 * Runs **after** `MediaResolver`, so a resolved media URL is never re-scanned
 * for templates it never contained, and a `{{NAME}}` inside a media *reference*
 * is not something this can create.
 *
 * Object **keys** are never substituted, only values. A key is a field name
 * that a schema, a filter path and a search index all address; letting an
 * environment rename one would make the same entry a different shape per
 * environment.
 */
export class VariableResolver {
  /**
   * How deep the walk goes. Entry data is validated against a schema before it
   * is stored, but an untyped `{}` property accepts anything, so the depth of a
   * document is caller-controlled and a plain recursive walk is a stack the
   * caller chooses the height of. The same bounded-on-purpose posture
   * `MediaLinkResolver` takes about lookups.
   */
  private static readonly MaxDepth = 64;

  /** `data` with every template substituted, or `data` itself when there is
   *  nothing to substitute. */
  static resolve<T>(data: T, values: VariableValues): T {
    if (values.isEmpty) return data;
    return VariableResolver.walk(data, values, 0) as T;
  }

  private static walk(node: unknown, values: VariableValues, depth: number): unknown {
    if (typeof node === "string") return VariableTemplate.render(node, values.lookup);
    if (node === null || typeof node !== "object") return node;
    if (depth >= VariableResolver.MaxDepth) return node;

    if (Array.isArray(node)) {
      return node.map((item) => VariableResolver.walk(item, values, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      result[key] = VariableResolver.walk(value, values, depth + 1);
    }
    return result;
  }
}
