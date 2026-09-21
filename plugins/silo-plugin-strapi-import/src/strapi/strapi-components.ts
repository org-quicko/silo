import type { StrapiDatabase } from './strapi-database'
import { StrapiFields } from './strapi-fields'
import { StrapiIdentifiers } from './strapi-identifiers'
import { StrapiMedia } from './strapi-media'

/**
 * Which physical table holds the rows of a component uid.
 *
 * This is the one piece of Strapi's layout an export does not record. The
 * content-type schema names a component by uid and the table is named from a
 * *pluralised* form of it, produced at the time the table was created by code
 * that reads `src/components/**.json` — files a database export does not carry.
 * So there is nothing to look up, and the three real examples show why deriving
 * it is not an option either:
 *
 * | uid | table |
 * | :-- | :-- |
 * | `org-quicko.bank` | `components_org_quicko_banks` |
 * | `org-quicko.payment-entity` | `components_org_quicko_payment_entiti**es**` |
 * | `org-quicko.states` | `components_org_quicko_states**_s**` |
 *
 * A prefix match handles the first and the third and fails the second; a
 * singularising match handles the first two and fails the third. Reimplementing
 * the pluraliser would be copying a dependency's behaviour by eye, and it would
 * be wrong on exactly the tables nobody thought to test.
 *
 * So the table is **searched for and then proved**: candidates are proposed by
 * five matchers in confidence order, and a candidate only wins if it actually
 * contains the rows the join table points at. The first four read the name; the
 * last one is `byFields`, for the export where the name says nothing at all. A
 * search that cannot be proved returns `null` rather than a guess, and the
 * caller reports that — an unresolvable component is a line on the panel, where
 * a wrong one would be a collection that imports silently empty.
 */
export class StrapiComponents {
  private static readonly Prefix = 'components_'

  /** How many of the referenced ids are checked. All of them would be a query
   *  per candidate per row; a spread sample is what makes two tables whose id
   *  ranges merely overlap tell each other apart. */
  private static readonly Sample = 25

  /**
   * The table for `uid`, or `null` when it cannot be established.
   *
   * `ids` are `cmp_id`s from the join table — rows the answer must contain. They
   * are the whole reason this is a search rather than a naming convention: three
   * component tables all number from 1, so a name that looks right and a table
   * that holds the data are different claims and only the second one matters.
   */
  static tableFor(source: StrapiDatabase, uid: string, ids: readonly number[]): string | null {
    const stem = StrapiComponents.stem(uid)
    const candidates = StrapiComponents.rowTables(source)
    const sample = StrapiComponents.sampleOf(ids)

    // Confidence order, and each tier is tried on its own: a lower tier must not
    // dilute a higher one, because "exactly one survivor" is what makes a match
    // a proof rather than a preference.
    const tiers = [
      candidates.filter((table) => table === stem),
      candidates.filter((table) => StrapiComponents.singular(table) === StrapiComponents.singular(stem)),
      candidates.filter((table) => table.startsWith(stem)),
      // A name Strapi had to shorten shares only its first 50 characters with
      // the uid it was derived from, so neither a prefix nor a plural reaches
      // it. Last tier because it is the widest: the proof below is what makes
      // it safe.
      candidates.filter((table) => StrapiIdentifiers.sharePrefix(table, stem)),
    ]

    for (const tier of tiers) {
      const verified = tier.filter((table) => StrapiComponents.holds(source, table, sample))
      if (verified.length === 1) return verified[0]!
    }
    return StrapiComponents.byFields(source, uid, candidates, sample)
  }

