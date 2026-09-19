/** Dependency-free Node entry point shipped inside the Claude Desktop bundle. */
export class DesktopBridgeSource {
  static readonly source = String.raw`const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');

class SiloDesktopBridge {
  constructor() {
    this.connection = JSON.parse(readFileSync(join(__dirname, 'connection.json'), 'utf8'));
    this.pending = new Set();
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
    try {
      const response = await fetch(this.connection.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer ' + this.connection.apiKey,
        },
        body: JSON.stringify(message),
      });
      if (!Object.hasOwn(message, 'id') || response.status === 202) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401) {
        this.fail(message, 'Silo access is no longer valid. Download the extension again from your current Silo connection.');
        await response.body?.cancel();
        return;
      }
      const result = await response.json();
      if (result?.jsonrpc !== '2.0') {
        this.fail(message, 'Silo returned an unexpected response (HTTP ' + response.status + ').');
        return;
      }
      this.reply(result);
    } catch {
      this.fail(message, 'Could not reach Silo. Check that the instance is running and reachable from this computer.');
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

new SiloDesktopBridge().run().catch(() => {
  process.stderr.write('Could not start the Silo extension. Download it again from Silo settings.\n');
  process.exitCode = 1;
});
`
}
