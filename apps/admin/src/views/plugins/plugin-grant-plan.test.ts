import { describe, expect, test } from 'bun:test'
import { Claims } from '@silo/shared/claims'
import type { PluginView } from '../../api/types/plugin-view'
import { PluginGrantPlan } from './plugin-grant-plan'

const plugin = (patch: Partial<PluginView> = {}): PluginView => ({
  name: 'acme',
  state: 'pending',
  enabled: true,
  requested: [],
  granted: [],
  config_claims: [],
  effective: [],
  not_granted: [],
  hooks: [],
  key_id: null,
  granted_by: null,
  granted_at: null,
  rev: 1,
  runtime: { state: 'running', hooks: [], detail: null },
  config: {},
  config_source: 'silo.toml',
  kind: 'extension',
  config_schema: null,
  routes: [],
  ...patch,
})

describe('PluginGrantPlan.forbidden', () => {
  test.each([...Claims.PluginForbiddenClaims, '*'])('%s can never be granted', (claim) => {
    expect(PluginGrantPlan.forbidden(claim)).not.toBe('')
  })

  /** Deliberately grantable: they disclose the authority map, and disclosure is
   *  a decision an operator is allowed to weigh (D37). */
  test.each(['keys:read', 'keys:export', 'media:read'])('%s is offerable', (claim) => {
    expect(PluginGrantPlan.forbidden(claim)).toBe('')
  })
})

describe('PluginGrantPlan.narrow', () => {
  test('a wildcard segment takes the chosen scope', () => {
    expect(
      PluginGrantPlan.narrow('collections:*/*/posts:entries:read', { project: 'blog', env: 'prod' }),
    ).toBe('collections:blog/prod/posts:entries:read')
  })

  test('a hook claim narrows the same way', () => {
    expect(
      PluginGrantPlan.narrow('hooks:*/*/*:entry.afterWrite', { project: 'blog', env: 'prod' }),
    ).toBe('hooks:blog/prod/*:entry.afterWrite')
  })

  /** Rewriting a segment the manifest named is not narrowing — it points the
   *  plugin somewhere it never asked to go, and the server refuses it. */
  test('a segment the plugin named is left exactly as it asked', () => {
    expect(
      PluginGrantPlan.narrow('collections:blog/dev/posts:entries:read', {
        project: 'other',
        env: 'prod',
      }),
    ).toBe('collections:blog/dev/posts:entries:read')
  })

  test('an empty scope leaves the wildcard alone', () => {
    expect(PluginGrantPlan.narrow('collections:*/*/*:entries:read', { project: '', env: '' })).toBe(
      'collections:*/*/*:entries:read',
    )
  })

  test('a fixed claim has no scope to narrow', () => {
    expect(PluginGrantPlan.narrow('media:read', { project: 'blog', env: 'prod' })).toBe('media:read')
  })
})

describe('PluginGrantPlan.claims', () => {
  test('what a narrowed selection would send is what the server would store', () => {
    expect(
      PluginGrantPlan.claims(['collections:*/*/posts:entries:read', 'media:read'], {
        project: 'blog',
        env: 'prod',
      }),
    ).toEqual(Claims.normalize(['collections:blog/prod/posts:entries:read', 'media:read']))
  })

  test('nothing chosen is an empty grant, which is a legal thing to send', () => {
    expect(PluginGrantPlan.claims([], { project: '', env: '' })).toEqual([])
  })
})

