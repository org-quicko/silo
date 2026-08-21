import { describe, expect, test } from 'bun:test'
import { SnippetView } from './snippet-view'

const snippet = (before: string) => ({ path: '$.data.body', before, match: 'pricing', after: ' page.' })

describe('SnippetView.clamp', () => {
  test('leaves a short lead alone', () => {
    expect(SnippetView.clamp(snippet('the new ')).before).toBe('the new ')
  })

  test('trims a long lead from the left, keeping what touches the match', () => {
    const long = '…[our docs](https://silo.dev) — the new '
    const clamped = SnippetView.clamp(long ? snippet(long) : snippet(''), 12)
    expect(clamped.before).toBe('…) — the new ')
    expect(clamped.match).toBe('pricing')
  })

  test('never doubles the ellipsis the server already added', () => {
    expect(SnippetView.clamp(snippet('…' + 'x'.repeat(40)), 8).before).toBe('…xxxxxxxx')
  })
})
