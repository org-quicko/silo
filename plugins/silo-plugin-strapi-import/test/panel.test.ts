import { describe, expect, test } from 'bun:test'
import fs from 'fs/promises'
import path from 'path'

describe('the strapi import panel', () => {
  const readPanel = async () => {
    return await fs.readFile(
      path.resolve(import.meta.dir, '../src/panel/panel.html'),
      'utf8',
    )
  }

  test('is a self-contained inlined document with no external dependencies', async () => {
    const html = await readPanel()
    expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024)
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/i)
  })

  test('provides select all and deselect all controls for the plan', async () => {
    const html = await readPanel()
    expect(html).toContain('id="plan-master-check"')
    expect(html).toContain('id="plan-select-all"')
    expect(html).toContain('id="plan-deselect-all"')
    expect(html).toContain('id="plan-selected-count"')
    expect(html).toContain("master.indeterminate = included > 0 && included < totalSteps")
    expect(html).toContain("for (const step of state.plan.steps) step.include = true")
    expect(html).toContain("for (const step of state.plan.steps) step.include = false")
  })

  test('provides batch edit mode with prefix, replace, mode, and reset controls', async () => {
    const html = await readPanel()
    // Batch edit toggle and panel
    expect(html).toContain('id="plan-batch-toggle"')
    expect(html).toContain('id="plan-batch-box"')
    expect(html).toContain('id="batch-close"')
    expect(html).toContain('id="batch-scope-selected"')
    expect(html).toContain('id="batch-scope-all"')

    // Mode batch edit
    expect(html).toContain('id="batch-mode-select"')
    expect(html).toContain('id="batch-mode-apply"')

    // Prefix add and remove
    expect(html).toContain('id="batch-prefix-input"')
    expect(html).toContain('id="batch-prefix-add"')
    expect(html).toContain('id="batch-prefix-remove"')

    // Find and replace
    expect(html).toContain('id="batch-find-input"')
    expect(html).toContain('id="batch-replace-input"')
    expect(html).toContain('id="batch-replace-apply"')

    // Reset names and flatten batch actions
    expect(html).toContain('id="batch-reset-names"')
    expect(html).toContain('id="batch-flatten-enable"')
    expect(html).toContain('id="batch-flatten-disable"')
    expect(html).toContain('id="batch-feedback"')
  })

  test('styles selected rows and batch panel elements', async () => {
    const html = await readPanel()
    expect(html).toContain('.batch-panel')
    expect(html).toContain('.btn-toggle.active')
    expect(html).toContain('tr.selected td')
  })
})
