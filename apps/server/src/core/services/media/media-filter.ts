import type { Filter } from "@silo/shared/filter";
import type { MediaQuery } from "../../media/media-query";

/**
 * Compiles a media search into the existing Query AST, so media adds no
 * operator every storage adapter would have to carry forever (§5.3).
 *
 * A *recursive* folder filter is deliberately not expressible here — see
 * `MediaAssetService.listRecursive` for why it is applied after the fact.
 */
export class MediaFilter {
  static build(query: MediaQuery, folder: string | undefined): Filter | undefined {
    const clauses: Filter[] = [];

    if (query.text && query.text.trim()) {
      clauses.push({ op: "contains", path: "$.data.filename", value: query.text.trim() });
    }
    if (query.type && query.type.trim()) {
      clauses.push({ op: "contains", path: "$.data.content_type", value: query.type.trim() });
    }
    if (query.ext && query.ext.trim()) {
      // No dedicated "ends with" op (§5.3) — `contains` on the filename with
      // the leading dot is close enough that a false match needs a dot
      // literally inside the name right before the same extension string.
      clauses.push({ op: "contains", path: "$.data.filename", value: `.${query.ext.trim().replace(/^\./, "")}` });
    }
    // `updated_at` is an envelope field (`MediaCatalog.toView` reads it off
    // `Entry` itself), not part of `data` — `$.data.updated_at` selects
    // nothing and would silently match zero rows.
    if (query.modifiedAfter) {
      clauses.push({ op: "gte", path: "$.updated_at", value: query.modifiedAfter });
    }
    if (query.modifiedBefore) {
      clauses.push({ op: "lte", path: "$.updated_at", value: query.modifiedBefore });
    }
    if (query.tag && query.tag.trim()) {
      // `tags` is an array, and since D29 `contains` is substring-on-string
      // only — membership is `eq` over a wildcard, which also stops a tag
      // "news" from matching a stored "newsletter".
      clauses.push({ op: "eq", path: "$.data.tags[*]", value: query.tag.trim() });
    }
    if (folder !== undefined && !query.recursive) {
      clauses.push({ op: "eq", path: "$.data.folder", value: folder });
    }

    if (clauses.length === 0) return undefined;
    if (clauses.length === 1) return clauses[0];
    return { op: "and", args: clauses };
  }
}
