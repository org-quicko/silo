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
  const listFor = (fields: { component?: string; contentType?: string }) =>
    ({
      component: fields.component ?? null,
      contentType: fields.contentType ?? 'api::thing.thing',
    }) as unknown as Parameters<typeof SiloNames.forList>[0]

  /**
   * `org-quicko.bank` inside the single type `Org-quicko-bank` is the thing being
   * imported, and it keeps its namespace. Shortened to `bank` — which this did
   * until the name became its own artifact — it proposes the one collection every
   * other Strapi export will also want, in an instance where collections are flat
   * and Strapi's are not.
   */
  test('carries the component uid whole, namespace included', () => {
    expect(SiloNames.forList(listFor({ component: 'org-quicko.bank' }))).toBe('org-quicko-bank')
    expect(SiloNames.forList(listFor({ component: 'org-quicko.state-code' }))).toBe(
      'org-quicko-state-code',
    )
    expect(SiloNames.forList(listFor({ component: 'org-quicko.payment-entity' }))).toBe(
      'org-quicko-payment-entity',
    )
  })

  test('drops "api::" and a segment that only repeats the one before it', () => {
    expect(SiloNames.forList(listFor({ contentType: 'api::article.article' }))).toBe('article')
    expect(SiloNames.forList(listFor({ contentType: 'api::blog.article' }))).toBe('blog-article')
    // A content type with no component of its own keeps its own uid whole too.
    expect(
      SiloNames.forList(listFor({ contentType: 'api::org-quicko-bank.org-quicko-bank' })),
    ).toBe('org-quicko-bank')
  })

  test('a name silo would refuse is never proposed', () => {
    // Leading digits, spaces, and a uid longer than an id may be.
    expect(SiloNames.forList(listFor({ component: '2024.Some Thing!' }))).toBe('some-thing')
    expect(SiloNames.forList(listFor({ component: `ns.${'x'.repeat(200)}` }))).toMatch(
      /^[a-z][a-z0-9_-]{0,63}$/,
    )
  })
})
