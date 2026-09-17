import { describe, test, expect } from 'bun:test'
import { TransferInclude } from './transfer-include'
import type { TransferTree } from './transfer-tree'

const tree: TransferTree = {
  projects: [
    {
      name: 'site',
      envs: [
        { name: 'prod', collections: [{ name: 'posts', entries: 2 }, { name: 'pages', entries: 1 }] },
        { name: 'staging', collections: [{ name: 'posts', entries: 0 }] },
      ],
    },
    { name: 'shop', envs: [{ name: 'prod', collections: [{ name: 'orders', entries: 5 }] }] },
  ],
  media: 3,
  partial: false,
}

describe('TransferInclude', () => {
  test('an empty list covers everything, which is what the server means by an absent include', () => {
    expect(TransferInclude.covered([], 'site/prod/posts')).toBe(true)
    expect(TransferInclude.describe([])).toBe('The whole instance')
  })

  test('adding a broader rule drops the narrower ones it now covers', () => {
    expect(TransferInclude.add(['site/prod/posts', 'shop'], 'site')).toEqual(['shop', 'site'])
  })

  test('adding inside an already-chosen rule changes nothing', () => {
    expect(TransferInclude.add(['site'], 'site/prod/posts')).toEqual(['site'])
  })

  test('unchecking inside a broad rule keeps the rest of it', () => {
    // Unchecking one environment of a chosen project must leave the others in,
    // which means replacing the broad rule with its siblings.
    expect(TransferInclude.remove(['site'], 'site/prod', tree)).toEqual(['site/staging'])
  })

  test('unchecking one collection expands only as far as it has to', () => {
    expect(TransferInclude.remove(['site'], 'site/prod/posts', tree)).toEqual([
      'site/prod/pages',
      'site/staging',
    ])
  })

  test('a rule with some children chosen reads as partial, not chosen', () => {
    const rules = ['site/prod/posts']
    expect(TransferInclude.covered(rules, 'site')).toBe(false)
    expect(TransferInclude.partial(rules, 'site')).toBe(true)
    expect(TransferInclude.partial(rules, 'site/prod/posts')).toBe(false)
    expect(TransferInclude.partial(rules, 'shop')).toBe(false)
  })

  test('removing the last rule empties the list rather than leaving a stale one', () => {
    expect(TransferInclude.remove(['shop'], 'shop', tree)).toEqual([])
  })

  test('unchecking from the implied everything writes out what was implied first', () => {
    // The empty list has nothing to subtract from, so the first uncheck has to
    // materialise it before it can take anything away.
    expect(TransferInclude.toggle([], 'shop', false, tree)).toEqual(['site'])
    expect(TransferInclude.toggle([], 'site/prod/posts', false, tree)).toEqual([
      'shop',
      'site/prod/pages',
      'site/staging',
    ])
  })

  test('checking the last missing branch collapses back to everything', () => {
    // A list naming every project and the empty list mean the same thing, and
    // only one of them is what the server reads as the whole instance.
    expect(TransferInclude.toggle(['site'], 'shop', true, tree)).toEqual([])
  })
})
