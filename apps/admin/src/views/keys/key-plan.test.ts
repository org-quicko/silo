import { describe, expect, test } from 'bun:test'
import { Claims } from '@silo/shared/claims'
import { KeyClaimFit } from './key-claim-fit'
import { KeyPlan, type AdvancedPlan } from './key-plan'
import { ClaimPatterns } from './claim-patterns'
import { KeyPlanReader } from './key-plan-reader'

const scope = (project: string, env: string) => ({ project, env })

/** Every tab composes a claim list and every tab has to be able to read one
 *  back, so the property worth testing is that the two are inverses. */
const roundTrips = (claims: string[]) => {
  const plan = KeyPlanReader.advanced(claims)
  expect(plan).not.toBeNull()
  return Claims.normalize(KeyPlan.fromAdvanced(plan!))
}

describe('KeyPlan.fromPreset', () => {
  test('expands a role over every scope it is given', () => {
    const claims = KeyPlan.fromPreset({
      role: 'read',
      scopes: [scope('acme', 'prod'), scope('beta', 'prod')],
    })
    expect(claims).toContain(Claims.collection('acme', 'prod', '*', Claims.CollectionEntriesRead))
    expect(claims).toContain(Claims.collection('beta', 'prod', '*', Claims.CollectionEntriesRead))
  })

  test('root ignores its scopes, because it covers every one of them', () => {
    expect(KeyPlan.fromPreset({ role: 'root', scopes: [scope('acme', 'prod')] })).toEqual(['*'])
  })

  test('a duplicated scope row grants no more than one', () => {
    const once = KeyPlan.fromPreset({ role: 'write', scopes: [scope('acme', 'prod')] })
    const twice = KeyPlan.fromPreset({
      role: 'write',
      scopes: [scope('acme', 'prod'), scope('acme', 'prod')],
    })
    expect(twice).toEqual(once)
  })

  test('an unanswered scope contributes nothing rather than an invalid claim', () => {
    expect(KeyPlan.fromPreset({ role: 'read', scopes: [scope('acme', '')] })).toEqual([])
  })
})

describe('KeyPlan.fromAdvanced', () => {
  test('crosses each row s collections with its permissions', () => {
    const claims = KeyPlan.fromAdvanced({
      rows: [
        {
          scope: scope('acme', 'prod'),
          collections: ['posts', 'pages'],
          permissions: [Claims.CollectionEntriesRead],
        },
      ],
      fixed: [],
      transferReplace: false,
    })
    expect(claims).toEqual([
      Claims.collection('acme', 'prod', 'pages', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesRead),
    ])
  })

  test('an empty collection list means every collection in the scope', () => {
    const claims = KeyPlan.fromAdvanced({
      rows: [
        { scope: scope('acme', 'prod'), collections: [], permissions: [Claims.CollectionEntriesRead] },
      ],
      fixed: [],
      transferReplace: false,
    })
    expect(claims).toEqual([Claims.collection('acme', 'prod', '*', Claims.CollectionEntriesRead)])
  })

  test('a transfer capability drags its instance-wide requirement in with it (D21)', () => {
    const claims = KeyPlan.fromAdvanced({
      rows: [],
      fixed: [Claims.TransferExport],
      transferReplace: false,
    })
    expect(claims).toContain(Claims.collection('*', '*', '*', Claims.CollectionSchemaRead))
    expect(claims).toContain(Claims.collection('*', '*', '*', Claims.CollectionEntriesRead))
  })

  test('replace adds the instance-wide delete authority, and only then', () => {
    const merge = KeyPlan.fromAdvanced({ rows: [], fixed: [Claims.TransferImport], transferReplace: false })
    const replace = KeyPlan.fromAdvanced({ rows: [], fixed: [Claims.TransferImport], transferReplace: true })
    const deletes = Claims.collection('*', '*', '*', Claims.CollectionEntriesDelete)
    expect(merge).not.toContain(deletes)
    expect(replace).toContain(deletes)
  })
})

describe('KeyPlanReader.preset', () => {
  test('recognises a role over several scopes', () => {
    const claims = KeyPlan.fromPreset({
      role: 'manage',
      scopes: [scope('acme', 'prod'), scope('beta', 'dev')],
    })
    const read = KeyPlanReader.preset(claims)
    expect(read?.role).toBe('manage')
    expect(read?.scopes).toEqual([scope('acme', 'prod'), scope('beta', 'dev')])
  })

  test('recognises root', () => {
    expect(KeyPlanReader.preset(['*'])).toEqual({ role: 'root', scopes: [] })
  })

  test('reports the narrowest role when one claim set could be read as two', () => {
    // `read` and `write` differ, so this is only ambiguous if a role is ever
    // made a subset of another; the ordering is what keeps that honest.
    expect(KeyPlanReader.preset(KeyPlan.fromPreset({ role: 'read', scopes: [scope('acme', 'prod')] }))?.role)
      .toBe('read')
  })

  test('refuses a list that is a role plus one extra claim', () => {
    const claims = [
      ...KeyPlan.fromPreset({ role: 'read', scopes: [scope('acme', 'prod')] }),
      Claims.MediaCreate,
    ]
    expect(KeyPlanReader.preset(claims)).toBeNull()
  })

  test('refuses a list narrowed to named collections', () => {
    expect(
      KeyPlanReader.preset([Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesRead)]),
    ).toBeNull()
  })
})

