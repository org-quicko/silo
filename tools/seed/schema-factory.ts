import type { CollectionBlueprint } from "./collection-blueprint";
import type { FieldSpec } from "./field-spec";

/** Turns a field list into the JSON Schema document a collection is created with. */
export class SchemaFactory {
  static build(blueprint: CollectionBlueprint): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: blueprint.title,
      type: "object",
      additionalProperties: false,
      ...SchemaFactory.shape(blueprint.fields),
      "x-silo-search": SchemaFactory.searchConfig(blueprint.fields),
    };
    // Absent rather than `false`, matching how the server writes the keyword.
    if (blueprint.auth) schema["x-silo-auth"] = true;
    return schema;
  }

  private static shape(fields: FieldSpec[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of fields) {
      properties[field.name] = SchemaFactory.node(field);
      if (field.required) required.push(field.name);
    }
    return required.length > 0 ? { properties, required } : { properties };
  }

  private static node(field: FieldSpec): Record<string, unknown> {
    switch (field.kind) {
      case "title":
        return { type: "string", minLength: 1, maxLength: 200 };
      case "slug":
        return { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 120 };
      case "line":
        return { type: "string", maxLength: 400 };
      case "body":
        return { type: "string" };
      case "choice":
        return { type: "string", enum: [...(field.choices ?? [])] };
      case "int":
        return { type: "integer", minimum: field.min ?? 0, maximum: field.max ?? 1000 };
      case "decimal":
        return { type: "number", minimum: field.min ?? 0, maximum: field.max ?? 1000 };
      case "bool":
        return { type: "boolean" };
      case "date":
      case "future":
        return { type: "string", format: "date-time" };
      case "person":
        return { type: "string", maxLength: 120 };
      case "email":
        return { type: "string", format: "email" };
      case "url":
        return { type: "string", format: "uri" };
      case "tags":
        return { type: "array", items: { type: "string" }, maxItems: field.size ?? 4 };
      case "object":
        return { type: "object", additionalProperties: false, ...SchemaFactory.shape(field.fields ?? []) };
      case "objects":
        return {
          type: "array",
          maxItems: field.size ?? 4,
          items: { type: "object", additionalProperties: false, ...SchemaFactory.shape(field.fields ?? []) },
        };
    }
  }

  /**
   * `x-silo-search` in D29 path terms: titles and names carry weight, and
   * anything marked secret is subtracted from the corpus. Every property in the
   * catalogue is a bare identifier, so no path segment here needs quoting.
   */
  private static searchConfig(fields: FieldSpec[]): Record<string, string[]> {
    const label: string[] = [];
    const exclude: string[] = [];
    SchemaFactory.collect(fields, "$.data", label, exclude);
    const config: Record<string, string[]> = {};
    if (label.length > 0) config.label = label;
    if (exclude.length > 0) config.exclude = exclude;
    return config;
  }

  private static collect(fields: FieldSpec[], prefix: string, label: string[], exclude: string[]): void {
    for (const field of fields) {
      const path = `${prefix}.${field.name}`;
      if (field.label) label.push(path);
      if (field.secret) exclude.push(path);
      if (field.kind === "object") SchemaFactory.collect(field.fields ?? [], path, label, exclude);
      if (field.kind === "objects") SchemaFactory.collect(field.fields ?? [], `${path}[*]`, label, exclude);
    }
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
