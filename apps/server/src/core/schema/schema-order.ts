import { SiloRef } from "@silo/shared/silo-ref";
import { CodepointOrder } from "../query/codepoint-order";

/** What one schema node says about the keys of the objects it describes. */
interface NodeOrder {
  /** Declared property names, in the order the schema lists them. */
  declared: string[];
  /** The subschema for each declared name, to order the value beneath it. */
  children: Map<string, any>;
  /** The subschema for a name the node does not declare, when it has one. */
  undeclared: (key: string) => any;
  /** The subschema for array element `index`. */
  element: (index: number) => any;
}

/**
 * The order an entry's fields leave silo in (D93): the order its schema
 * declares them, and then every field the schema does not name, in codepoint
 * order. Applied at every depth, where entries leave silo — the API and the
 * archive — so every storage adapter answers the same bytes whatever order a
 * field was written in, and whether or not its store keeps one (jsonb does not).
 *
 * Array elements are data and keep their order. Integer-like keys still come
 * first, in ascending order: JavaScript objects enumerate them that way.
 */
export class SchemaOrder {
  /** Deeper than any schema describes; below it data is returned as it is. */
  private static readonly MaxDepth = 64;
  /** How many `$ref` hops one node may take before it is treated as opaque. */
  private static readonly MaxRefHops = 16;

  private static readonly compiled = new WeakMap<object, NodeOrder>();

  /** `data` with its keys in schema order. `schema` may be absent, which
   *  orders every key by codepoint. */
  static apply<T>(data: T, schema?: any): T {
    return SchemaOrder.walk(data, schema, schema, 0) as T;
  }

  private static walk(value: unknown, node: any, root: any, depth: number): unknown {
    if (value === null || typeof value !== "object" || depth >= SchemaOrder.MaxDepth) return value;
    const order = SchemaOrder.orderOf(node, root);

    if (Array.isArray(value)) {
      return value.map((item, index) => SchemaOrder.walk(item, order?.element(index), root, depth + 1));
    }

    const record = value as Record<string, unknown>;
    const entries: [string, unknown][] = [];
    const placed = new Set<string>();
    for (const key of order?.declared ?? []) {
      if (!Object.hasOwn(record, key)) continue;
      entries.push([key, SchemaOrder.walk(record[key], order!.children.get(key), root, depth + 1)]);
      placed.add(key);
    }
    const rest = Object.keys(record)
      .filter((key) => !placed.has(key))
      .sort(CodepointOrder.compare);
    for (const key of rest) {
      entries.push([key, SchemaOrder.walk(record[key], order?.undeclared(key), root, depth + 1)]);
    }
    // `fromEntries` defines own properties, so a `__proto__` key stays a key.
    return Object.fromEntries(entries);
  }

  private static orderOf(node: any, root: any): NodeOrder | null {
    const resolved = SchemaOrder.resolve(node, root);
    if (!resolved) return null;
    let order = SchemaOrder.compiled.get(resolved);
    if (!order) {
      order = SchemaOrder.compile(resolved, root);
      SchemaOrder.compiled.set(resolved, order);
    }
    return order;
  }

  /**
   * One node's declared keys, gathered from the node itself and then from the
   * subschemas it is combined with (`allOf`, `anyOf`, `oneOf`, `then`, `else`),
   * in that order. A key declared twice takes its first subschema.
   */
  private static compile(node: any, root: any): NodeOrder {
    const branches = SchemaOrder.branches(node, root);
    const declared: string[] = [];
    const children = new Map<string, any>();
    for (const branch of branches) {
      const properties = branch.properties;
      if (!properties || typeof properties !== "object") continue;
      for (const key of Object.keys(properties)) {
        if (children.has(key)) continue;
        declared.push(key);
        children.set(key, properties[key]);
      }
    }

    const patterns: [RegExp, any][] = [];
    for (const branch of branches) {
      for (const [pattern, schema] of Object.entries(branch.patternProperties ?? {})) {
        const regex = SchemaOrder.regex(pattern);
        if (regex) patterns.push([regex, schema]);
      }
    }
    const additional = branches.find(
      (branch) => branch.additionalProperties && typeof branch.additionalProperties === "object"
    )?.additionalProperties;
    const undeclared = (key: string) =>
      patterns.find(([regex]) => regex.test(key))?.[1] ?? additional;
    const element = (index: number) => {
      for (const branch of branches) {
        if (Array.isArray(branch.prefixItems) && index < branch.prefixItems.length) {
          return branch.prefixItems[index];
        }
        if (branch.items && typeof branch.items === "object") return branch.items;
      }
      return undefined;
    };
    return { declared, children, undeclared, element };
  }

  /** The node and every subschema combined with it, each `$ref` resolved. */
  private static branches(node: any, root: any, seen = new Set<object>()): any[] {
    const resolved = SchemaOrder.resolve(node, root);
    if (!resolved || seen.has(resolved)) return [];
    seen.add(resolved);

    const out = [resolved];
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const list = resolved[keyword];
      if (!Array.isArray(list)) continue;
      for (const item of list) out.push(...SchemaOrder.branches(item, root, seen));
    }
    for (const keyword of ["then", "else"]) {
      if (resolved[keyword]) out.push(...SchemaOrder.branches(resolved[keyword], root, seen));
    }
    return out;
  }

  /**
   * Follows `$ref` to the node it names. A stored schema is bundled (D54), so a
   * `silo://collections/<name>` or remote ref names a key of the root's
   * `$defs`, and a `#/...` pointer names a place in the root itself. A ref that
   * does not resolve leaves the node's own keywords.
   */
  private static resolve(node: any, root: any): any {
    let current = node;
    for (let hop = 0; hop < SchemaOrder.MaxRefHops; hop++) {
      if (!current || typeof current !== "object" || typeof current.$ref !== "string") {
        return current && typeof current === "object" ? current : null;
      }
      const target = SchemaOrder.target(current.$ref, root);
      if (!target) return current;
      current = target;
    }
    return current;
  }

  private static target(ref: string, root: any): any {
    if (!root || typeof root !== "object") return null;
    if (ref.startsWith("#")) return SchemaOrder.pointer(ref.slice(1), root);

    const defs = root.$defs;
    if (!defs || typeof defs !== "object") return null;
    // The bundler files a collection under its name and a remote ref under its URL.
    const key = SiloRef.isLocal(ref) ? SiloRef.collectionOf(ref) : ref;
    return Object.hasOwn(defs, key) ? defs[key] : null;
  }

  /** A JSON Pointer (RFC 6901) into `root`, or null when it names nothing. */
  private static pointer(pointer: string, root: any): any {
    let node = root;
    for (const raw of pointer.split("/").filter(Boolean)) {
      let segment: string;
      try {
        segment = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      } catch {
        return null;
      }
      if (!node || typeof node !== "object" || !Object.hasOwn(node, segment)) return null;
      node = node[segment];
    }
    return node;
  }

  /** A `patternProperties` key as a regex, or null for one that does not compile. */
  private static regex(pattern: string): RegExp | null {
    try {
      return new RegExp(pattern, "u");
    } catch {
      return null;
    }
  }
}
