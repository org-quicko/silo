import { describe, expect, test } from 'bun:test'
import { SaveShortcut } from './save-shortcut'

describe('SaveShortcut.matches', () => {
  test('matches Meta+S and Ctrl+S', () => {
    expect(SaveShortcut.matches({ key: 's', metaKey: true })).toBe(true)
    expect(SaveShortcut.matches({ key: 'S', ctrlKey: true })).toBe(true)
  })

  test('ignores unmodified S, repeated presses, or extra modifiers', () => {
    expect(SaveShortcut.matches({ key: 's' })).toBe(false)
    expect(SaveShortcut.matches({ key: 's', metaKey: true, repeat: true })).toBe(false)
    expect(SaveShortcut.matches({ key: 's', metaKey: true, altKey: true })).toBe(false)
    expect(SaveShortcut.matches({ key: 's', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(SaveShortcut.matches({ key: 'k', metaKey: true })).toBe(false)
  })
})
