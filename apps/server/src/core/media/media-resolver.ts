import { MediaField } from "@silo/shared/media-field";
import type { MediaLinks } from "./media-links";

/**
 * Walks an entry's data and rewrites its media fields into fetchable URLs.
 *
 * The walk is here; **what** a URL looks like is `MediaLinks`. They were one
 * class until `[media]` made the answer depend on more than a base string
 * (D46), and splitting them keeps this file about the schema and that one
 * about the configuration.
 *
 * A reference that does not resolve becomes `null` (D48), never a dropped
 * value: a single field becomes `null` directly, and an array element becomes
 * `null` **in that slot** — the `.map` calls below never shorten the array,
 * so a caller cannot mistake "this array lost an element" for "this array
 * always had fewer entries". Same asymmetry `MediaRefs` already takes between
 * over-capture and under-capture: visible beats silent.
 */
export class MediaResolver {
  /**
   * Checks if a schema node represents a media field using x-silo-type: "media".
   */
  static isMediaField(schemaNode: any): boolean {
    return MediaField.is(schemaNode);
  }

  /**
   * Recursively resolves media fields in entry data into fully qualified URLs based on schema rules.
   */
  static resolveMediaFields(data: any, schema: any, links: MediaLinks): any {
    if (!data || typeof data !== "object" || !schema || typeof schema !== "object") {
      return data;
    }

    if (Array.isArray(data)) {
      const itemSchema = schema.items || (Array.isArray(schema.prefixItems) ? schema.prefixItems[0] : null);
      if (!itemSchema) return data;
      return data.map((item) => MediaResolver.resolveMediaFields(item, itemSchema, links));
    }

    const properties = schema.properties || {};
    const result: Record<string, any> = { ...data };

    for (const [key, val] of Object.entries(result)) {
      const propSchema = properties[key];
      if (!propSchema) continue;

      if (MediaResolver.isMediaField(propSchema)) {
        if (typeof val === "string") {
          result[key] = links.urlFor(val);
        } else if (Array.isArray(val)) {
          result[key] = val.map((v) => (typeof v === "string" ? links.urlFor(v) : v));
        }
      } else if (propSchema.type === "object" || propSchema.properties) {
        result[key] = MediaResolver.resolveMediaFields(val, propSchema, links);
      } else if (propSchema.type === "array" && propSchema.items) {
        if (MediaResolver.isMediaField(propSchema.items)) {
          if (Array.isArray(val)) {
            result[key] = val.map((v) => (typeof v === "string" ? links.urlFor(v) : v));
          }
        } else if (Array.isArray(val)) {
          result[key] = val.map((v) => MediaResolver.resolveMediaFields(v, propSchema.items, links));
        }
      }
    }

    return result;
  }
}
