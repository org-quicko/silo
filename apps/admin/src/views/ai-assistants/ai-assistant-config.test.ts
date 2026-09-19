import { describe, expect, test } from 'bun:test'
import { AiAssistantConfig } from './ai-assistant-config'

const server = {
  id: 'Silo / EU',
  name: 'EU',
  url: 'https://example.test/silo/',
  apiKey: "silo_'$(danger)",
}

describe('AiAssistantConfig', () => {
  test('keeps a path prefix and derives a safe unique client name', () => {
    expect(AiAssistantConfig.endpoint(server)).toBe('https://example.test/silo/api/mcp')
    expect(AiAssistantConfig.name(server)).toBe('silo-silo-eu')
  })

  test('encodes the exact UTF-8 Cursor connection without a credential proxy', () => {
    const unicodeServer = { ...server, apiKey: 'silo_鍵' }
    const uri = new URL(AiAssistantConfig.cursorUri(unicodeServer))
    const encoded = uri.searchParams.get('config')
    expect(uri.protocol).toBe('cursor:')
    expect(uri.searchParams.get('name')).toBe('silo-silo-eu')
    expect(encoded).not.toBeNull()
    const config = JSON.parse(new TextDecoder().decode(Buffer.from(encoded!, 'base64')))
    expect(config).toEqual({
      url: 'https://example.test/silo/api/mcp',
      headers: { Authorization: 'Bearer silo_鍵' },
    })
  })

  test('quotes POSIX and PowerShell values without expanding shell characters', () => {
    expect(AiAssistantConfig.claudeCode(server, 'posix')).toContain("'Authorization: Bearer silo_'\"'\"'$(danger)'")
    expect(AiAssistantConfig.claudeCode(server, 'powershell')).toContain("'Authorization: Bearer silo_''$(danger)'")
  })

  test('writes a TOML block whose static header preserves the current key', () => {
    const parsed = Bun.TOML.parse(AiAssistantConfig.codexToml(server)) as {
      mcp_servers: Record<string, { url: string; http_headers: { Authorization: string } }>
    }
    expect(parsed.mcp_servers['silo-silo-eu']).toEqual({
      url: 'https://example.test/silo/api/mcp',
      http_headers: { Authorization: "Bearer silo_'$(danger)" },
    })
  })
})
