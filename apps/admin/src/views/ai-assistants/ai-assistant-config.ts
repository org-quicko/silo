import type { Server } from '../servers/server'
import type { Shell } from './ai-assistant'

/** Builds client fragments from the saved instance connection without storing a copy. */
export class AiAssistantConfig {
  /** Every client lists silo under this one name, so setting up another connection replaces it. */
  static readonly ServerName = 'silo'

  /** The saved URL without trailing slashes, as a client setting shows it. */
  static baseUrl(server: Server): string {
    return server.url.trim().replace(/\/+$/, '')
  }

  static endpoint(server: Server): string {
    const base = AiAssistantConfig.baseUrl(server)
    return base.endsWith('/api/mcp') ? base : `${base}/api/mcp`
  }

  static cursorUri(server: Server): string {
    const config = JSON.stringify({ url: AiAssistantConfig.endpoint(server), headers: { Authorization: `Bearer ${server.apiKey}` } })
    const encoded = AiAssistantConfig.base64Utf8(config)
    return `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({ name: AiAssistantConfig.ServerName, config: encoded })}`
  }

  static cursorJson(server: Server): string {
    return JSON.stringify({ mcpServers: { [AiAssistantConfig.ServerName]: { url: AiAssistantConfig.endpoint(server), headers: { Authorization: `Bearer ${server.apiKey}` } } } }, null, 2)
  }

  /** Removes a user-scope `silo` first, because `claude mcp add` refuses a name that exists. */
  static claudeCode(server: Server, shell: Shell): string {
    const name = AiAssistantConfig.ServerName
    const quote = shell === 'powershell' ? AiAssistantConfig.powerShell : AiAssistantConfig.posix
    const quiet = shell === 'powershell' ? '2>$null' : '2>/dev/null'
    return `claude mcp remove --scope user ${name} ${quiet}; claude mcp add --transport http --scope user ${name} ${quote(AiAssistantConfig.endpoint(server))} --header ${quote(`Authorization: Bearer ${server.apiKey}`)}`
  }

  static codexToml(server: Server): string {
    return `[mcp_servers.${AiAssistantConfig.ServerName}]\nurl = ${JSON.stringify(AiAssistantConfig.endpoint(server))}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${server.apiKey}`)} }`
  }

  private static posix(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`
  }

  private static powerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`
  }

  private static base64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
}
