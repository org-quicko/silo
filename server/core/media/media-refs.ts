import { MediaRef } from "@silo/shared/media-ref";

/**
 * Extracts the media references an entry's data holds (D23).
 *
 * Deliberately **structural**, not schema-driven: it walks the whole value and
 * collects every string that parses as a reference, whatever the schema says.
 * §7.2 lets an import archive carry `content/<collection>/` with no schema at
 * all, and import validation is off by default, so a schema-driven walk would
 * find no references in exactly the data most likely to have arrived without
 * anyone looking at it — and a missed reference deletes a file still in use.
 *
 * The cost is over-capture: a free-text field holding a literal
 * `silo://media/...` string registers a usage and blocks that asset's
 * deletion. That is visible and recoverable; a missed reference is silent.
 *
 * This is the one extractor. Adapters never parse references themselves — the
 * caller passes the result to `Storage.put`, and the fs adapter (which derives
 * usages by scanning rather than indexing) calls this same function, so the
 * two adapters cannot drift on what counts as a reference.
 */
export class MediaRefs {
  /** Guards against a pathologically deep `data` value. */
  private static readonly MaxDepth = 64;

  static extract(data: unknown): string[] {
    const out = new Set<string>();
    MediaRefs.walk(data, out, 0, new Set());
    return [...out].sort();
  }

  /**
   * The same value with every media reference in canonical `silo://media/<id>`
   * form. Applied on the write path, because reads resolve media fields into
   * absolute URLs (§8.1) and a client that fetches, edits and PUTs an entry
   * back would otherwise hand back a URL where a reference went out — quietly
   * turning a counted reference into an uncounted string.
   *
   * Structural like `extract`, and recognising exactly what `extract`
   * recognises, so what gets stored and what gets counted cannot disagree.
   */
  static canonicalize<T>(data: T): T {
    return MediaRefs.rewrite(data, 0, new Map()) as T;
  }

  private static rewrite(value: unknown, depth: number, seen: Map<object, unknown>): unknown {
    if (depth > MediaRefs.MaxDepth) return value;

    if (typeof value === "string") {
      return MediaRef.canonical(value) ?? value;
    }
    if (!value || typeof value !== "object") return value;

    const cached = seen.get(value as object);
    if (cached !== undefined) return cached;

    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value as object, out);
      for (const item of value) out.push(MediaRefs.rewrite(item, depth + 1, seen));
      return out;
    }

    const out: Record<string, unknown> = {};
    seen.set(value as object, out);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = MediaRefs.rewrite(item, depth + 1, seen);
    }
    return out;
  }

  private static walk(value: unknown, out: Set<string>, depth: number, seen: Set<object>): void {
    if (depth > MediaRefs.MaxDepth) return;

    if (typeof value === "string") {
      const token = MediaRef.token(value);
      if (token) out.add(token);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) MediaRefs.walk(item, out, depth + 1, seen);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      MediaRefs.walk(item, out, depth + 1, seen);
    }
  }
}
