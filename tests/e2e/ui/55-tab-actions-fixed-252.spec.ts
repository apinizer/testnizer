/**
 * Issue #252 — with many tabs open the environment selector and the new-tab
 * "+" scrolled away with the strip (x≈5800 with 63 tabs; off screen on the
 * Mocks and MCP pages after ~11 tabs at 1400 px).
 *
 * Fix under test: the strip is ONE component for every sidebar page; the "+"
 * and the environment selector now live in a fixed `tab-actions` group on the
 * right, OUTSIDE the scrolling `tab-strip`.
 *
 * Contract testids: tab-bar > tab-strip (scroller) + tab-actions > tab-new +
 * env-selector; tab-strip-drop-end inside the scroller
 * (tests/renderer/tab-strip-fixed-actions-252.test.tsx).
 *
 * The `ui` project shares ONE Electron instance: tabs are force-closed and the
 * window size restored in `finally`.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { boxOf, setContentSize } from '../helpers/ui/layout-extra'

const TAB_COUNT = 30

async function openManyTabs(page: Page, n: number): Promise<void> {
  const tabs = page.getByTestId('endpoint-tab')
  const before = await tabs.count()
  for (let i = 0; i < n; i++) await openHttpRequestTab(page)
  await expect(tabs).toHaveCount(before + n, { timeout: 20_000 })
}

/** The "+" and the environment selector are on screen, right of every visible tab. */
async function expectActionsPinned(page: Page, windowWidth: number): Promise<void> {
  const strip = await boxOf(page, 'tab-strip')
  const plus = await boxOf(page, 'tab-new')
  const env = await boxOf(page, 'env-selector')
  const actions = await boxOf(page, 'tab-actions')
  for (const [name, box] of [
    ['tab-new', plus],
    ['env-selector', env],
  ] as const) {
    expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(windowWidth + 1)
    expect(box.x, `${name} sits right of the scroller`).toBeGreaterThanOrEqual(
      strip.x + strip.width - 1,
    )
  }
  expect(actions.x + actions.width).toBeLessThanOrEqual(windowWidth + 1)
  await expect(page.getByTestId('tab-new')).toBeInViewport()
  await expect(page.getByTestId('env-selector')).toBeInViewport()
  const structure = await page.getByTestId('tab-strip').evaluate((el) => ({
    containsPlus: !!el.querySelector('[data-testid="tab-new"]'),
    containsEnv: !!el.querySelector('[data-testid="env-selector"]'),
  }))
  expect(structure.containsPlus).toBe(false)
  expect(structure.containsEnv).toBe(false)
}

uiTest.describe('Issue #252 — pinned tab actions', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest(
    'APIs: with many tabs the "+" and the environment selector stay on screen',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1100, 800)
      try {
        await openManyTabs(window, TAB_COUNT)
        const overflowing = await window
          .getByTestId('tab-strip')
          .evaluate((el) => el.scrollWidth > el.clientWidth)
        expect(overflowing, 'the strip must overflow for this test to mean anything').toBe(true)
        await expectActionsPinned(window, 1100)

        // The selector works from there.
        const pill = window.getByTestId('env-selector').getByRole('button').first()
        await pill.click()
        // The dropdown is portalled to <body>; its "No environment" row is the last such button.
        await expect(window.getByRole('button', { name: /No environment/i }).last()).toBeVisible()
        await pill.click() // toggle closed — no environment change left behind
      } finally {
        await setContentSize(app, window, original.width, original.height)
        await closeAllTabs(window)
      }
    },
  )

  uiTest(
    '"+" opens a tab from its pinned place and the new tab is scrolled into view',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1100, 800)
      try {
        await openManyTabs(window, TAB_COUNT)
        const tabs = window.getByTestId('endpoint-tab')
        const before = await tabs.count()
        await window.getByTestId('tab-new').click()
        await expect(tabs).toHaveCount(before + 1, { timeout: 5_000 })
        const strip = await boxOf(window, 'tab-strip')
        const active = (await window
          .locator('[data-testid="endpoint-tab"][data-active="true"]')
          .boundingBox())!
        expect(active.x).toBeGreaterThanOrEqual(strip.x - 1)
        expect(active.x + active.width).toBeLessThanOrEqual(strip.x + strip.width + 1)
        await expectActionsPinned(window, 1100)
      } finally {
        await setContentSize(app, window, original.width, original.height)
        await closeAllTabs(window)
      }
    },
  )

  uiTest(
    'Mocks and Tests pages share the strip: the actions are on screen there too',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1400, 800)
      try {
        await openManyTabs(window, 15)
        for (const page of ['mocks', 'tests', 'apis'] as const) {
          await navigateSidebar(window, page)
          await expectActionsPinned(window, 1400)
        }
      } finally {
        await navigateSidebar(window, 'apis')
        await setContentSize(app, window, original.width, original.height)
        await closeAllTabs(window)
      }
    },
  )

  uiTest('at the minimum window width (900) the actions still fit', async ({ app, window }) => {
    const original = await setContentSize(app, window, 900, 700)
    try {
      await openManyTabs(window, 12)
      await expectActionsPinned(window, 900)
    } finally {
      await setContentSize(app, window, original.width, original.height)
      await closeAllTabs(window)
    }
  })

  uiTest(
    'wheel over the strip scrolls the tabs, never the pinned actions',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1100, 800)
      try {
        await openManyTabs(window, TAB_COUNT)
        const strip = window.getByTestId('tab-strip')
        await strip.hover()
        await window.mouse.wheel(-5000, 0)
        await expect.poll(() => strip.evaluate((el) => el.scrollLeft), { timeout: 5_000 }).toBe(0)
        const before = await boxOf(window, 'tab-new')
        await window.mouse.wheel(3000, 0)
        await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
        const after = await boxOf(window, 'tab-new')
        expect(after.x).toBeCloseTo(before.x, 0)
      } finally {
        await setContentSize(app, window, original.width, original.height)
        await closeAllTabs(window)
      }
    },
  )
})
