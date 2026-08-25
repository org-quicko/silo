import { JsonPath } from "@silo/shared/json-path";
import type { PathSelector } from "@silo/shared/path-selector";
import type { Entry } from "../domain/entry";
import { QueryUtils } from "./query-utils";

/**
 * Reading a D29 path out of an entry in memory, and ordering the values it
 * yields.
 *
 * This lives in `core` rather than in the fs adapter because two callers need
 * it now — the adapter's filter evaluator and `ScanSearcher`, which sorts
 * results it has gathered across collections. A second copy would be a second
 * definition of what a path selects.
 */
export class EntryNodes {
  /**
   * Every node a path selects, in document order. An empty result means the
   * path selected nothing, which every leaf operator reads as false (D29).
   */
  static select(e: Entry, path: JsonPath): any[] {
    if (path.isEnvelope) {
      switch (path.root) {
        case "id":
          return [e.id];
        case "rev":
          return [e.rev];
        case "created_at":
          return [EntryNodes.iso(e.created_at)];
        case "updated_at":
          return [EntryNodes.iso(e.updated_at)];
      }
      return [];
    }

    let nodes: any[] = [e.data];
    for (const sel of path.selectors) {
      const next: any[] = [];
      for (const node of nodes) {
        EntryNodes.step(node, sel, next);
      }
      nodes = next;
      if (nodes.length === 0) break;
    }
    return nodes;
  }

  /** The single node a singular path selects, or `undefined`. */
  static sortValue(e: Entry, rawPath: string): any {
    const nodes = EntryNodes.select(e, QueryUtils.sortPath(rawPath));
    return nodes.length > 0 ? nodes[0] : undefined;
  }

  private static step(node: any, sel: PathSelector, out: any[]): void {
    if (node === null || typeof node !== "object") return;

    if (sel.kind === "name") {
      // A name selector addresses object members only, and `hasOwn` is what
      // separates an absent field from one holding JSON `null` — the
      // distinction `exists` exists to expose.
      if (Array.isArray(node)) return;
      if (Object.hasOwn(node, sel.name)) out.push(node[sel.name]);
      return;
    }

    if (sel.kind === "index") {
      if (!Array.isArray(node)) return;
      const i = sel.index < 0 ? node.length + sel.index : sel.index;
      if (i >= 0 && i < node.length) out.push(node[i]);
      return;
    }

    // Wildcard: every child of an array or an object, and nothing from a
    // scalar — which is why `$.data.tags[*]` does not match a `tags` that is a
    // plain string, matching the SQL side's type guard.
    for (const v of Array.isArray(node) ? node : Object.values(node)) out.push(v);
  }

  private static iso(v: Date | string): string {
    return v instanceof Date ? v.toISOString() : String(v);
  }

  static compare(a: any, b: any): number {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
    if (b === null || b === undefined) return 1;

    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b);
    }
    if (typeof a === "boolean" && typeof b === "boolean") {
      return a === b ? 0 : a ? 1 : -1;
    }
    return 0;
  }
}
