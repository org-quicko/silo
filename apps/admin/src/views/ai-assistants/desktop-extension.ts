import type { Server } from '../servers/server'
import { AiAssistantConfig } from './ai-assistant-config'
import { DesktopBridgeSource } from './desktop-bridge-source'
import { StoredZip } from './stored-zip'

/** Builds an instance-specific MCPB locally, including this connection's key. */
export class DesktopExtension {
  static filename(server: Server): string {
    return `${AiAssistantConfig.name(server)}.mcpb`
  }

  static create(server: Server): Uint8Array<ArrayBuffer> {
    const manifest = {
      manifest_version: '0.3',
      name: AiAssistantConfig.name(server),
      display_name: `Silo — ${server.name}`,
      version: '1.0.0',
      description: 'Use your existing Silo access to browse and work with content in Claude.',
      author: { name: 'Silo' },
      server: {
        type: 'node',
        entry_point: 'server/index.cjs',
        mcp_config: { command: 'node', args: ['${__dirname}/server/index.cjs'] },
      },
      tools_generated: true,
      compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=18.0.0' } },
    }
    return StoredZip.create({
      'manifest.json': JSON.stringify(manifest, null, 2),
      'server/index.cjs': DesktopBridgeSource.source,
      'server/connection.json': JSON.stringify({
        endpoint: AiAssistantConfig.endpoint(server),
        apiKey: server.apiKey,
      }),
    })
  }
}
