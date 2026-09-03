import { SiloRef } from "@silo/shared/silo-ref";

/**
 * Repointing a schema's `silo://collections/<name>` references when that
 * collection is renamed (D51).
 *
 * Two things have to move, not one. The `$ref` strings are the obvious half.
 * The other is `$defs`: `SchemaBundler` embeds each referenced collection under
 * a key that **is** the collection's name, and it regenerates those keys from
 * the refs on every put — overwriting whatever is there — so the new name's def
 * takes care of itself while the old name's is left behind forever. Stripping it
 * here and letting the bundler run is what rebuilds the graph rather than
 * patching it.
 *
 * Pure: the caller re-bundles and re-validates before writing anything.
 */
export class SchemaRefRewrite {
  static apply(schema: any, from: string, to: string): any {
    const fromUrl = SiloRef.url(from);
    const toUrl = SiloRef.url(to);
    const rewritten = SchemaRefRewrite.walk(schema, fromUrl, toUrl);

    // Only the generated def for the old name. Anything the bundler would
    // regenerate needs no help, and anything it would not is not ours to drop.
    if (rewritten && typeof rewritten === "object" && rewritten.$defs) {
      const defs = { ...rewritten.$defs };
      delete defs[from];
      rewritten.$defs = defs;
    }
    return rewritten;
  }

  /** Whether this schema references the collection at all — self-references
   *  included, which is why the caller must not exclude the renamed one. */
  static references(schema: any, name: string): boolean {
    const url = SiloRef.url(name);
    return SchemaRefRewrite.finds(schema, url);
  }

  private static walk(node: any, fromUrl: string, toUrl: string): any {
    if (Array.isArray(node)) {
      return node.map((child) => SchemaRefRewrite.walk(child, fromUrl, toUrl));
    }
    if (!node || typeof node !== "object") return node;

    const next: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        next[key] = SchemaRefRewrite.repoint(value, fromUrl, toUrl);
        continue;
      }
      if (key === "$id" && typeof value === "string") {
        next[key] = SchemaRefRewrite.repoint(value, fromUrl, toUrl);
        continue;
      }
      next[key] = SchemaRefRewrite.walk(value, fromUrl, toUrl);
    }
    return next;
  }

  /** The fragment is preserved: `silo://collections/a#/$defs/x` keeps `#/…`. */
  private static repoint(value: string, fromUrl: string, toUrl: string): string {
    if (value === fromUrl) return toUrl;
    if (value.startsWith(fromUrl + "#")) return toUrl + value.slice(fromUrl.length);
    return value;
  }

  private static finds(node: any, url: string): boolean {
    if (Array.isArray(node)) {
      return node.some((child) => SchemaRefRewrite.finds(child, url));
    }
    if (!node || typeof node !== "object") return false;

    const ref = node.$ref;
    if (typeof ref === "string" && (ref === url || ref.startsWith(url + "#"))) return true;
    return Object.values(node).some((child) => SchemaRefRewrite.finds(child, url));
  }
}
