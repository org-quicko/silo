import { describe, test, expect } from 'bun:test'
import { SiloNames } from '../src/silo/silo-names'

/**
 * The proposed name, on its own.
 *
 * This is the one part of a plan nobody re-reads before running it: an operator
 * scans the column and hits import. So the thing pinned here is that a suggestion
 * carries the *whole* source name, because a short one silently proposes the
 * collection the next import will also want.
 */
describe('the proposed collection name', () => {
  const listFor = (contentType: string) =>
    ({ contentType }) as unknown as Parameters<typeof SiloNames.forList>[0]

  /**
   * The content type's uid, kept whole. Shortened to its last segment — which
   * this did until the name became its own artifact — it proposes the one
   * collection every other Strapi export will also want, in an instance where
   * collections are flat and Strapi's are not.
   */
  test('carries the content type uid whole, namespace included', () => {
    expect(SiloNames.forList(listFor('api::org-quicko-bank.org-quicko-bank'))).toBe(
      'org-quicko-bank',
    )
    expect(SiloNames.forList(listFor('api::blog.article'))).toBe('blog-article')
  })

  /**
   * The name an operator can check the plan against is the one Strapi's own
   * sidebar shows, which is the content type's. A component is nested inside the
   * entry now and never names a collection of its own.
   */
  test('drops "api::" and a segment that only repeats the one before it', () => {
    expect(SiloNames.forList(listFor('api::article.article'))).toBe('article')
    expect(
      SiloNames.forList(
        listFor(
          'api::com-quicko-it-file-2026-incomes-bnp-settlements-template.' +
            'com-quicko-it-file-2026-incomes-bnp-settlements-template',
        ),
      ),
    ).toBe('com-quicko-it-file-2026-incomes-bnp-settlements-template')
  })

  test('a name silo would refuse is never proposed', () => {
    // Leading digits, spaces, and a uid longer than an id may be.
    expect(SiloNames.forList(listFor('api::2024.Some Thing!'))).toBe('some-thing')
    expect(SiloNames.forList(listFor(`api::ns.${'x'.repeat(200)}`))).toMatch(
      /^[a-z][a-z0-9_-]{0,63}$/,
    )
  })
})