describe('KeyPlanReader.advanced', () => {
  test('round-trips a single scope narrowed to named collections', () => {
    const claims = [
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'pages', Claims.CollectionEntriesRead),
    ]
    expect(roundTrips(claims)).toEqual(Claims.normalize(claims))
  })

  test('round-trips collections in one scope holding different permissions', () => {
    const claims = [
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesUpdate),
      Claims.collection('acme', 'prod', 'pages', Claims.CollectionEntriesRead),
    ]
    expect(roundTrips(claims)).toEqual(Claims.normalize(claims))
  })

  test('collections sharing a permission set collapse into one row', () => {
    const plan = KeyPlanReader.advanced([
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'pages', Claims.CollectionEntriesRead),
    ])!
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0].collections.sort()).toEqual(['pages', 'posts'])
  })

  test('every-collection and named-collection grants in one scope stay separate rows', () => {
    const claims = [
      Claims.collection('acme', 'prod', '*', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesDelete),
    ]
    const plan = KeyPlanReader.advanced(claims)!
    expect(plan.rows).toHaveLength(2)
    expect(plan.rows.some((row) => row.collections.length === 0)).toBe(true)
    expect(roundTrips(claims)).toEqual(Claims.normalize(claims))
  })

  test('round-trips several scopes at once', () => {
    const claims = [
      Claims.collection('acme', 'prod', '*', Claims.CollectionEntriesRead),
      Claims.collection('beta', 'dev', '*', Claims.CollectionEntriesUpdate),
      Claims.collection('*', 'staging', '*', Claims.CollectionSchemaRead),
    ]
    expect(roundTrips(claims)).toEqual(Claims.normalize(claims))
  })

  test('round-trips the instance capabilities', () => {
    const claims = [Claims.MediaCreate, Claims.KeysRead, Claims.AuditRead]
    expect(roundTrips(claims)).toEqual(Claims.normalize(claims))
  })

  test('reads the replace toggle back from the delete authority it implies', () => {
    const claims = KeyPlan.fromAdvanced({
      rows: [],
      fixed: [Claims.TransferImport],
      transferReplace: true,
    })
    const plan = KeyPlanReader.advanced(claims)!
    expect(plan.transferReplace).toBe(true)
    // …and does not surface what the toggle implied as a scope row nobody set.
    expect(plan.rows).toHaveLength(0)
  })

  test('refuses root, which is a preset and not a set of rows', () => {
    expect(KeyPlanReader.advanced(['*'])).toBeNull()
  })

  test('refuses a hook claim, which no key control produces', () => {
    expect(
      KeyPlanReader.advanced([Claims.hook('acme', 'prod', 'posts', 'entry.beforeWrite')]),
    ).toBeNull()
  })

  test('refuses a claim it cannot parse rather than dropping it', () => {
    expect(KeyPlanReader.advanced(['collections:read'])).toBeNull()
  })
})

describe('KeyClaimFit', () => {
  test('a preset-shaped list opens on Presets', () => {
    const claims = KeyPlan.fromPreset({ role: 'write', scopes: [scope('acme', 'prod')] })
    expect(KeyClaimFit.of(claims).mode).toBe('presets')
  })

  test('a list the controls can hold but no role names opens on Advanced', () => {
    const fit = KeyClaimFit.of([Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesRead)])
    expect(fit.mode).toBe('advanced')
    expect(fit.advanced).not.toBeNull()
  })

  test('a hook claim forces Custom and is named as the reason', () => {
    const hook = Claims.hook('acme', 'prod', 'posts', 'entry.afterWrite')
    const fit = KeyClaimFit.of([hook, Claims.MediaCreate])
    expect(fit.mode).toBe('custom')
    expect(fit.unrepresentable).toEqual([hook])
  })

  test('fits answers the same question the tab strip asks', () => {
    const claims = [Claims.hook('acme', 'prod', 'posts', 'entry.afterWrite')]
    expect(KeyClaimFit.fits(claims, 'custom')).toBe(true)
    expect(KeyClaimFit.fits(claims, 'advanced')).toBe(false)
    expect(KeyClaimFit.fits(claims, 'presets')).toBe(false)
  })

  test('an empty list fits every tab, so a new key opens where it likes', () => {
    expect(KeyClaimFit.fits([], 'custom')).toBe(true)
  })
})

describe('an advanced plan a person could build by hand', () => {
  test('survives being written out and read back', () => {
    const plan: AdvancedPlan = {
      rows: [
        {
          scope: scope('acme', 'prod'),
          collections: ['posts'],
          permissions: [Claims.CollectionEntriesRead, Claims.CollectionEntriesUpdate],
        },
        { scope: scope('acme', 'dev'), collections: [], permissions: [Claims.CollectionEntriesRead] },
        { scope: scope('*', 'staging'), collections: [], permissions: [Claims.CollectionSchemaRead] },
      ],
      fixed: [Claims.MediaCreate, Claims.AuditRead],
      transferReplace: false,
    }
    const claims = KeyPlan.fromAdvanced(plan)
    expect(Claims.normalize(KeyPlan.fromAdvanced(KeyPlanReader.advanced(claims)!))).toEqual(claims)
  })
})

