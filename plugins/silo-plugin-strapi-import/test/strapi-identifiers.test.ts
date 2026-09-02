import { describe, test, expect } from 'bun:test'
import { StrapiIdentifiers } from '../src/strapi/strapi-identifiers'

/**
 * Strapi's table-name shortener, pinned against the names a real instance
 * actually has.
 *
 * These two are transcribed from an export's `sqlite_master`, not computed —
 * which is the only thing that makes them a test. The plugin read
 * `collectionName`, asked whether that table existed, and reported the two
 * longest content types in the instance as missing from an export holding every
 * one of their rows.
 *
 * The digest is **shake256**, and that is worth a test on its own because four
 * better guesses are all wrong: sha256, sha1, md5 and sha3-256 each produce five
 * plausible characters and none of them produce Strapi's.
 */
describe("the name Strapi gives a table it cannot call by its own name", () => {
  test('shortens past 55 characters to 50 characters and a digest', () => {
    expect(
      StrapiIdentifiers.shorten('com_quicko_it_file_2026_incomes_bnp_settlements_templates'),
    ).toBe('com_quicko_it_file_2026_incomes_bnp_settlements_teec0f2')
    expect(
      StrapiIdentifiers.shorten('com_quicko_it_file_2026_incomes_cg_settlements_templates'),
    ).toBe('com_quicko_it_file_2026_incomes_cg_settlements_tem2872f')
  })

  test('leaves a name that fits exactly as it is', () => {
    const fits = 'a'.repeat(StrapiIdentifiers.MaxLength)
    expect(StrapiIdentifiers.shorten(fits)).toBe(fits)
    expect(StrapiIdentifiers.shorten('com_quicko_events')).toBe('com_quicko_events')
    expect(StrapiIdentifiers.spellings('com_quicko_events')).toEqual(['com_quicko_events'])
  })

  /** Both spellings, declared first: an export may hold either, and a name that
   *  fits is only ever itself. */
  test('offers the declared name before the shortened one', () => {
    expect(
      StrapiIdentifiers.spellings('com_quicko_it_file_2026_incomes_bnp_settlements_templates'),
    ).toEqual([
      'com_quicko_it_file_2026_incomes_bnp_settlements_templates',
      'com_quicko_it_file_2026_incomes_bnp_settlements_teec0f2',
    ])
  })

  /**
   * What `StrapiComponents` narrows candidates with when it cannot compute the
   * digest, because the name it would have to hash is the *pluralised* table name
   * it is trying to find in the first place.
   */
  test('two names that survive shortening to the same prefix are candidates', () => {
    const declared = 'com_quicko_it_file_2026_incomes_bnp_settlements_template'
    expect(
      StrapiIdentifiers.sharePrefix('com_quicko_it_file_2026_incomes_bnp_settlements_teec0f2', declared),
    ).toBe(true)
    // A stored name that fits was never shortened, so it is not a candidate.
    expect(StrapiIdentifiers.sharePrefix('com_quicko_events', declared)).toBe(false)
    // And a declared name too short to have been shortened has no prefix to share.
    expect(
      StrapiIdentifiers.sharePrefix('com_quicko_it_file_2026_incomes_bnp_settlements_teec0f2', 'short'),
    ).toBe(false)
  })
})
