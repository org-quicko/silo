import type { FieldSpec } from "./field-spec";

/** Terse constructors for the catalogue below, so a blueprint reads as a list. */
export class Fields {
  static title(name = "title"): FieldSpec {
    return { name, kind: "title", required: true, label: true };
  }
  static name(name = "name"): FieldSpec {
    return { name, kind: "title", required: true, label: true };
  }
  static slug(name = "slug"): FieldSpec {
    return { name, kind: "slug", required: true };
  }
  static line(name: string, label = false): FieldSpec {
    return { name, kind: "line", label };
  }
  static body(name = "body", size = 3): FieldSpec {
    return { name, kind: "body", required: true, size };
  }
  static choice(name: string, choices: readonly string[]): FieldSpec {
    return { name, kind: "choice", required: true, choices };
  }
  static int(name: string, min: number, max: number): FieldSpec {
    return { name, kind: "int", min, max };
  }
  static decimal(name: string, min: number, max: number): FieldSpec {
    return { name, kind: "decimal", min, max };
  }
  static bool(name: string): FieldSpec {
    return { name, kind: "bool" };
  }
  static date(name: string): FieldSpec {
    return { name, kind: "date" };
  }
  static future(name: string): FieldSpec {
    return { name, kind: "future" };
  }
  /** A labelled person is the row's identity, so it is never left absent. */
  static person(name: string, label = false): FieldSpec {
    return { name, kind: "person", label, required: label };
  }
  static email(name = "email"): FieldSpec {
    return { name, kind: "email" };
  }
  static url(name: string): FieldSpec {
    return { name, kind: "url" };
  }
  static tags(name = "tags", size = 4): FieldSpec {
    return { name, kind: "tags", size };
  }
  static object(name: string, fields: FieldSpec[]): FieldSpec {
    return { name, kind: "object", fields };
  }
  static objects(name: string, fields: FieldSpec[], size = 4): FieldSpec {
    return { name, kind: "objects", size, fields };
  }
  /** A field whose text is deliberately excluded from the search index. */
  static secret(name: string): FieldSpec {
    return { name, kind: "line", secret: true };
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
