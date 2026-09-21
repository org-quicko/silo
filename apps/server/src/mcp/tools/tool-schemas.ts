/**
 * The JSON Schema fragments the tool inputs are built from, so every tool
 * describes a project, a filter or a page the same way.
 */
export class ToolSchemas {
  /** The scope-name grammar `Scope` enforces; the route still validates. */
  private static readonly Name = { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" };

  static readonly Project = { ...ToolSchemas.Name, description: "Project name." };
  static readonly Env = { ...ToolSchemas.Name, description: "Environment name, e.g. prod." };
  static readonly Collection = { ...ToolSchemas.Name, description: "Collection name." };
  static readonly EntryId = { type: "string", minLength: 1, description: "Entry id (a ULID)." };
  static readonly MediaId = { type: "string", minLength: 1, description: "Media asset id." };

  static readonly Rev = {
    type: "integer",
    minimum: 1,
    description: "The rev of the entry as you last read it. A stale rev is refused with 409.",
  };

  static readonly Data = {
    type: "object",
    description:
      "The entry's own fields, validated against the collection schema. Never include id, rev, seq, created_at or updated_at.",
  };

  static readonly Schema = {
    type: "object",
    description:
      'A JSON Schema draft 2020-12 document. "x-silo-auth": true makes reads need a key; "x-silo-search" picks the indexed fields. Refer to another collection with {"$ref": "silo://collections/<name>"}.',
  };

  static readonly Filter = {
    type: "object",
    description:
      'Filter AST. A leaf is {"op","path","value"} with op one of eq, neq, gt, gte, lt, lte, in, contains, exists; and/or/not take "args". Paths are RFC 9535 JSONPath over {id, rev, created_at, updated_at, data}; your fields live under $.data, e.g. $.data.status.',
  };

  static readonly Sort = {
    type: "string",
    description: 'Comma-separated JSONPaths, "-" for descending: "-$.updated_at,$.data.title".',
  };

  static readonly Limit = {
    type: "integer",
    minimum: 1,
    maximum: 500,
    description: "Page size (default 50, max 500).",
  };

  static readonly Offset = { type: "integer", minimum: 0, description: "Rows to skip." };

  static readonly RawVariables = {
    type: "boolean",
    description: "true returns {{NAME}} templates unresolved instead of this environment's values.",
  };

  /** A closed object schema: what is listed, and nothing else. */
  static object(
    properties: Record<string, unknown>,
    required: readonly string[] = []
  ): Record<string, unknown> {
    return { type: "object", properties, required: [...required], additionalProperties: false };
  }

  /** `object` with project and env first, which every scoped tool takes. */
  static scoped(
    properties: Record<string, unknown>,
    required: readonly string[] = []
  ): Record<string, unknown> {
    return ToolSchemas.object(
      { project: ToolSchemas.Project, env: ToolSchemas.Env, ...properties },
      ["project", "env", ...required]
    );
  }
}
