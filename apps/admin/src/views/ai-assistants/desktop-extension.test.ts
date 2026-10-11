import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopExtension } from './desktop-extension'
import { StoredZip } from './stored-zip'

interface BridgeReply {
  id: number | null
  result?: unknown
  error?: { code: number; message: string }
}

interface RecordedRequest {
  endpoint: string
  headers: Record<string, string | undefined>
  redirect: string
}

/** Reads stored entries independently of the package generator, and runs the shipped entry point. */
class ExtensionFixture {
  static files(archive: Uint8Array): Record<string, string> {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const files: Record<string, string> = {}
    let offset = 0
    while (view.getUint32(offset, true) === 0x04034b50) {
      const size = view.getUint32(offset + 18, true)
      const nameLength = view.getUint16(offset + 26, true)
      const extraLength = view.getUint16(offset + 28, true)
      const name = new TextDecoder().decode(archive.slice(offset + 30, offset + 30 + nameLength))
      const start = offset + 30 + nameLength + extraLength
      files[name] = new TextDecoder().decode(archive.slice(start, start + size))
      offset = start + size
    }
    expect(view.getUint32(offset, true)).toBe(0x02014b50)
    return files
  }

  /** Runs the bridge under a stub `fetch`, with the environment the host builds from the settings. */
  static run(env: Record<string, string>, lines: string[]) {
    const directory = mkdtempSync(join(tmpdir(), 'silo-extension-test-'))
    const requestPath = join(directory, 'request.json')
    try {
      const files = ExtensionFixture.files(DesktopExtension.create(server))
      writeFileSync(join(directory, 'index.cjs'), files['server/index.cjs'])
      writeFileSync(join(directory, 'preload.cjs'), `
        const { writeFileSync } = require('node:fs');
        global.fetch = async (endpoint, options) => {
          writeFileSync(${JSON.stringify(requestPath)}, JSON.stringify({endpoint, ...options}));
          const message = JSON.parse(options.body);
          if (message.method === 'refused') return new Response('{}', {status: 401});
          if (message.method === 'offline') throw new Error('secret: ' + options.headers.authorization);
          if (message.method === 'webpage') return new Response('<html></html>', {status: 404});
          if (!Object.hasOwn(message, 'id')) return new Response(null, {status: 202});
          return Response.json({jsonrpc: '2.0', id: message.id, result: {ok: true}});
        };
      `)
      const child = spawnSync(process.execPath, ['--preload', join(directory, 'preload.cjs'), join(directory, 'index.cjs')], {
        input: lines.join('\n') + '\n',
        env: { ...process.env, ...env },
        encoding: 'utf8', timeout: 10000,
      })
      expect(child.status).toBe(0)
      expect(child.stderr).toBe('')
      const replies: BridgeReply[] = child.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      const request: RecordedRequest | undefined = existsSync(requestPath) ? JSON.parse(readFileSync(requestPath, 'utf8')) : undefined
      return { stdout: child.stdout, replies, request, error: (id: number) => replies.find((reply) => reply.id === id)?.error?.message }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

const server = { id: 'fixture', name: 'Équipe content', url: 'https://example.test/cms/', apiKey: 'silo_Zm9v-YmFy_0123456789abcdefghijklmnopqrstu' }
const unset = { SILO_URL: '${user_config.server_url}', SILO_API_KEY: '${user_config.api_key}' }
const call = (id: number, method: string) => JSON.stringify({ jsonrpc: '2.0', id, method })

describe('desktop extension', () => {
  test('is named silo and carries the connection as editable settings, not as a bundled file', () => {
    const files = ExtensionFixture.files(DesktopExtension.create(server))
    const manifest = JSON.parse(files['manifest.json'])
    expect(DesktopExtension.Filename).toBe('silo.mcpb')
    expect(manifest.name).toBe('silo')
    expect(manifest.display_name).toBe('Silo')
    expect(manifest.server.mcp_config).toEqual({ command: 'node', args: ['${__dirname}/server/index.cjs'], env: unset })
    expect(manifest.user_config.server_url).toMatchObject({ type: 'string', default: 'https://example.test/cms' })
    expect(manifest.user_config.api_key).toMatchObject({ type: 'string', sensitive: true, default: server.apiKey })
    // A required setting would stop the host applying the default until someone saves it.
    expect(manifest.user_config.server_url.required).toBeUndefined()
    expect(manifest.user_config.api_key.required).toBeUndefined()
    expect(Object.keys(files)).toEqual(['manifest.json', 'server/index.cjs'])
    expect(files[manifest.server.entry_point]).toContain('class SiloDesktopBridge')
    expect(files['server/index.cjs']).not.toContain(server.apiKey)
  })

  test('ZIP records the standard CRC-32 check value and UTF-8 paths', () => {
    const archive = StoredZip.create({ 'é.txt': '123456789' })
    expect(new DataView(archive.buffer).getUint32(14, true)).toBe(0xcbf43926)
    expect(ExtensionFixture.files(archive)).toEqual({ 'é.txt': '123456789' })
  })

  test('the shipped process forwards to the configured server, suppresses notifications and recovers from errors', () => {
    const run = ExtensionFixture.run({ SILO_URL: server.url, SILO_API_KEY: server.apiKey }, [
      '{bad json',
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      call(1, 'refused'), call(2, 'offline'), call(3, 'ping'), call(4, 'webpage'),
    ])
    expect(run.stdout).not.toContain(server.apiKey)
    expect(run.replies).toHaveLength(5)
    expect(run.replies.find((reply) => reply.id === null)?.error?.code).toBe(-32700)
    expect(run.error(1)).toContain('did not accept the API key')
    expect(run.error(2)).toContain('Could not reach Silo')
    expect(run.replies.find((reply) => reply.id === 3)?.result).toEqual({ ok: true })
    expect(run.error(4)).toContain('HTTP 404 without an MCP reply')
    expect(run.request?.endpoint).toBe('https://example.test/cms/api/mcp')
    expect(run.request?.headers.authorization).toBe(`Bearer ${server.apiKey}`)
    expect(run.request?.redirect).toBe('error')
  })

  test('an empty or unusable setting is answered by name instead of being sent', () => {
    const empty = ExtensionFixture.run(unset, [call(1, 'ping')])
    expect(empty.error(1)).toContain('No server URL is set')
    expect(empty.request).toBeUndefined()

    const invalid = ExtensionFixture.run({ ...unset, SILO_URL: 'http://exa mple' }, [call(1, 'ping')])
    expect(invalid.error(1)).toContain('not a valid URL')

    const keyless = ExtensionFixture.run({ ...unset, SILO_URL: 'localhost:8090/api/mcp/' }, [call(1, 'refused')])
    expect(keyless.error(1)).toContain('Silo needs an API key')
    expect(keyless.request?.endpoint).toBe('http://localhost:8090/api/mcp')
    expect(keyless.request?.headers.authorization).toBeUndefined()
  })
})