describe('PluginGrantPlan.rows', () => {
  const requested = [
    'collections:*/*/*:entries:read',
    'hooks:*/*/*:entry.beforeValidate',
    'hooks:*/*/*:entry.afterWrite',
  ]

  test('a hook that can change or stop a write is marked as one', () => {
    const rows = PluginGrantPlan.rows(plugin({ requested }), ['*'])
    expect(rows.map((row) => row.intervening)).toEqual([false, true, false])
  })

  /**
   * The half a record cannot see. A plugin granted through `silo.toml` holds
   * those claims and the record's `granted` is empty, so a form reading only
   * the record would offer to approve what is already running (D40).
   */
  test('a claim held through silo.toml reads as held', () => {
    const rows = PluginGrantPlan.rows(
      plugin({ requested, granted: [], effective: ['collections:*/*/*:entries:read'] }),
      ['*'],
    )
    expect(rows[0].held).toBe('granted')
    expect(rows[1].held).toBe('none')
  })

  /**
   * Narrowing is the normal answer to a wildcard request, and reading it as
   * "not granted" made the form say the plugin could do nothing immediately
   * after a successful approval — seen on a running instance, right after
   * granting `mirror` at `default/prod`.
   */
  test('a narrower held claim answers a wider request, and says what it narrowed to', () => {
    const rows = PluginGrantPlan.rows(
      plugin({ requested, effective: ['collections:blog/prod/posts:entries:read'] }),
      ['*'],
    )
    expect(rows[0].held).toBe('narrowed')
    expect(rows[0].actual).toEqual(['collections:blog/prod/posts:entries:read'])
    expect(rows[1].held).toBe('none')
  })

  test('a request held in full is not also reported as narrowed', () => {
    const rows = PluginGrantPlan.rows(
      plugin({ requested, effective: ['collections:*/*/*:entries:read'] }),
      ['*'],
    )
    expect(rows[0].held).toBe('granted')
    expect(rows[0].actual).toEqual([])
  })

  /** An affordance the route will refuse is worse than no affordance, so the
   *  form asks the same question `RouteAuth` will. */
  test('a claim beyond the current key is not delegable', () => {
    const rows = PluginGrantPlan.rows(plugin({ requested }), ['media:read'])
    expect(rows.every((row) => row.delegable)).toBe(false)
  })

  test('every requested claim gets a row, including one nothing has words for', () => {
    const rows = PluginGrantPlan.rows(plugin({ requested: ['not-a-real:claim'] }), ['*'])
    expect(rows).toHaveLength(1)
    expect(rows[0].phrase).toBeNull()
  })
})

describe('PluginGrantPlan.heldRequested', () => {
  test('opens the form on exactly what the plugin already holds', () => {
    const view = plugin({
      requested: ['media:read', 'keys:read'],
      effective: ['media:read'],
    })
    expect(PluginGrantPlan.heldRequested(view)).toEqual(['media:read'])
  })

  test('a narrowed request is still ticked, so saving again does not withdraw it', () => {
    const view = plugin({
      requested: ['collections:*/*/*:entries:read'],
      effective: ['collections:blog/prod/posts:entries:read'],
    })
    expect(PluginGrantPlan.heldRequested(view)).toEqual(['collections:*/*/*:entries:read'])
    expect(PluginGrantPlan.answered(view)).toBe(1)
  })
})

/**
 * Read back off what is granted, so a form that opens on a narrowed grant does
 * not offer to widen it by simply being saved again.
 */
describe('PluginGrantPlan.initialScope', () => {
  test('one project and environment across every scoped claim is the scope', () => {
    expect(
      PluginGrantPlan.initialScope(
        plugin({
          effective: [
            'collections:blog/prod/*:entries:read',
            'hooks:blog/prod/*:entry.afterWrite',
          ],
        }),
      ),
    ).toEqual({ project: 'blog', env: 'prod' })
  })

  test('claims spanning two projects narrow to neither', () => {
    expect(
      PluginGrantPlan.initialScope(
        plugin({
          effective: [
            'collections:blog/prod/*:entries:read',
            'collections:shop/prod/*:entries:read',
          ],
        }),
      ),
    ).toEqual({ project: '', env: '' })
  })

  test('a wildcard scope is not a narrowing', () => {
    expect(
      PluginGrantPlan.initialScope(plugin({ effective: ['collections:*/*/*:entries:read'] })),
    ).toEqual({ project: '', env: '' })
  })

  test('nothing granted opens at what the plugin asked for', () => {
    expect(PluginGrantPlan.initialScope(plugin())).toEqual({ project: '', env: '' })
  })

  /** The environment selector is meaningless without a project, so a grant
   *  this form cannot express is not offered back as if it could. */
  test('an environment named under every project is not offered', () => {
    expect(
      PluginGrantPlan.initialScope(plugin({ effective: ['collections:*/prod/*:entries:read'] })),
    ).toEqual({ project: '', env: '' })
  })
})