describe('prefix patterns stay in the Custom tab (D64)', () => {
  const pattern = Claims.collection('acme*', 'prod', '*', Claims.CollectionEntriesRead)

  test('a pattern claim opens on Custom and is named as the reason', () => {
    const fit = KeyClaimFit.of([pattern])
    expect(fit.mode).toBe('custom')
    expect(fit.unrepresentable).toEqual([pattern])
  })

  test('neither guided tab will take one', () => {
    expect(KeyPlanReader.preset([pattern])).toBeNull()
    expect(KeyPlanReader.advanced([pattern])).toBeNull()
    expect(KeyClaimFit.fits([pattern], 'presets')).toBe(false)
    expect(KeyClaimFit.fits([pattern], 'advanced')).toBe(false)
    expect(KeyClaimFit.fits([pattern], 'custom')).toBe(true)
  })

  test('one pattern is enough to hold a whole list back', () => {
    const claims = [
      pattern,
      Claims.collection('beta', 'prod', 'posts', Claims.CollectionEntriesRead),
      Claims.MediaCreate,
    ]
    expect(KeyClaimFit.of(claims).mode).toBe('custom')
  })

  test('a pattern in any of the three segments counts', () => {
    for (const claim of [
      Claims.collection('acme*', 'prod', '*', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prev*', '*', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'cms_*', Claims.CollectionEntriesRead),
      Claims.hook('acme*', 'prod', 'posts', 'entry.afterWrite'),
    ]) {
      expect(KeyPlanReader.usesPattern(claim)).toBe(true)
    }
  })

  test('a bare wildcard is not a pattern, and the guided tabs still take it', () => {
    const wildcard = Claims.collection('*', 'prod', '*', Claims.CollectionEntriesRead)
    expect(KeyPlanReader.usesPattern(wildcard)).toBe(false)
    expect(KeyPlanReader.advanced([wildcard])).not.toBeNull()
  })
})

describe('ClaimPatterns', () => {
  test('collects each distinct pattern once, with where it was written', () => {
    const found = ClaimPatterns.of([
      Claims.collection('acme*', 'prod', '*', Claims.CollectionEntriesRead),
      Claims.collection('acme*', 'prod', '*', Claims.CollectionSchemaRead),
      Claims.collection('beta', 'prev*', 'cms_*', Claims.CollectionEntriesRead),
    ])

    expect(found).toEqual([
      { position: 'project', segment: 'acme*', prefix: 'acme' },
      { position: 'environment', segment: 'prev*', prefix: 'prev' },
      { position: 'collection', segment: 'cms_*', prefix: 'cms_' },
    ])
  })

  test('finds none in a list that uses only wildcards and names', () => {
    expect(
      ClaimPatterns.of([
        Claims.collection('*', 'prod', '*', Claims.CollectionEntriesRead),
        Claims.MediaCreate,
        Claims.Root,
      ]),
    ).toEqual([])
  })

  test('reports what a pattern reaches among the names that exist', () => {
    const [pattern] = ClaimPatterns.of([
      Claims.collection('acme*', 'prod', '*', Claims.CollectionEntriesRead),
    ])
    expect(ClaimPatterns.matching(pattern, ['beta', 'acme-web', 'acme', 'acmx'])).toEqual([
      'acme',
      'acme-web',
    ])
  })
})

describe('narrowing a scope to named collections', () => {
  test('a row mid-narrowing composes nothing rather than widening back out', () => {
    const claims = KeyPlan.fromAdvanced({
      rows: [
        {
          scope: scope('acme', 'prod'),
          collections: [],
          narrowed: true,
          permissions: [Claims.CollectionEntriesRead],
        },
      ],
      fixed: [],
      transferReplace: false,
    })
    expect(claims).toEqual([])
  })

  test('a row that is not narrowing still means every collection', () => {
    const claims = KeyPlan.fromAdvanced({
      rows: [
        {
          scope: scope('acme', 'prod'),
          collections: [],
          narrowed: false,
          permissions: [Claims.CollectionEntriesRead],
        },
      ],
      fixed: [],
      transferReplace: false,
    })
    expect(claims).toEqual([Claims.collection('acme', 'prod', '*', Claims.CollectionEntriesRead)])
  })

  test('reading a claim list back sets the flag per row', () => {
    const plan = KeyPlanReader.advanced([
      Claims.collection('acme', 'prod', '*', Claims.CollectionEntriesRead),
      Claims.collection('acme', 'prod', 'posts', Claims.CollectionEntriesDelete),
    ])!
    const everyCollection = plan.rows.find((row) => row.collections.length === 0)!
    const named = plan.rows.find((row) => row.collections.length > 0)!
    expect(everyCollection.narrowed).toBe(false)
    expect(named.narrowed).toBe(true)
  })
})
