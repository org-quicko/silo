import { MediaField } from "@silo/shared/media-field";
import { MediaRef } from "@silo/shared/media-ref";

export class MediaResolver {
  /**
   * Checks if a schema node represents a media field using x-silo-type: "media".
   */
  static isMediaField(schemaNode: any): boolean {
    return MediaField.is(schemaNode);
  }

  /**
   * Turns a stored media reference into the URL a client can fetch.
   *
   * Since D23 an entry stores `silo://media/<ulid>` and the URL is
   * `<base>/media/<ulid>` — addressed by catalog id, so it survives a rename
   * or a move, and derivable without touching storage, which is what keeps
   * `EntryUtils.toApiResponse` a pure function. Pre-D23 values
   * (`/media/<blobKey>`, or an absolute URL of one) still resolve, so an
   * instance serves correctly while it is being backfilled.
   */
  static toAbsoluteUrl(value: string, baseUrl: string): string {
    if (typeof value !== "string" || !value.trim()) {
      return value;
    }
    const trimmed = value.trim();
    const cleanBase = baseUrl.replace(/\/+$/, "");

    if (MediaRef.is(trimmed)) {
      const id = MediaRef.idOf(trimmed);
      return id ? `${cleanBase}/media/${id}` : trimmed;
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    const legacyKey = MediaRef.legacyKeyOf(trimmed);
    return legacyKey ? `${cleanBase}/media/${legacyKey}` : trimmed;
  }

  /**
   * Recursively resolves media fields in entry data into fully qualified URLs based on schema rules.
   */
  static resolveMediaFields(data: any, schema: any, baseUrl: string): any {
    if (!data || typeof data !== "object" || !schema || typeof schema !== "object") {
      return data;
    }

    if (Array.isArray(data)) {
      const itemSchema = schema.items || (Array.isArray(schema.prefixItems) ? schema.prefixItems[0] : null);
      if (!itemSchema) return data;
      return data.map((item) => MediaResolver.resolveMediaFields(item, itemSchema, baseUrl));
    }

    const properties = schema.properties || {};
    const result: Record<string, any> = { ...data };

    for (const [key, val] of Object.entries(result)) {
      const propSchema = properties[key];
      if (!propSchema) continue;

      if (MediaResolver.isMediaField(propSchema)) {
        if (typeof val === "string") {
          result[key] = MediaResolver.toAbsoluteUrl(val, baseUrl);
        } else if (Array.isArray(val)) {
          result[key] = val.map((v) => (typeof v === "string" ? MediaResolver.toAbsoluteUrl(v, baseUrl) : v));
        }
      } else if (propSchema.type === "object" || propSchema.properties) {
        result[key] = MediaResolver.resolveMediaFields(val, propSchema, baseUrl);
      } else if (propSchema.type === "array" && propSchema.items) {
        if (MediaResolver.isMediaField(propSchema.items)) {
          if (Array.isArray(val)) {
            result[key] = val.map((v) => (typeof v === "string" ? MediaResolver.toAbsoluteUrl(v, baseUrl) : v));
          }
        } else if (Array.isArray(val)) {
          result[key] = val.map((v) => MediaResolver.resolveMediaFields(v, propSchema.items, baseUrl));
        }
      }
    }

    return result;
  }

}
