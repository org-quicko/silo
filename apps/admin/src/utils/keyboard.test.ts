import { describe, expect, test } from 'bun:test'
import { Keyboard } from './keyboard'

describe('Keyboard.isTyping', () => {
  test('is true for the elements that own their own keys', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(Keyboard.isTyping({ tagName } as any)).toBe(true)
    }
    expect(Keyboard.isTyping({ tagName: 'DIV', isContentEditable: true } as any)).toBe(true)
  })

  test('is false for the page and for the buttons on it', () => {
    expect(Keyboard.isTyping(null)).toBe(false)
    expect(Keyboard.isTyping({ tagName: 'BUTTON' } as any)).toBe(false)
    expect(Keyboard.isTyping({ tagName: 'DIV' } as any)).toBe(false)
  })
})
