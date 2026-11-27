import { describe, expect, test } from 'bun:test'
import { RenameReport } from '@org-quicko/silo-client'
import { SchemaSaveGuard } from '../../schema/schema-save-guard'
import { RenameEligibility } from './rename-eligibility'

const samplePreview = RenameReport.fromWire({
  id: 'col_1',
  from: 'posts',
  to: 'articles',
  rewritten_claims: [],
  pattern_affected_claims: [],
})

describe('RenameEligibility', () => {
  test('discards dry-run preview when schema becomes dirty while preview is in flight', async () => {
    let allowed = true
    let resolveDryRun!: (report: RenameReport) => void

    const pendingPreview = RenameEligibility.fetchPreviewIfAllowed({
      isAllowed: () => allowed,
      dryRun: () =>
        new Promise<RenameReport>((resolve) => {
          resolveDryRun = resolve
        }),
    })

    // User edits the schema while the dry-run PATCH preview is still pending.
    allowed = false
    resolveDryRun(samplePreview)

    expect(await pendingPreview).toBeNull()
  })

  test('returns dry-run preview when still allowed upon settlement', async () => {
    const result = await RenameEligibility.fetchPreviewIfAllowed({
      isAllowed: () => true,
      dryRun: async () => samplePreview,
    })

    expect(result).toBe(samplePreview)
  })

  test('clears and hides an idle preview when allowed becomes false, while keeping an active commit visible', () => {
    expect(
      RenameEligibility.shouldDiscardOpenPreview({
        allowed: false,
        busy: false,
        hasPreview: true,
      }),
    ).toBe(true)

    expect(
      RenameEligibility.isDialogVisible({
        allowed: false,
        busy: false,
        hasPreview: true,
      }),
    ).toBe(false)

    // Once Confirm starts the commit (`busy: true`), SchemaEditor locks inputs
    // (`allowed: false`) while the busy confirmation modal remains mounted.
    expect(
      RenameEligibility.shouldDiscardOpenPreview({
        allowed: false,
        busy: true,
        hasPreview: true,
      }),
    ).toBe(false)

    expect(
      RenameEligibility.isDialogVisible({
        allowed: false,
        busy: true,
        hasPreview: true,
      }),
    ).toBe(true)
  })

  test('blocks confirm-time commit cleanly if schema becomes ineligible before execution', async () => {
    let dirty = false
    let commitsExecuted = 0

    // Becomes dirty right before Confirm clicks or runs.
    dirty = true
    const blockedByCanCommit = await RenameEligibility.commitIfEligible({
      pending: 'articles',
      isAllowed: () => true,
      canCommit: () => !dirty,
      execute: async () => {
        commitsExecuted += 1
      },
    })
    expect(blockedByCanCommit).toBe('ineligible')
    expect(commitsExecuted).toBe(0)

    const blockedByAllowed = await RenameEligibility.commitIfEligible({
      pending: 'articles',
      isAllowed: () => false,
      canCommit: () => true,
      execute: async () => {
        commitsExecuted += 1
      },
    })
    expect(blockedByAllowed).toBe('ineligible')
    expect(commitsExecuted).toBe(0)

    dirty = false
    const allowedCommit = await RenameEligibility.commitIfEligible({
      pending: 'articles',
      isAllowed: () => true,
      canCommit: () => !dirty,
      execute: async () => {
        commitsExecuted += 1
      },
    })
    expect(allowedCommit).toBe('committed')
    expect(commitsExecuted).toBe(1)
  })

  test('executes clean rename while SchemaSaveGuard.runCommit holds the lock, and cancels if dirty inside runCommit', async () => {
    const saveGuard = new SchemaSaveGuard()
    let dirty = false
    let saving = false
    const states: boolean[] = []
    let renamedCount = 0

    const canCommit = () => !dirty
    const preLockAllowed = () => !dirty && !saving && !saveGuard.isSaving() && !saveGuard.isDeleting()

    expect(
      RenameEligibility.canBeginCommit({
        pending: 'articles',
        allowed: preLockAllowed(),
        canCommit,
      }),
    ).toBe(true)

    const ran = await saveGuard.runCommit({
      onStateChange: (next) => {
        saving = next
        states.push(next)
      },
      run: async () => {
        // Inside runCommit, saveGuard.isSaving() and saving are true (`preLockAllowed()` is false),
        // yet `commitIfEligible` checks `canCommit` (`!dirty`) and completes the rename cleanly.
        expect(saveGuard.isSaving()).toBe(true)
        expect(preLockAllowed()).toBe(false)
        const outcome = await RenameEligibility.commitIfEligible({
          pending: 'articles',
          isAllowed: canCommit,
          execute: async () => {
            renamedCount += 1
          },
        })
        expect(outcome).toBe('committed')
      },
    })

    expect(ran).toBe(true)
    expect(renamedCount).toBe(1)
    expect(states).toEqual([true, false])

    // If a dirty edit slips in right as runCommit begins, commitIfEligible cancels cleanly.
    dirty = true
    await saveGuard.runCommit({
      onStateChange: (next) => {
        saving = next
      },
      run: async () => {
        const outcome = await RenameEligibility.commitIfEligible({
          pending: 'articles',
          isAllowed: canCommit,
          execute: async () => {
            renamedCount += 1
          },
        })
        expect(outcome).toBe('ineligible')
      },
    })
    expect(renamedCount).toBe(1)
    expect(saveGuard.isSaving()).toBe(false)
  })
})
