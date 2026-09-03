import { describe, expect, test } from 'bun:test'
import { EntriesShortcuts } from './entries-shortcuts'

const press = (key: string, modifiers = {}) => EntriesShortcuts.actionFor({ key, ...modifiers }, false)

describe('EntriesShortcuts.actionFor', () => {
  test('reads the arrows and their vim twins the same way', () => {
    expect(press('ArrowDown')).toBe('next-row')
    expect(press('j')).toBe('next-row')
    expect(press('ArrowUp')).toBe('previous-row')
    expect(press('k')).toBe('previous-row')
    expect(press('ArrowLeft')).toBe('previous-page')
    expect(press('h')).toBe('previous-page')
    expect(press('ArrowRight')).toBe('next-page')
    expect(press('l')).toBe('next-page')
  })

  test('carries the row and page actions', () => {
    expect(press('e')).toBe('open')
    expect(press('Backspace')).toBe('delete')
    expect(press('Delete')).toBe('delete')
    expect(press('n')).toBe('new')
    expect(press('f')).toBe('filter')
    expect(press('c')).toBe('columns')
    expect(press('Escape')).toBe('dismiss')
    expect(press('Home')).toBe('first-row')
    expect(press('End')).toBe('last-row')
  })

  // The focused row is a button and opens itself; binding Enter here as well
  // would open the entry twice. `?` opens a list covering the whole app, so the
  // shell owns it.
  test('leaves Enter to the focused row and ? to the shell', () => {
    expect(press('Enter')).toBeNull()
    expect(press(' ')).toBeNull()
    expect(press('?')).toBeNull()
  })

  test('a modified press belongs to something else', () => {
    expect(press('k', { metaKey: true })).toBeNull()
    expect(press('n', { ctrlKey: true })).toBeNull()
    expect(press('f', { altKey: true })).toBeNull()
  })

  test('nothing fires while a field is being typed in, its Escape included', () => {
    expect(EntriesShortcuts.actionFor({ key: 'n' }, true)).toBeNull()
    expect(EntriesShortcuts.actionFor({ key: 'Escape' }, true)).toBeNull()
  })

  test('an unmapped key is not ours', () => {
    expect(press('z')).toBeNull()
    expect(press('PageDown')).toBeNull()
  })
})
