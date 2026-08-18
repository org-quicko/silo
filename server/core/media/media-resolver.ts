import { MediaField } from "@silo/shared/media-field";
export class MediaResolver {
  /**
   * Checks if a schema node represents a media field using x-silo-type: "media".
   */
  static isMediaField(schemaNode: any): boolean {
    return MediaField.is(schemaNode);
  }

  /**
   * Formats a media reference into a fully qualified URL flat string.
   */
  static toAbsoluteUrl(value: string, baseUrl: string): string {
    if (typeof value !== "string" || !value.trim()) {
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    const cleanBase = baseUrl.replace(/\/+$/, "");
    if (trimmed.startsWith("/media/")) {
      return `${cleanBase}${trimmed}`;
    }
    if (trimmed.startsWith("media/")) {
      return `${cleanBase}/${trimmed}`;
    }
    return `${cleanBase}/media/${trimmed.replace(/^\/+/, "")}`;
  }

  /**
   * Normalizes absolute or relative media URLs to a standard relative path (/media/<diskFilename>).
   */
  static toRelativePath(value: string, baseUrl?: string): string {
    if (typeof value !== "string" || !value.trim()) {
      return value;
    }
    let str = value.trim();
    if (str.startsWith("http://") || str.startsWith("https://")) {
      try {
        const parsed = new URL(str);
        str = parsed.pathname;
      } catch {
        // Leave unchanged if URL parsing fails
      }
    }

    const mediaIdx = str.indexOf("/media/");
    if (mediaIdx !== -1) {
      return str.substring(mediaIdx);
    }
    if (str.startsWith("media/")) {
      return `/${str}`;
    }
    return `/media/${str.replace(/^\/+/, "")}`;
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

  /**
   * Recursively normalizes incoming media fields in entry data to relative storage paths.
   */
  static normalizeMediaFields(data: any, schema: any, baseUrl?: string): any {
    if (!data || typeof data !== "object" || !schema || typeof schema !== "object") {
      return data;
    }

    if (Array.isArray(data)) {
      const itemSchema = schema.items || (Array.isArray(schema.prefixItems) ? schema.prefixItems[0] : null);
      if (!itemSchema) return data;
      return data.map((item) => MediaResolver.normalizeMediaFields(item, itemSchema, baseUrl));
    }

    const properties = schema.properties || {};
    const result: Record<string, any> = { ...data };

    for (const [key, val] of Object.entries(result)) {
      const propSchema = properties[key];
      if (!propSchema) continue;

      if (MediaResolver.isMediaField(propSchema)) {
        if (typeof val === "string") {
          result[key] = MediaResolver.toRelativePath(val, baseUrl);
        } else if (Array.isArray(val)) {
          result[key] = val.map((v) => (typeof v === "string" ? MediaResolver.toRelativePath(v, baseUrl) : v));
        }
      } else if (propSchema.type === "object" || propSchema.properties) {
        result[key] = MediaResolver.normalizeMediaFields(val, propSchema, baseUrl);
      } else if (propSchema.type === "array" && propSchema.items) {
        if (MediaResolver.isMediaField(propSchema.items)) {
          if (Array.isArray(val)) {
            result[key] = val.map((v) => (typeof v === "string" ? MediaResolver.toRelativePath(v, baseUrl) : v));
          }
        } else if (Array.isArray(val)) {
          result[key] = val.map((v) => MediaResolver.normalizeMediaFields(v, propSchema.items, baseUrl));
        }
      }
    }

    return result;
  }
}
