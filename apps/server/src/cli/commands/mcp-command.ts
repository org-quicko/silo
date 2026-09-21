import { McpStdioBridge } from "../../mcp";

/**
 * `silo mcp` — a stdio MCP server for clients that spawn a process rather than
 * open a URL. It is a bridge to a running instance's `/api/mcp`, so it needs no
 * config file and no data directory: the server's URL and an API key.
 */
export class McpCommand {
  static async run(values: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const url = McpCommand.setting(values.url, env.SILO_URL);
    if (!url) {
      throw new Error("mcp needs the server's URL: pass --url http://localhost:8090 or set SILO_URL");
    }
    const key = McpCommand.setting(values.key, env.SILO_API_KEY);
    if (!key) {
      console.error("silo mcp: no API key (--key or SILO_API_KEY); only a server running with auth disabled will answer");
    }

    const bridge = new McpStdioBridge({
      endpoint: McpStdioBridge.endpointOf(url),
      key,
      write: (line) => {
        process.stdout.write(`${line}\n`);
      },
      warn: (message) => console.error(`silo mcp: ${message}`),
    });
    await bridge.pump(process.stdin);
  }

  private static setting(flag: unknown, variable: string | undefined): string | undefined {
    if (typeof flag === "string" && flag.trim()) return flag.trim();
    return variable?.trim() || undefined;
  }
}
