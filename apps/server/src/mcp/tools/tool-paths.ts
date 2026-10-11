/** Builds the `/api/...` paths and query strings the tools dispatch to. */
export class ToolPaths {
  static text(args: Record<string, unknown>, name: string): string {
    return encodeURIComponent(String(args[name] ?? ""));
  }

  static scope(args: Record<string, unknown>): string {
    return `/api/projects/${ToolPaths.text(args, "project")}/environments/${ToolPaths.text(args, "env")}`;
  }

  static collection(args: Record<string, unknown>): string {
    return `${ToolPaths.scope(args)}/collections/${ToolPaths.text(args, "collection")}`;
  }

  static entry(args: Record<string, unknown>): string {
    return `${ToolPaths.collection(args)}/${ToolPaths.text(args, "id")}`;
  }

  /**
   * The named arguments as query values: objects become JSON (the filter AST
   * travels url-encoded), booleans and numbers become their text, and an
   * absent argument is left out rather than sent as "undefined".
   */
  static query(
    args: Record<string, unknown>,
    names: readonly string[]
  ): Record<string, string | undefined> {
    const query: Record<string, string | undefined> = {};
    for (const name of names) {
      const value = args[name];
      if (value === undefined || value === null) continue;
      query[name] = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    return query;
  }
}
