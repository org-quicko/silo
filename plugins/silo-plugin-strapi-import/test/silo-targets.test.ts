import { describe, test, expect } from 'bun:test'
import { SiloTargets } from '../src/silo/silo-targets'
import { FakeSilo } from './support/fake-silo'

/**
 * Where an import could go.
 *
 * Read from silo on every plan rather than configured, which is the fix this
 * exists for: `[plugins.config]` used to name a target project and environment,
 * so a plan the operator retargeted in the panel still wrote into whatever
 * `silo.toml` said.
 */
describe('the scopes a plan could target', () => {
  const contextWith = (projects: unknown[], environments: Record<string, unknown[]>) => {
    const { ctx, calls } = FakeSilo.context((path) => {
      const project = decodeURIComponent(path.split('/')[3] ?? '')
      const found = environments[project]
      return found
        ? FakeSilo.answer(200, { items: found })
        : FakeSilo.answer(403, { error: { code: 'forbidden', message: 'no' } })
    })
    ctx.projects = { list: async () => ({ items: projects }) }
    return { ctx, calls }
  }

  test('every project the grant can see, each with its environments', async () => {
    const { ctx } = contextWith(['default', 'staging'], {
      default: ['prod', 'dev'],
      staging: ['preview'],
    })

    expect(await SiloTargets.list(ctx)).toEqual([
      { id: 'default', environments: ['prod', 'dev'] },
      { id: 'staging', environments: ['preview'] },
    ])
  })

  /** A grant may cover one project's environments and not another's. Dropping
   *  the project would tell the operator it does not exist. */
  test('a project whose environments cannot be read is still listed', async () => {
    const { ctx } = contextWith(['default', 'locked'], { default: ['prod'] })

    expect(await SiloTargets.list(ctx)).toEqual([
      { id: 'default', environments: ['prod'] },
      { id: 'locked', environments: [] },
    ])
  })

  test('the plan points at the first project and its first environment', () => {
    expect(
      SiloTargets.defaultOf([
        { id: 'default', environments: ['prod', 'dev'] },
        { id: 'staging', environments: ['preview'] },
      ]),
    ).toEqual({ project: 'default', env: 'prod' })
  })

  /**
   * Nothing visible means nothing proposed, and `ImportPlans.read` refuses by
   * naming the two selects. Guessing `default`/`prod` here is what the configured
   * target used to do, and it produced an import that went somewhere rather than
   * one that said it had nowhere to go.
   */
  test('nothing visible proposes no scope rather than a plausible one', () => {
    expect(SiloTargets.defaultOf([])).toEqual({ project: '', env: '' })
    expect(SiloTargets.defaultOf([{ id: 'default', environments: [] }])).toEqual({
      project: 'default',
      env: '',
    })
  })
})
