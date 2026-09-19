import type { Server } from '../servers/server'
import type { Shell } from './ai-assistant'

/** Builds client fragments from the saved instance connection without storing a copy. */
export class AiAssistantConfig {
  static endpoint(server: Server): string {
    const base = server.url.trim().replace(/\/+$/, '')
    return base.endsWith('/api/mcp') ? base : `${base}/api/mcp`
  }

  /** A stable client identifier derived from the saved server's id. */
  static name(server: Server): string {
    const suffix = server.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-') || 'server'
    return `silo-${suffix}`
  }

  static cursorUri(server: Server): string {
    const config = JSON.stringify({ url: AiAssistantConfig.endpoint(server), headers: { Authorization: `Bearer ${server.apiKey}` } })
    const encoded = AiAssistantConfig.base64Utf8(config)
    return `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({ name: AiAssistantConfig.name(server), config: encoded })}`
  }

  static cursorJson(server: Server): string {
    return JSON.stringify({ mcpServers: { [AiAssistantConfig.name(server)]: { url: AiAssistantConfig.endpoint(server), headers: { Authorization: `Bearer ${server.apiKey}` } } } }, null, 2)
  }

  static claudeCode(server: Server, shell: Shell): string {
    const values = [AiAssistantConfig.name(server), AiAssistantConfig.endpoint(server), `Authorization: Bearer ${server.apiKey}`]
    const quote = shell === 'powershell' ? AiAssistantConfig.powerShell : AiAssistantConfig.posix
    return `claude mcp add --transport http --scope user ${quote(values[0])} ${quote(values[1])} --header ${quote(values[2])}`
  }

  static codexToml(server: Server): string {
    const name = AiAssistantConfig.name(server)
    return `[mcp_servers.${name}]\nurl = ${JSON.stringify(AiAssistantConfig.endpoint(server))}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${server.apiKey}`)} }`
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
