import { JsonRpc } from "./json-rpc";

export interface McpStdioBridgeOptions {
  /** The instance's `/api/mcp` URL; see `endpointOf`. */
  endpoint: string;
  key?: string;
  /** One line of stdout per JSON-RPC reply. */
  write: (line: string) => void;
  /** Diagnostics; stderr, never stdout, which the client parses. */
  warn: (message: string) => void;
  fetch?: typeof fetch;
}

/**
 * `silo mcp`: newline-delimited JSON-RPC on stdin, one `POST /api/mcp` per
 * line, the reply on stdout. A client, not a server (§10.6): it opens no
 * storage, so it never contends with the instance it talks to (D25), and the
 * key it presents is authorized exactly as it would be over HTTP.
 */
export class McpStdioBridge {
  constructor(private readonly options: McpStdioBridgeOptions) {}

  /** `http://host:8090` and `http://host:8090/` and `http://host:8090/api/mcp` all name the same endpoint. */
  static endpointOf(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/api/mcp") ? trimmed : `${trimmed}/api/mcp`;
  }

  /** Reads to the end of `input`, forwarding each line as it completes. Lines are not serialized against each other; replies carry their own ids. */
  async pump(input: AsyncIterable<Uint8Array | string>): Promise<void> {
    const decoder = new TextDecoder();
    const inFlight: Promise<void>[] = [];
    let buffered = "";

    for await (const chunk of input) {
      buffered += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        inFlight.push(this.forward(buffered.slice(0, newline)));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    }
    if (buffered.trim()) inFlight.push(this.forward(buffered));
    await Promise.all(inFlight);
  }

  /** One message out, its reply (if any) written. Never throws: a failure becomes a JSON-RPC error for the request it answers. */
  async forward(line: string): Promise<void> {
    const message = line.trim();
    if (!message) return;
    const id = McpStdioBridge.idOf(message);

    try {
      const response = await (this.options.fetch ?? fetch)(this.options.endpoint, {
        method: "POST",
        headers: this.headers(),
        body: message,
      });
      const text = await response.text();
      if (response.status === 202 || text.trim() === "") return;

      // A 200 reply and a 400 parse error are both JSON-RPC bodies; pass them through, one line each.
      const body = McpStdioBridge.parse(text);
      if (McpStdioBridge.isJsonRpc(body)) {
        this.options.write(JSON.stringify(body));
        return;
      }
      this.fail(id, `silo answered ${response.status}: ${McpStdioBridge.reason(body, text)}`);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      this.fail(id, `could not reach ${this.options.endpoint}: ${reason}`);
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.options.key) headers.authorization = `Bearer ${this.options.key}`;
    return headers;
  }

  /** A request gets its error as a reply; a notification, or a line we could not read, gets a warning. */
  private fail(id: string | number | null | undefined, reason: string): void {
    if (id === undefined) {
      this.options.warn(reason);
      return;
    }
    this.options.write(JSON.stringify(JsonRpc.error(id, JsonRpc.UpstreamError, reason)));
  }

  /** The request id, `null` when it is null, `undefined` for a notification or unreadable text. */
  private static idOf(message: string): string | number | null | undefined {
    const parsed = McpStdioBridge.parse(message);
    if (!parsed || typeof parsed !== "object" || !("id" in parsed)) return undefined;
    return JsonRpc.idOf(parsed);
  }

  private static parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private static isJsonRpc(body: unknown): boolean {
    const first = Array.isArray(body) ? body[0] : body;
    return !!first && typeof first === "object" && (first as { jsonrpc?: unknown }).jsonrpc === "2.0";
  }

  private static reason(body: unknown, text: string): string {
    const error = (body as { error?: { message?: unknown } } | undefined)?.error;
    return typeof error?.message === "string" ? error.message : text.slice(0, 200) || "no body";
  }
}
