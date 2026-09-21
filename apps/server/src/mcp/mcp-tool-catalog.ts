import type { McpTool } from "./mcp-tool";
import { CollectionTools } from "./tools/collection-tools";
import { EntryTools } from "./tools/entry-tools";
import { InstanceTools } from "./tools/instance-tools";
import { MediaTools } from "./tools/media-tools";
import { SearchTools } from "./tools/search-tools";

/** The ordered tool set one instance offers, and the `tools/list` view of it. */
export class McpToolCatalog {
  private readonly byName = new Map<string, McpTool>();

  constructor(tools: readonly McpTool[]) {
    for (const tool of tools) {
      if (this.byName.has(tool.name)) throw new Error(`duplicate MCP tool name "${tool.name}"`);
      this.byName.set(tool.name, tool);
    }
  }

  /** Every tool silo ships, discovery first so a model reads the shape before it writes. */
  static default(): McpToolCatalog {
    return new McpToolCatalog([
      ...InstanceTools.all(),
      ...CollectionTools.all(),
      ...EntryTools.all(),
      ...SearchTools.all(),
      ...MediaTools.all(),
    ]);
  }

  find(name: string): McpTool | undefined {
    return this.byName.get(name);
  }

  all(): McpTool[] {
    return [...this.byName.values()];
  }

  /** What `tools/list` answers: everything but the request mapping. */
  descriptors(): Record<string, unknown>[] {
    return this.all().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { title: tool.title, ...tool.annotations },
    }));
  }
}
