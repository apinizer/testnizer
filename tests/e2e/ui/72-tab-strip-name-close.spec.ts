/**
 * Tester findings 2 + 3 on the request tab strip (`Workbench.tsx` `EndpointTabBar`).
 *
 * 2 — renaming a request to a 100+ character name made its tab as wide as the
 *     name and pushed the other tabs off the strip. The label is now capped and
 *     ends in "…"; the full name is the tooltip and stays in `data-tab-name`.
 * 3 — the × was hover-only and keyboard-unreachable. It is now a named button,
 *     always shown on the active clean tab, reachable with Tab, closing on
 *     Enter; a dirty tab still asks first. Tabs are a tablist (arrows + Enter).
 *
 * jsdom cannot measure, so the pixel proof (scrollWidth > clientWidth, bounded
 * tab width, computed opacity) lives here; the renderer test pins the rest
 * (`tests/renderer/tab-strip-name-close.test.tsx`).
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const SCREENS = 'test-results/screens'

const activeTab = (page: Page): Locator =>
  page.locator('[data-testid="endpoint-tab"][data-active="true"]')
const tabNamed = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="endpoint-tab"][data-tab-name="${name}"]`)

/** Park the pointer over the URL bar so no tab is hovered. */
async function pointerAway(page: Page): Promise<void> {
  const box = await page.getByTestId('url-input').boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

async function savedRequest(page: Page, name: string, path: string): Promise<void> {
  await openHttpRequestTab(page)
  await fillUrl(page, `${localHttpBin()}${path}`)
  await saveRequestToTree(page, name)
  await expect(activeTab(page)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })
}

uiTest.describe('72 — tab strip: long names are cut off, × is a keyboard button', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('a 100+ character name is truncated with the full name as tooltip', async ({ window }) => {
    const id = uid()
    const longName = `Get every customer account with the full transaction history for the last fiscal year grouped by branch ${id}`
    expect(longName.length).toBeGreaterThan(100)

    // Renamed through the tab itself (double-click the label), as the tester did.
    await savedRequest(window, `Long ${id}`, '/get?n=long')
    await activeTab(window).getByTestId('tab-name').dblclick()
    const rename = activeTab(window).locator('input')
    await expect(rename).toBeVisible()
    await rename.fill(longName)
    await rename.press('Enter')
    await expect(activeTab(window)).toHaveAttribute('data-tab-name', longName, { timeout: 8_000 })

    await savedRequest(window, `Users ${id}`, '/get?n=users')
    await savedRequest(window, `Orders ${id}`, '/get?n=orders')
    await openHttpRequestTab(window)
    await pointerAway(window)

    const long = tabNamed(window, longName)
    const label = long.getByTestId('tab-name')
    await expect(label).toHaveAttribute('title', longName)
    // The text is cut by CSS only — the DOM still holds the whole name.
    await expect(label).toHaveText(longName)
    const overflow = await label.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      textOverflow: getComputedStyle(el).textOverflow,
    }))
    expect(overflow.scroll).toBeGreaterThan(overflow.client)
    expect(overflow.textOverflow).toBe('ellipsis')
    const tabBox = await long.boundingBox()
    expect(tabBox?.width ?? Infinity).toBeLessThan(300)

    // The other three tabs are still on the strip next to it.
    for (const other of [`Users ${id}`, `Orders ${id}`]) {
      await expect(tabNamed(window, other)).toBeInViewport()
    }
    await window.screenshot({ path: `${SCREENS}/72-long-name.png` })

    await long.hover()
    await window.screenshot({ path: `${SCREENS}/72-long-name-hover.png` })
  })

  uiTest(
    'the active clean tab always shows its ×; other tabs show it on hover',
    async ({ window }) => {
      const id = uid()
      await savedRequest(window, `Alpha ${id}`, '/get?n=a')
      await savedRequest(window, `Beta ${id}`, '/get?n=b')
      await savedRequest(window, `Gamma ${id}`, '/get?n=c')
      await pointerAway(window)

      const activeClose = activeTab(window).getByTestId('tab-close')
      await expect(activeClose).toHaveCSS('opacity', '1')
      await expect(activeClose).toHaveAttribute('aria-label', `Close tab Gamma ${id}`)
      const otherClose = tabNamed(window, `Alpha ${id}`).getByTestId('tab-close')
      await expect(otherClose).toHaveCSS('opacity', '0')
      await window.screenshot({ path: `${SCREENS}/72-active-close.png` })

      await tabNamed(window, `Alpha ${id}`).hover()
      await expect(otherClose).toHaveCSS('opacity', '1')
      await window.screenshot({ path: `${SCREENS}/72-hover-close.png` })

      // Closing a background tab does not activate it.
      await otherClose.click()
      await expect(tabNamed(window, `Alpha ${id}`)).toHaveCount(0)
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `Gamma ${id}`)
    },
  )

  uiTest(
    'keyboard: Tab reaches the ×, Enter closes; arrows + Enter switch tabs',
    async ({ window }) => {
      const id = uid()
      await savedRequest(window, `One ${id}`, '/get?n=1')
      await savedRequest(window, `Two ${id}`, '/get?n=2')

      // The active tab is the strip's one tab stop; arrows move, Enter activates.
      await activeTab(window).focus()
      await window.keyboard.press('ArrowLeft')
      await expect(tabNamed(window, `One ${id}`)).toBeFocused()
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `Two ${id}`)
      await window.keyboard.press('Enter')
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `One ${id}`)

      // Tab moves from the tab to its × (focus ring visible), Enter closes it.
      await activeTab(window).focus()
      await window.keyboard.press('Tab')
      const close = activeTab(window).getByTestId('tab-close')
      await expect(close).toBeFocused()
      const outline = await close.evaluate((el) => getComputedStyle(el).outlineStyle)
      expect(outline).toBe('solid')
      await window.screenshot({ path: `${SCREENS}/72-keyboard-focus.png` })
      await window.keyboard.press('Enter')
      await expect(tabNamed(window, `One ${id}`)).toHaveCount(0)
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `Two ${id}`)
    },
  )

  uiTest('a dirty tab shows its dot, and its × still asks before closing', async ({ window }) => {
    const id = uid()
    const name = `Dirty ${id}`
    await savedRequest(window, name, '/get?n=d')
    await fillUrl(window, `${localHttpBin()}/get?n=d&edited=1`)
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true', { timeout: 8_000 })
    await pointerAway(window)

    await expect(activeTab(window).getByTestId('tab-dirty')).toHaveCSS('opacity', '1')
    await window.screenshot({ path: `${SCREENS}/72-dirty-dot.png` })

    await activeTab(window).focus()
    await window.keyboard.press('Tab')
    await expect(activeTab(window).getByTestId('tab-close')).toBeFocused()
    await expect(activeTab(window).getByTestId('tab-close')).toHaveCSS('opacity', '1')
    await window.screenshot({ path: `${SCREENS}/72-dirty-focus-close.png` })
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('unsaved-cancel-btn')).toBeVisible({ timeout: 8_000 })
    await window.getByTestId('unsaved-cancel-btn').click()
    await expect(tabNamed(window, name)).toHaveCount(1)
  })
})
