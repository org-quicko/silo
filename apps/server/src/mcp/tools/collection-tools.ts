import type { McpTool } from "../mcp-tool";
import { ToolPaths } from "./tool-paths";
import { ToolSchemas } from "./tool-schemas";

/** Collections and their schemas: the model of the content, as opposed to the content. */
export class CollectionTools {
  static all(): McpTool[] {
    return [
      CollectionTools.listCollections(),
      CollectionTools.getSchema(),
      CollectionTools.createCollection(),
      CollectionTools.updateSchema(),
      CollectionTools.deleteCollection(),
    ];
  }

  private static listCollections(): McpTool {
    return {
      name: "list_collections",
      title: "List collections",
      description:
        "Collections in one environment: name, entry count, whether reads need a key, timestamps. No schemas; call get_schema for one.",
      inputSchema: ToolSchemas.scoped({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({ method: "GET", path: `${ToolPaths.scope(args)}/collections` }),
    };
  }

  private static getSchema(): McpTool {
    return {
      name: "get_schema",
      title: "Get schema",
      description:
        "One collection's JSON Schema, with silo:// references to other collections already bundled in. Read it before creating or updating entries.",
      inputSchema: ToolSchemas.scoped({ collection: ToolSchemas.Collection }, ["collection"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({ method: "GET", path: `${ToolPaths.collection(args)}/schema` }),
    };
  }

  private static createCollection(): McpTool {
    return {
      name: "create_collection",
      title: "Create collection",
      description:
        "Create a collection from a JSON Schema. Field names id, rev, seq, created_at and updated_at are reserved. Needs collections:<project>/<env>/<name>:create.",
      inputSchema: ToolSchemas.scoped(
        { collection: ToolSchemas.Collection, schema: ToolSchemas.Schema },
        ["collection", "schema"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      request: (args) => ({
        method: "POST",
        path: `${ToolPaths.scope(args)}/collections`,
        body: { name: args.collection, schema: args.schema },
      }),
    };
  }

  private static updateSchema(): McpTool {
    return {
      name: "update_schema",
      title: "Update schema",
      description:
        "Replace a collection's schema. While the collection holds entries only titles, descriptions, x-silo-auth and x-silo-search may change; anything that alters which entries are valid is refused with 409. Needs collections:...:schema:update, plus access:update when x-silo-auth flips.",
      inputSchema: ToolSchemas.scoped(
        { collection: ToolSchemas.Collection, schema: ToolSchemas.Schema },
        ["collection", "schema"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      request: (args) => ({
        method: "PUT",
        path: `${ToolPaths.collection(args)}/schema`,
        body: args.schema,
      }),
    };
  }

  private static deleteCollection(): McpTool {
    return {
      name: "delete_collection",
      title: "Delete collection",
      description:
        "Delete a collection. Refused while it holds entries unless force is true, which erases them all and needs entries:delete as well as collection:delete.",
      inputSchema: ToolSchemas.scoped(
        {
          collection: ToolSchemas.Collection,
          force: { type: "boolean", description: "Also erase every entry it holds." },
        },
        ["collection"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      request: (args) => ({
        method: "DELETE",
        path: `${ToolPaths.collection(args)}/schema`,
        query: args.force === true ? { force: "true" } : {},
      }),
    };
  }
}
