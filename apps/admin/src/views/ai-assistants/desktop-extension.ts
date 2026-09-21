import type { Server } from '../servers/server'
import { AiAssistantConfig } from './ai-assistant-config'
import { DesktopBridgeSource } from './desktop-bridge-source'
import { StoredZip } from './stored-zip'

/** Builds the Claude Desktop MCPB locally; its URL and key are settings that default to this connection. */
export class DesktopExtension {
  static readonly Filename = `${AiAssistantConfig.ServerName}.mcpb`

  static create(server: Server): Uint8Array<ArrayBuffer> {
    const manifest = {
      manifest_version: '0.3',
      name: AiAssistantConfig.ServerName,
      display_name: 'Silo',
      version: '1.0.0',
      description: 'Browse and work with your Silo content in Claude, with the access of the API key in its settings.',
      author: { name: 'Silo' },
      server: {
        type: 'node',
        entry_point: 'server/index.cjs',
        mcp_config: {
          command: 'node',
          args: ['${__dirname}/server/index.cjs'],
          env: { SILO_URL: '${user_config.server_url}', SILO_API_KEY: '${user_config.api_key}' },
        },
      },
      // Optional, so the host falls back to these defaults without asking at install.
      user_config: {
        server_url: {
          type: 'string',
          title: 'Server URL',
          description: 'The Silo to connect to, such as https://cms.example.com. localhost means this computer.',
          default: AiAssistantConfig.baseUrl(server),
        },
        api_key: {
          type: 'string',
          title: 'API key',
          description: 'The Silo API key Claude uses. Its claims decide what Claude can read and change.',
          sensitive: true,
          default: server.apiKey,
        },
      },
      tools_generated: true,
      compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=18.0.0' } },
    }
    return StoredZip.create({
      'manifest.json': JSON.stringify(manifest, null, 2),
      'server/index.cjs': DesktopBridgeSource.source,
    })
  }
}
