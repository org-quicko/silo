import { describe, expect, test } from 'bun:test'
import { Claims } from '@silo/shared/claims'
import { HookNames } from '@silo/shared/hook-names'
import { ClaimGroups } from './claim-groups'
import { ClaimWords } from './claim-words'

const titles = (claims: string[]) => ClaimGroups.build(claims).map((group) => group.title)
const lines = (claims: string[]) => ClaimGroups.build(claims).flatMap((group) => group.lines)

describe('ClaimGroups.build', () => {
  test('root collapses to one warned group', () => {
    const groups = ClaimGroups.build(['*'])
    expect(groups).toHaveLength(1)
    expect(groups[0].warn).toBe(true)
  })

  test('names the target of a collection claim, and its permissions widest-first', () => {
    const groups = ClaimGroups.build([
      'collections:blog/prod/posts:entries:delete',
      'collections:blog/prod/posts:entries:read',
    ])
    expect(groups[0].title).toBe('blog / prod · posts')
    expect(groups[0].lines).toEqual(['read entries', 'delete entries'])
    expect(groups[0].warn).toBe(true)
  })

  test('wildcards read as words rather than asterisks', () => {
    expect(titles(['collections:*/*/*:entries:read'])).toEqual([
      'every project / every environment · all collections',
    ])
  })

  /**
   * The bug this file exists for.
   *
   * Between D34 and D40 hook claims rendered as *nothing*: the builder asked
   * only whether a claim parsed as a collection or a known fixed one, and a hook
   * claim is neither. Measured on the pair below — one of them instance-wide
   * `entry.afterWrite` — the summary said "read entries" and stopped.
   */
  test('renders hook delivery, and leads with it', () => {
    const groups = ClaimGroups.build([
      'collections:blog/prod/posts:entries:read',
      'hooks:blog/prod/posts:entry.beforeValidate',
      'hooks:*/*/*:entry.afterWrite',
    ])
    expect(groups.map((group) => group.title)).toEqual([
      'blog / prod · posts · hooks',
      'every project / every environment · all collections · hooks',
      'blog / prod · posts',
    ])
    expect(groups[0].lines).toEqual(['rewrite entries before they are validated'])
  })

  test('a hook that can change or stop a write is flagged; an observer is not', () => {
    expect(ClaimGroups.build(['hooks:blog/prod/posts:entry.beforeWrite'])[0].warn).toBe(true)
    expect(ClaimGroups.build(['hooks:blog/prod/posts:entry.afterWrite'])[0].warn).toBe(false)
  })

  test('a hook group is its own group, never merged into the collection one', () => {
    const groups = ClaimGroups.build([
      'collections:blog/prod/posts:entries:read',
      'hooks:blog/prod/posts:entry.afterWrite',
    ])
    expect(groups).toHaveLength(2)
    // Distinct titles matter beyond reading: the summary renders keyed on them.
    expect(new Set(groups.map((group) => group.title)).size).toBe(2)
  })

  test('fixed claims group by subject in reading order', () => {
    expect(lines(['media:delete', 'media:read'])).toEqual(['list media', 'delete media'])
  })

  /**
   * The rule that generalises: a summary may not drop what it does not
   * recognise, whatever *kind* the unrecognised thing turns out to be.
   */
  test('anything with no words for it is printed raw under Also', () => {
    const groups = ClaimGroups.build(['audit:read', 'not-a-real:claim'])
    expect(groups.at(-1)).toEqual({ title: 'Also', lines: ['not-a-real:claim'], warn: true })
  })

  test('every claim held is spoken for by some group', () => {
    const held = [
      'collections:blog/prod/posts:entries:read',
      'hooks:blog/prod/posts:entry.beforeDelete',
      'plugins:grant',
      'audit:read',
    ]
    const rendered = ClaimGroups.build(held).flatMap((group) => group.lines)
    expect(rendered).toHaveLength(4)
  })
})

describe('ClaimWords', () => {
  test('has words for every hook silo can deliver', () => {
    for (const hook of HookNames.All) expect(ClaimWords.hooks[hook]).toBeTruthy()
    expect(ClaimWords.hookOrder).toHaveLength(HookNames.All.length)
  })

  /** The catalogue is what stops a new claim rendering as nothing; a fixed
   *  claim missing from it falls through to "Also" instead, which is loud but
   *  not what an operator should be reading. */
  test('has words for every fixed claim in the vocabulary', () => {
    const catalogue = new Set(ClaimWords.catalogue())
    for (const claim of Object.keys(Claims.FixedClaims)) expect(catalogue.has(claim)).toBe(true)
  })

  /**
   * Having words is not the same as using them.
   *
   * `http:route` had words and still summarised as a raw string under "Also",
   * because the summary's section list was written by hand and no prefix
   * matched — measured on a running instance. The test above cannot see that:
   * it asks whether a claim is *known*, and this asks whether it is *spoken*.
   */
  test('summarises every fixed claim in words, never under Also', () => {
    for (const claim of Object.keys(Claims.FixedClaims)) {
      const groups = ClaimGroups.build([claim])
      const also = groups.find((group) => group.title === 'Also')
      expect(also, `${claim} fell through to "Also"`).toBeUndefined()
      expect(groups.flatMap((group) => group.lines)).toContain(ClaimWords.fixed[claim])
    }
  })
})
