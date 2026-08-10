/**
 * How many code editors does the app actually keep alive? (issue #77)
 *
 * The Workbench mounts EVERY open tool tab and toggles `display`, so a tool's
 * typed input survives switching away and back. The cost was that each mounted
 * tool ALSO kept its Monaco editors alive — models, workers and DOM for panes
 * nobody is looking at.
 *
 * The unit test pins the behaviour. This one MEASURES it in the real app and
 * prints the numbers, so a regression run shows the shape rather than just
 * pass/fail. Both states were measured by building the app with the visibility
 * gate reverted and then restored:
 *
 *     tabs open   before fix        after fix
 *       1         2 live            2 live,  0 skeletons
 *       2         4 live            2 live,  2 skeletons
 *       3         5 live            1 live,  4 skeletons
 *
 * Before, every open tool kept its own editors, so the count accumulated. After,
 * only the visible tool holds live editors and the rest are the same lazy-load
 * skeleton the app already used. (It also puts a number on "roughly two editors
 * per tool": it averages ~1.7 here, not exactly 2.)
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  fillCommandPalette,
  navigateSidebar,
  openCommandPalette,
} from '../helpers/ui/bootstrap'

/** Tools that each render one or two Monaco panes. */
const TOOLS = ['JSON Formatter', 'XML Formatter', 'JSONPath Evaluator']

/**
 * `.monaco-editor` counts real instances — it is corroborated by
 * `.overflow-guard`, which Monaco creates exactly once per editor (both read
 * identically during development of this test). `textarea.inputarea` is NOT
 * usable: Monaco does not render it until the editor has been focused.
 */
async function counts(window: Page) {
  return window.evaluate(() => ({
    live: document.querySelectorAll('.monaco-editor').length,
    guards: document.querySelectorAll('.monaco-editor .overflow-guard').length,
    skeletons: document.querySelectorAll('[aria-label="Loading editor"]').length,
  }))
}

async function openTool(window: Page, tool: string) {
  await navigateSidebar(window, 'apis')
  await openCommandPalette(window)
  await fillCommandPalette(window, tool.split(/[\s/↔]/)[0])
  await window
    .getByRole('option', { name: new RegExp(tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .click()
  await expect(window.getByTestId('workbench')).toBeVisible()
  await window.keyboard.press('Escape')
  // Monaco is lazy-loaded and mounts asynchronously; settle before counting.
  await window.waitForTimeout(500)
}

uiTest.describe('editor instances do not accumulate (issue #77)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await closeAllTabs(window)
  })

  // The `ui` project shares ONE Electron instance with no global teardown, so a
  // spec that ends with tabs open hands them to the next file. Closing only in
  // `beforeEach` protects this spec's own tests and nobody else's.
  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('live editors stay flat while hidden tabs pile up', async ({ window }) => {
    const measured: { tabs: number; tool: string; live: number; skeletons: number }[] = []

    for (const [i, tool] of TOOLS.entries()) {
      await openTool(window, tool)
      const c = await counts(window)
      measured.push({ tabs: i + 1, tool, live: c.live, skeletons: c.skeletons })
      // Sanity: the two independent DOM markers must agree, or the count means
      // nothing and neither does this test.
      expect(c.guards).toBe(c.live)
    }

    console.log('[#77] live Monaco editors per open tool tab:', JSON.stringify(measured))

    const last = measured[measured.length - 1]
    const totalPanes = last.live + last.skeletons

    // The measurement that IS the fix: with three tools open, the app holds
    // fewer live editors than it has editor panes — the hidden ones are
    // skeletons. Before the fix these two numbers were equal.
    expect(last.skeletons).toBeGreaterThan(0)
    expect(last.live).toBeLessThan(totalPanes)

    // And live does not grow with the number of tabs: the busiest single tool
    // here needs two panes, so three open tools must not reach four live.
    expect(Math.max(...measured.map((m) => m.live))).toBeLessThanOrEqual(2)
  })

  uiTest('a hidden tool keeps the text you typed', async ({ window }) => {
    // The editors are dropped; the tool's own state is not. This is what the
    // keep-everything-mounted design buys, and what #77's fix must not cost.
    await openTool(window, 'Base Converter')
    const decimal = window.getByRole('textbox').first()
    await decimal.fill('12345')

    await openTool(window, 'UUID Generator')
    await window.getByTestId('endpoint-tab').filter({ hasText: /Base Converter/i }).click()

    await expect(window.getByRole('textbox').first()).toHaveValue('12345')
  })
})