  /**
   * The table whose *fields* are this component's, when nothing about its name
   * is.
   *
   * Strapi writes a component's `collectionName` once, when the component is
   * created, and never again. Rename its category afterwards — a thing the admin
   * offers and an author doing housekeeping takes — and the uid every reference
   * to it now uses shares not one character with the table still holding its
   * rows:
   *
   * | uid | table |
   * | :-- | :-- |
   * | `nature-of-business.test` | `components_test_tests` |
   *
   * No matcher over names reaches that, and there is no mapping in the export to
   * look it up in. What the export does hold is the content-manager
   * configuration, which names the component's *fields* (`StrapiFields`) — so a
   * table that has a column, a child or a media field for every one of them,
   * while holding the rows the join table points at, is being identified by its
   * data rather than by its spelling.
   *
   * Last and strictest, because it proposes every component table in the
   * database: every field must be accounted for, and exactly one table may
   * survive. An export with no content-manager configuration has nothing to
   * prove with, and this answers the `null` the search would have returned
   * anyway.
   */
  private static byFields(
    source: StrapiDatabase,
    uid: string,
    candidates: readonly string[],
    sample: readonly number[],
  ): string | null {
    const fields = StrapiFields.of(source, uid)
    if (fields.length === 0) return null

    // A media field is stored in `files_related_mph` rather than in a column, so
    // a table that is missing it is not thereby the wrong table.
    const media = new Set(StrapiMedia.fieldsOf(source, uid).map((field) => field.name))

    const verified = candidates.filter((table) => {
      if (!StrapiComponents.holds(source, table, sample)) return false
      const held = StrapiComponents.fieldsOf(source, table)
      return fields.every(
        (field) =>
          media.has(field) || held.has(field) || held.has(StrapiIdentifiers.column(field)),
      )
    })
    return verified.length === 1 ? verified[0]! : null
  }

  /** Every field a table holds itself: its columns, and the component fields its
   *  `_cmps` table names. Both spellings land in one set — a column is
   *  snake_case and a join field is the attribute name verbatim. */
  private static fieldsOf(source: StrapiDatabase, table: string): Set<string> {
    const held = new Set(source.columns(table).map((column) => column.name))
    const join = source.joinTable(table)
    if (join) {
      const rows = source.rows<{ field: string }>(
        `SELECT DISTINCT field FROM "${join}" WHERE field IS NOT NULL`,
      )
      for (const row of rows) held.add(row.field)
    }
    return held
  }

  /**
   * The tables an answer could be: every `components_` table that is not the
   * `_cmps` of another one.
   *
   * A join table has an `id` column numbered from 1, so it passes `holds` as
   * readily as the table beside it, and `components_container_connections` and
   * `components_container_connections_cmps` both survive a prefix match — a tier
   * of two survivors resolves to nothing. It is recognised by the table it
   * belongs to rather than by its suffix, because a component genuinely named
   * `cmp` would pluralise into one.
   */
  private static rowTables(source: StrapiDatabase): string[] {
    const tables = source.tables(StrapiComponents.Prefix)
    const named = new Set(tables)
    return tables.filter(
      (table) => !(table.endsWith('_cmps') && named.has(table.slice(0, -'_cmps'.length))),
    )
  }

  /** `org-quicko.state-code` → `components_org_quicko_state_code`. Strapi's own
   *  transform, minus the pluralisation this file exists to avoid. */
  private static stem(uid: string): string {
    return StrapiComponents.Prefix + uid.replace(/[.-]/g, '_')
  }

  /**
   * A crude singular, used only to compare two names with each other.
   *
   * Deliberately not a pluraliser: it never has to *produce* a table name, only
   * to bring two spellings of the same word together, so being wrong in the same
   * direction on both sides costs nothing. `entities` and `entity` meet at
   * `entity`; `banks` and `bank` at `bank`.
   */
  private static singular(name: string): string {
    if (name.endsWith('ies')) return `${name.slice(0, -3)}y`
    if (/(ss|ch|sh|x|z)es$/.test(name)) return name.slice(0, -2)
    if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1)
    return name
  }

  /** Up to `Sample` ids, spread across the list rather than taken from the
   *  front — a contiguous run from the start is the part most likely to be in
   *  every candidate table. */
  private static sampleOf(ids: readonly number[]): number[] {
    if (ids.length <= StrapiComponents.Sample) return [...ids]
    const stride = Math.ceil(ids.length / StrapiComponents.Sample)
    const sample: number[] = []
    for (let at = 0; at < ids.length; at += stride) sample.push(ids[at]!)
    return sample
  }

  /** Whether `table` contains every id in `sample`. An empty sample answers
   *  `true`: the list is empty, so there is nothing to prove and nothing at
   *  risk. */
  private static holds(source: StrapiDatabase, table: string, sample: readonly number[]): boolean {
    if (sample.length === 0) return true
    try {
      const placeholders = sample.map(() => '?').join(', ')
      const found = source.rows<{ n: number }>(
        `SELECT COUNT(*) AS n FROM "${table}" WHERE id IN (${placeholders})`,
        ...sample,
      )
      return found[0]?.n === sample.length
    } catch {
      // A candidate with no `id` column is not a component table. Reported as a
      // failed proof rather than thrown: the search has other candidates.
      return false
    }
  }
}
