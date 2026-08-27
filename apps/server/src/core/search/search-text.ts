import { JsonPath } from "@silo/shared/json-path";
import type { PathSelector } from "@silo/shared/path-selector";
import { SearchFields } from "@silo/shared/search-fields";
import { MediaRef } from "@silo/shared/media-ref";
import type { SearchField } from "./search-field";

/** What an entry contributes to the index (D30). */
export interface ExtractedText {
  /** Weighted text — `bm25(fts, 10.0, 1.0)` ranks a hit here above `body`. */
  label: string;
  body: string;
  /** Per-node text, which is what a snippet can be cut from. */
  fields: SearchField[];
}

/**
 * Turns an entry's data into indexable text, guided by the collection's
 * `x-silo-search` (D30).
 *
 * This runs on the **caller** side of the storage port, exactly as media
 * usages do (D23): it needs the schema, and no adapter should ever have one.
 * That is also why the result travels as a value rather than being recomputed
 * — two engines deriving "the searchable text of an entry" independently is
 * the drift this design exists to avoid.
 */
export class SearchText {
  /** Enough text for any real document; a cap keeps one pathological field
   *  from crowding out the fields that matter. */
  static readonly DefaultMaxBytes = 64 * 1024;

  private static readonly Empty: ExtractedText = { label: "", body: "", fields: [] };

  static extract(data: unknown, schema?: unknown, maxBytes = SearchText.DefaultMaxBytes): ExtractedText {
    if (data === null || typeof data !== "object") return SearchText.Empty;

    const config = SearchFields.read(schema);
    const includes = config.include?.map((p) => JsonPath.parse(p).selectors);
    const excludes = config.exclude.map((p) => JsonPath.parse(p).selectors);
    const labels = config.label.map((p) => JsonPath.parse(p).selectors);

    const nodes: { selectors: PathSelector[]; text: string }[] = [];
    let budget = maxBytes;
    SearchText.walk(data, [], nodes, () => budget, (spent) => (budget -= spent));

    const fields: SearchField[] = [];
    for (const node of nodes) {
      if (includes && !includes.some((sel) => SearchText.covers(sel, node.selectors))) continue;
      if (excludes.some((sel) => SearchText.covers(sel, node.selectors))) continue;
      fields.push({
        path: SearchText.render(node.selectors),
        text: node.text,
        label: labels.some((sel) => SearchText.covers(sel, node.selectors)),
      });
    }

    return {
      label: fields.filter((f) => f.label).map((f) => f.text).join("\n"),
      body: fields.filter((f) => !f.label).map((f) => f.text).join("\n"),
      fields,
    };
  }

  /**
   * Whether a configured path covers a node — matched as a **prefix**, so
   * `exclude: ["$.data.internal"]` removes the whole subtree beneath it rather
   * than only a scalar that happens to sit at that exact path.
   */
  private static covers(config: readonly PathSelector[], node: readonly PathSelector[]): boolean {
    if (config.length > node.length) return false;
    for (let i = 0; i < config.length; i++) {
      const c = config[i];
      const n = node[i];
      if (c.kind === "wildcard") continue;
      if (c.kind === "name" && (n.kind !== "name" || n.name !== c.name)) return false;
      if (c.kind === "index" && (n.kind !== "index" || n.index !== c.index)) return false;
    }
    return true;
  }

  private static walk(
    value: unknown,
    selectors: PathSelector[],
    out: { selectors: PathSelector[]; text: string }[],
    remaining: () => number,
    spend: (n: number) => void
  ): void {
    if (remaining() <= 0) return;

    if (typeof value === "string") {
      // A media reference is an id, not prose. Indexing it would make every
      // entry that embeds the same asset match a search for its ULID.
      if (MediaRef.is(value) || value.startsWith("data:")) return;
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      const text = trimmed.length > remaining() ? trimmed.slice(0, remaining()) : trimmed;
      spend(text.length);
      out.push({ selectors: [...selectors], text });
      return;
    }

    if (typeof value === "number") {
      const text = String(value);
      spend(text.length);
      out.push({ selectors: [...selectors], text });
      return;
    }

    // Booleans and nulls carry no text worth a token — `true` would otherwise
    // become a term matching every entry that has any boolean field set.
    if (value === null || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        SearchText.walk(value[i], [...selectors, { kind: "index", index: i }], out, remaining, spend);
      }
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Field *names* are never indexed: a search for "title" must not return
      // every entry that has a title.
      SearchText.walk(child, [...selectors, { kind: "name", name: key }], out, remaining, spend);
    }
  }

  private static render(selectors: readonly PathSelector[]): string {
    let out = "$." + JsonPath.DataField;
    for (const s of selectors) {
      if (s.kind === "name") {
        out += /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.name)
          ? `.${s.name}`
          : `['${s.name.replace(/(['\\])/g, "\\$1")}']`;
      } else if (s.kind === "index") {
        out += `[${s.index}]`;
      } else {
        out += "[*]";
      }
    }
    return out;
  }
}
