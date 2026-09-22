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
  test('an empty list is an empty selection, not the whole instance', () => {
    expect(TransferInclude.covered([], 'site/prod/posts')).toBe(false)
    expect(TransferInclude.partial([], 'site')).toBe(false)
    expect(TransferInclude.everything([], tree)).toBe(false)
    expect(TransferInclude.describe([])).toBe('Nothing selected')
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

  test('checking a box adds only that box', () => {
    expect(TransferInclude.toggle([], 'shop', true, tree)).toEqual(['shop'])
    expect(TransferInclude.toggle(['shop'], 'site/prod/posts', true, tree)).toEqual([
      'shop',
      'site/prod/posts',
    ])
  })

  test('checking every child rolls up into the parent that stands for them', () => {
    // Otherwise the scope above stays drawn as partial and its column's own
    // select-all box could never settle on checked.
    expect(TransferInclude.toggle(['site/prod/posts'], 'site/prod/pages', true, tree)).toEqual([
      'site/prod',
    ])
    expect(TransferInclude.toggle(['site/prod'], 'site/staging', true, tree)).toEqual(['site'])
  })

  test('the roll-up stops below the instance, because empty means the opposite', () => {
    expect(TransferInclude.toggle(['site'], 'shop', true, tree)).toEqual(['shop', 'site'])
    expect(TransferInclude.everything(['shop', 'site'], tree)).toBe(true)
  })

  test('unchecking a project leaves the others chosen', () => {
    expect(TransferInclude.toggle(['shop', 'site'], 'shop', false, tree)).toEqual(['site'])
    expect(TransferInclude.toggle(['shop', 'site'], 'site/prod/posts', false, tree)).toEqual([
      'shop',
      'site/prod/pages',
      'site/staging',
    ])
  })

  test('the wire form spells the whole instance as the empty list', () => {
    expect(TransferInclude.wire(['shop', 'site'], tree)).toEqual([])
    expect(TransferInclude.wire(['site'], tree)).toEqual(['site'])
  })

  test('select-all names every project the tree holds', () => {
    expect(TransferInclude.allProjects(tree)).toEqual(['shop', 'site'])
  })
})
