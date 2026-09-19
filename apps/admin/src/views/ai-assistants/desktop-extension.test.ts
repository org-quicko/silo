import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopExtension } from './desktop-extension'
import { StoredZip } from './stored-zip'

/** Reads stored entries independently of the package generator. */
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
}

const server = { id: 'fixture', name: 'Équipe content', url: 'https://example.test/cms/', apiKey: 'silo_private_${HOME}' }

describe('desktop extension', () => {
  test('packs the current connection as data and uses the bundled runtime', () => {
    const files = ExtensionFixture.files(DesktopExtension.create(server))
    const manifest = JSON.parse(files['manifest.json'])
    expect(manifest.display_name).toBe('Silo — Équipe content')
    expect(manifest.server.mcp_config).toEqual({ command: 'node', args: ['${__dirname}/server/index.cjs'] })
    expect(files[manifest.server.entry_point]).toContain('class SiloDesktopBridge')
    expect(JSON.parse(files['server/connection.json'])).toEqual({ endpoint: 'https://example.test/cms/api/mcp', apiKey: server.apiKey })
    expect(files['manifest.json']).not.toContain(server.apiKey)
    expect(files['server/index.cjs']).not.toContain(server.apiKey)
  })

  test('ZIP records the standard CRC-32 check value and UTF-8 paths', () => {
    const archive = StoredZip.create({ 'é.txt': '123456789' })
    expect(new DataView(archive.buffer).getUint32(14, true)).toBe(0xcbf43926)
    expect(ExtensionFixture.files(archive)).toEqual({ 'é.txt': '123456789' })
  })

  test('the shipped process forwards credentials, suppresses notifications and recovers from errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'silo-extension-test-'))
    try {
      const files = ExtensionFixture.files(DesktopExtension.create(server))
      writeFileSync(join(directory, 'index.cjs'), files['server/index.cjs'])
      writeFileSync(join(directory, 'connection.json'), files['server/connection.json'])
      writeFileSync(join(directory, 'preload.cjs'), `
        const { writeFileSync } = require('node:fs');
        global.fetch = async (endpoint, options) => {
          writeFileSync(${JSON.stringify(join(directory, 'request.json'))}, JSON.stringify({endpoint, ...options}));
          const message = JSON.parse(options.body);
          if (message.method === 'refused') return new Response('{}', {status: 401});
          if (message.method === 'offline') throw new Error('secret: ' + options.headers.authorization);
          if (!Object.hasOwn(message, 'id')) return new Response(null, {status: 202});
          return Response.json({jsonrpc: '2.0', id: message.id, result: {ok: true}});
        };
      `)
      const child = spawnSync(process.execPath, ['--preload', join(directory, 'preload.cjs'), join(directory, 'index.cjs')], {
        input: [
          '{bad json',
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'refused' }),
          JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'offline' }),
          JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
        ].join('\n') + '\n',
        encoding: 'utf8', timeout: 10000,
      })
      expect(child.status).toBe(0)
      expect(child.stderr).toBe('')
      expect(child.stdout).not.toContain(server.apiKey)
      const replies = child.stdout.trim().split('\n').map((line) => JSON.parse(line))
      expect(replies).toHaveLength(4)
      expect(replies.find((reply) => reply.id === null).error.code).toBe(-32700)
      expect(replies.find((reply) => reply.id === 1).error.message).toContain('no longer valid')
      expect(replies.find((reply) => reply.id === 2).error.message).toContain('Could not reach Silo')
      expect(replies.find((reply) => reply.id === 3).result).toEqual({ ok: true })
      const request = JSON.parse(readFileSync(join(directory, 'request.json'), 'utf8'))
      expect(request.endpoint).toBe('https://example.test/cms/api/mcp')
      expect(request.headers.authorization).toBe(`Bearer ${server.apiKey}`)
      expect(request.redirect).toBe('error')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
