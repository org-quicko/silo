import { ValidationError } from "../errors/validation-error";
import { JsonPath } from "../query/path/json-path";

/** What `x-silo-search` says about one collection (D30). */
export interface SearchFieldsConfig {
  /** Paths whose text carries extra weight — titles and the like. */
  label: string[];
  /**
   * When present, an allow-list that **replaces** the default corpus. An
   * additive reading would mean nothing: the default is already everything.
   */
  include?: string[];
  /** Paths whose text is kept out of the index, subtrees included. */
  exclude: string[];
}

/**
 * The `x-silo-search` schema keyword, which selects what of an entry reaches
 * the search index (D30). It sits beside `x-silo-auth` and `x-silo-type` for
 * the same reason those do: the server enforces it and the admin UI's schema
 * editor writes it, so one disagreement about what it means is a bug in two
 * places.
 *
 * Its values are D29 paths rather than property names, so it can reach a node
 * inside an array of objects (`$.data.blocks[*].text`) — which a per-property
 * keyword cannot address at all — and so a schema composed through `oneOf` or
 * a `silo://` `$ref` needs no walk to collect the marks.
 *
 * `exclude` is **not** an access control. It keeps text out of the index; a
 * read of the entry still returns the field.
 */
export class SearchFields {
  static readonly Keyword = "x-silo-search";

  private static readonly Empty: SearchFieldsConfig = { label: [], exclude: [] };

  /** The config a schema declares, or the default when it declares none. */
  static read(schema: unknown): SearchFieldsConfig {
    if (!schema || typeof schema !== "object") return SearchFields.Empty;
    const raw = (schema as Record<string, unknown>)[SearchFields.Keyword];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return SearchFields.Empty;

    const node = raw as Record<string, unknown>;
    const include = SearchFields.paths(node.include);
    return {
      label: SearchFields.paths(node.label) ?? [],
      include: include && include.length > 0 ? include : undefined,
      exclude: SearchFields.paths(node.exclude) ?? [],
    };
  }

  /**
   * Checked when a schema is saved, so a typo is a `400` and not a field that
   * quietly stops being searchable — the kind of failure nobody reports
   * because nothing looks broken.
   */
  static validate(schema: unknown): void {
    if (!schema || typeof schema !== "object") return;
    const raw = (schema as Record<string, unknown>)[SearchFields.Keyword];
    if (raw === undefined) return;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ValidationError(
        `"${SearchFields.Keyword}" must be an object with "label", "include" and/or "exclude" path arrays`
      );
    }

    const node = raw as Record<string, unknown>;
    for (const key of Object.keys(node)) {
      if (key !== "label" && key !== "include" && key !== "exclude") {
        throw new ValidationError(
          `"${SearchFields.Keyword}" has no "${key}" setting; expected "label", "include" or "exclude"`
        );
      }
      const value = node[key];
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new ValidationError(
          `"${SearchFields.Keyword}.${key}" must be an array of paths`
        );
      }
      for (const p of value as string[]) {
        const parsed = JsonPath.parse(p);
        // The envelope is indexed by the engine itself and is the same for
        // every collection, so pointing this keyword at it would either do
        // nothing or silently duplicate — say so instead.
        if (parsed.isEnvelope) {
          throw new ValidationError(
            `"${SearchFields.Keyword}.${key}" takes paths into entry data; "${p}" addresses the envelope`
          );
        }
      }
    }
  }

  private static paths(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter((v): v is string => typeof v === "string");
  }
}
