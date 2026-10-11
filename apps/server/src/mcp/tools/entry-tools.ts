import type { McpTool } from "../mcp-tool";
import { ToolPaths } from "./tool-paths";
import { ToolSchemas } from "./tool-schemas";

/** The content itself: list, read, create, replace, delete. */
export class EntryTools {
  static all(): McpTool[] {
    return [
      EntryTools.listEntries(),
      EntryTools.getEntry(),
      EntryTools.createEntry(),
      EntryTools.updateEntry(),
      EntryTools.deleteEntry(),
    ];
  }

  private static listEntries(): McpTool {
    return {
      name: "list_entries",
      title: "List entries",
      description:
        "Page through a collection's entries, optionally filtered and sorted. Each entry is flat: id, its own fields, rev, created_at, updated_at. Keep limit small and use offset to continue.",
      inputSchema: ToolSchemas.scoped(
        {
          collection: ToolSchemas.Collection,
          filter: ToolSchemas.Filter,
          sort: ToolSchemas.Sort,
          limit: ToolSchemas.Limit,
          offset: ToolSchemas.Offset,
          raw_variables: ToolSchemas.RawVariables,
        },
        ["collection"]
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({
        method: "GET",
        path: ToolPaths.collection(args),
        query: {
          ...ToolPaths.query(args, ["filter", "sort", "limit", "offset"]),
          variables: args.raw_variables === true ? "raw" : undefined,
        },
      }),
    };
  }

  private static getEntry(): McpTool {
    return {
      name: "get_entry",
      title: "Get entry",
      description: "One entry by id. The answer carries the rev to send back on update or delete.",
      inputSchema: ToolSchemas.scoped(
        {
          collection: ToolSchemas.Collection,
          id: ToolSchemas.EntryId,
          raw_variables: ToolSchemas.RawVariables,
        },
        ["collection", "id"]
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({
        method: "GET",
        path: ToolPaths.entry(args),
        query: { variables: args.raw_variables === true ? "raw" : undefined },
      }),
    };
  }

  private static createEntry(): McpTool {
    return {
      name: "create_entry",
      title: "Create entry",
      description:
        "Create an entry. data is validated against the collection schema; a failure answers the JSON Pointer of each bad field. Needs collections:...:entries:create.",
      inputSchema: ToolSchemas.scoped(
        { collection: ToolSchemas.Collection, data: ToolSchemas.Data },
        ["collection", "data"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      request: (args) => ({ method: "POST", path: ToolPaths.collection(args), body: args.data }),
    };
  }

  private static updateEntry(): McpTool {
    return {
      name: "update_entry",
      title: "Update entry",
      description:
        "Replace an entry's fields in full: data is the whole new document, not a patch. Read it first and pass its rev; a stale rev is refused with 409. Needs collections:...:entries:update.",
      inputSchema: ToolSchemas.scoped(
        {
          collection: ToolSchemas.Collection,
          id: ToolSchemas.EntryId,
          rev: ToolSchemas.Rev,
          data: ToolSchemas.Data,
        },
        ["collection", "id", "rev", "data"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      request: (args) => ({
        method: "PUT",
        path: ToolPaths.entry(args),
        query: ToolPaths.query(args, ["rev"]),
        body: args.data,
      }),
    };
  }

  private static deleteEntry(): McpTool {
    return {
      name: "delete_entry",
      title: "Delete entry",
      description:
        "Delete one entry. Pass the rev you read; a stale rev is refused with 409. Needs collections:...:entries:delete.",
      inputSchema: ToolSchemas.scoped(
        { collection: ToolSchemas.Collection, id: ToolSchemas.EntryId, rev: ToolSchemas.Rev },
        ["collection", "id", "rev"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      request: (args) => ({
        method: "DELETE",
        path: ToolPaths.entry(args),
        query: ToolPaths.query(args, ["rev"]),
      }),
    };
  }
}
