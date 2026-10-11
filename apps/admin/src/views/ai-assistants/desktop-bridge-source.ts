/** Dependency-free Node entry point shipped inside the Claude Desktop bundle. */
export class DesktopBridgeSource {
  static readonly source = String.raw`const { createInterface } = require('node:readline');

class SiloDesktopBridge {
  constructor(environment) {
    this.url = SiloDesktopBridge.setting(environment.SILO_URL);
    this.apiKey = SiloDesktopBridge.setting(environment.SILO_API_KEY);
    this.endpoint = SiloDesktopBridge.endpointOf(this.url);
    this.pending = new Set();
  }

  // A setting left empty can arrive as its unexpanded manifest placeholder.
  static setting(value) {
    const text = (value || '').trim();
    return /^\$\{user_config\.[^}]*\}$/.test(text) ? '' : text;
  }

  // Silo Admin's rules: a bare host means http, and a trailing /api/mcp is optional.
  static endpointOf(url) {
    if (!url) return undefined;
    const base = (/^https?:\/\//i.test(url) ? url : 'http://' + url).replace(/\/+$/, '');
    try {
      return new URL(base.endsWith('/api/mcp') ? base : base + '/api/mcp').href;
    } catch {
      return undefined;
    }
  }

  static parse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async run() {
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
        continue;
      }
      if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') {
        this.reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
        continue;
      }
      if (this.pending.size >= 64) {
        this.fail(message, 'Silo is busy. Try again shortly.');
        continue;
      }
      const request = this.forward(message);
      this.pending.add(request);
      void request.finally(() => this.pending.delete(request));
    }
    await Promise.all(this.pending);
  }

  async forward(message) {
    if (!this.endpoint) {
      this.fail(message, this.url
        ? 'The server URL in the Silo extension settings is not a valid URL.'
        : 'No server URL is set. Add it in the Silo extension settings.');
      return;
    }
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.apiKey) headers.authorization = 'Bearer ' + this.apiKey;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        headers,
        body: JSON.stringify(message),
      });
      if (!Object.hasOwn(message, 'id') || response.status === 202) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401) {
        this.fail(message, this.apiKey
          ? 'Silo did not accept the API key. Set a current key in the Silo extension settings.'
          : 'Silo needs an API key. Add one in the Silo extension settings.');
        await response.body?.cancel();
        return;
      }
      const result = SiloDesktopBridge.parse(await response.text());
      if (result?.jsonrpc !== '2.0') {
        this.fail(message, 'The server URL answered HTTP ' + response.status + ' without an MCP reply. Check it in the Silo extension settings.');
        return;
      }
      this.reply(result);
    } catch {
      this.fail(message, 'Could not reach Silo. Check that it is running and reachable from this computer, and the server URL in the Silo extension settings.');
    }
  }

  fail(message, reason) {
    if (Object.hasOwn(message, 'id')) {
      this.reply({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: reason } });
    }
  }

  reply(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
  }
}

new SiloDesktopBridge(process.env).run().catch(() => {
  process.stderr.write('The Silo extension stopped unexpectedly.\n');
  process.exitCode = 1;
});
`
}
