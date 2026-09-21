import type { McpTool } from "../mcp-tool";
import { ToolPaths } from "./tool-paths";
import { ToolSchemas } from "./tool-schemas";

/** Text search at the three reaches the API has (D30), chosen by which arguments are given. */
export class SearchTools {
  static all(): McpTool[] {
    return [SearchTools.search()];
  }

  private static search(): McpTool {
    return {
      name: "search",
      title: "Search",
      description:
        "Full-text search. Give project and env to search one environment, add collection to search one collection, or give neither to search everything the key can read. Each hit names where it was found and quotes why it matched. Omit sort to rank by relevance.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "The text to look for." },
          project: ToolSchemas.Project,
          env: ToolSchemas.Env,
          collection: ToolSchemas.Collection,
          filter: ToolSchemas.Filter,
          sort: ToolSchemas.Sort,
          limit: ToolSchemas.Limit,
          offset: ToolSchemas.Offset,
        },
        required: ["q"],
        additionalProperties: false,
        // project and env come together; a collection needs both.
        dependentRequired: { project: ["env"], env: ["project"], collection: ["project", "env"] },
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({
        method: "GET",
        path: SearchTools.path(args),
        query: ToolPaths.query(args, ["q", "filter", "sort", "limit", "offset"]),
      }),
    };
  }

  private static path(args: Record<string, unknown>): string {
    if (typeof args.collection === "string") return `${ToolPaths.collection(args)}/search`;
    if (typeof args.project === "string") return `${ToolPaths.scope(args)}/search`;
    return "/api/search";
  }
}
