import { describe, expect, test } from 'bun:test'
import { MentionToken } from './mention-token'

describe('MentionToken.at', () => {
  test('opens at the start of the field', () => {
    expect(MentionToken.at('@', 1)).toEqual({ start: 0, query: '' })
    expect(MentionToken.at('@post', 5)).toEqual({ start: 0, query: 'post' })
  })

  test('opens after whitespace', () => {
    expect(MentionToken.at('hello @post', 11)).toEqual({ start: 6, query: 'post' })
  })

  test('never opens mid-word — an email in the query must not summon it', () => {
    expect(MentionToken.at('me@example.com', 3)).toBeNull()
    expect(MentionToken.at('me@example.com', 14)).toBeNull()
  })

  test('the caret must still be inside the run — a finished mention followed by a space is not active', () => {
    expect(MentionToken.at('@post ', 6)).toBeNull()
    expect(MentionToken.at('@post hi', 8)).toBeNull()
  })

  test('one chip: the nearest `@` to the caret governs, not the first one typed', () => {
    expect(MentionToken.at('@one @two', 9)).toEqual({ start: 5, query: 'two' })
  })

  test('no `@` at all is no mention', () => {
    expect(MentionToken.at('hello world', 5)).toBeNull()
  })

  test('caret before any `@` sees no mention', () => {
    expect(MentionToken.at('@post', 0)).toBeNull()
  })
})

describe('MentionToken.consume', () => {
  test('removes the run and trims the orphaned leading space', () => {
    expect(MentionToken.consume('@post hello', { start: 0, query: 'post' })).toBe('hello')
  })

  test('closes the gap a mid-sentence mention leaves, rather than doubling the space', () => {
    expect(MentionToken.consume('find @post error', { start: 5, query: 'post' })).toBe('find error')
  })

  test('leaves whitespace the user typed themselves alone', () => {
    expect(MentionToken.consume('a  b @post', { start: 5, query: 'post' })).toBe('a  b ')
  })

  test('a bare `@` with nothing after it consumes to nothing', () => {
    expect(MentionToken.consume('@', { start: 0, query: '' })).toBe('')
  })
})
