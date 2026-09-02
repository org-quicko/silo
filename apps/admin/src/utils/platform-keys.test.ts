import { describe, expect, test } from 'bun:test'
import { PlatformKeys } from './platform-keys'

describe('PlatformKeys', () => {
  test('labels the Apple modifiers with their glyphs', () => {
    for (const platform of ['macOS', 'MacIntel', 'iPhone', 'iPad']) {
      expect(PlatformKeys.command(platform)).toBe('⌘')
      expect(PlatformKeys.alt(platform)).toBe('⌥')
    }
  })

  test('names them everywhere else, since those keyboards have no ⌘', () => {
    for (const platform of ['Windows', 'Win32', 'Linux x86_64', '']) {
      expect(PlatformKeys.command(platform)).toBe('Ctrl+')
      expect(PlatformKeys.alt(platform)).toBe('Alt+')
    }
  })
})
