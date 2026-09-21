import type { McpTool } from "../mcp-tool";
import { ToolPaths } from "./tool-paths";
import { ToolSchemas } from "./tool-schemas";

/** The media catalog, read only: uploads carry bytes, which is not what a tool call is for. */
export class MediaTools {
  static all(): McpTool[] {
    return [MediaTools.listMedia(), MediaTools.getMedia()];
  }

  private static listMedia(): McpTool {
    return {
      name: "list_media",
      title: "List media",
      description:
        "Page through the media library's catalog records: id, filename, folder, tags, content type, size and url. An entry refers to an asset as silo://media/<id>. Needs media:read.",
      inputSchema: ToolSchemas.object({
        q: { type: "string", description: "Text to match against filenames and tags." },
        folder: { type: "string", description: "Folder path to list, e.g. images/hero." },
        recursive: { type: "boolean", description: "Include descendant folders." },
        type: { type: "string", description: "A type family: image, video, audio, document." },
        ext: { type: "string", description: "One file extension, without the dot." },
        tag: { type: "string", description: "One tag." },
        sort: { type: "string", description: "Sort key, e.g. -updated_at or filename." },
        limit: ToolSchemas.Limit,
        offset: ToolSchemas.Offset,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({
        method: "GET",
        path: "/api/media",
        query: ToolPaths.query(args, [
          "q",
          "folder",
          "recursive",
          "type",
          "ext",
          "tag",
          "sort",
          "limit",
          "offset",
        ]),
      }),
    };
  }

  private static getMedia(): McpTool {
    return {
      name: "get_media",
      title: "Get media",
      description: "One asset's catalog record by id. Needs media:read.",
      inputSchema: ToolSchemas.object({ id: ToolSchemas.MediaId }, ["id"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({ method: "GET", path: `/api/media/${ToolPaths.text(args, "id")}` }),
    };
  }
}
