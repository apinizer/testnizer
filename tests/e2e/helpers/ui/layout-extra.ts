/**
 * Layout helpers for the issue #251 / #252 / #257 specs: resize the REAL
 * BrowserWindow (Playwright's setViewportSize does not), emulate a bigger font,
 * and drive the right panel through its testids.
 *
 * Contract testids (see tests/renderer/right-panel-pref-257.test.tsx):
 *   right-panel            the open Variables/Code panel
 *   right-panel-rail       the collapsed icon rail
 *   right-panel-rail-variables / right-panel-rail-code   rail buttons
 *   right-panel-collapse   the open panel's collapse chevron
 *   workbench-main-row     the flex row holding editor + handle + panel
 *
 * The `ui` project shares ONE Electron instance: every helper that changes
 * state has a restore twin; specs call them from `finally`.
 */
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { fillCommandPalette, openCommandPalette } from './bootstrap'
import { restoreEnglishLocale } from './locale'

export interface ContentSize {
  width: number
  height: number
}

/** Resize the window's content area and wait until the renderer sees it. */
export async function setContentSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<ContentSize> {
  const original = await app.evaluate(
    ({ BrowserWindow }, s) => {
      const w = BrowserWindow.getAllWindows()[0]
      const [cw, ch] = w.getContentSize()
      w.setContentSize(s.width, s.height)
      return { width: cw, height: ch }
    },
    { width, height },
  )
  await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 5_000 }).toBe(width)
  return original
}

/** Same effect as ui.store `applyFontSize` without touching the persisted setting. */
export async function emulateFontSize(
  page: Page,
  px: number,
): Promise<{ base: string; root: string }> {
  return page.evaluate((size) => {
    const el = document.documentElement
    const prev = {
      base: el.style.getPropertyValue('--font-size-base'),
      root: el.style.fontSize,
    }
    el.style.setProperty('--font-size-base', `${size}px`)
    el.style.fontSize = `${size}px`
    return prev
  }, px)
}

export async function restoreFontSize(
  page: Page,
  prev: { base: string; root: string },
): Promise<void> {
  await page.evaluate((p) => {
    const el = document.documentElement
    if (p.base) el.style.setProperty('--font-size-base', p.base)
    else el.style.removeProperty('--font-size-base')
    el.style.fontSize = p.root
  }, prev)
}

/** Switch the UI to Turkish through the command palette (restore with `restoreEnglishLocale`). */
export async function switchToTurkish(page: Page): Promise<void> {
  await openCommandPalette(page)
  await fillCommandPalette(page, 'Türkçe')
  await page
    .getByTestId('command-palette')
    .getByRole('option', { name: /Change language: Türkçe|Dil: Türkçe/ })
    .first()
    .click()
  await expect(page.getByTestId('command-palette')).toBeHidden({ timeout: 5_000 })
}

export { restoreEnglishLocale }

/** The persisted right-panel preference (`ui.rightPanelCollapsed`), undefined if never saved. */
export async function persistedRightPanelCollapsed(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const w = window as unknown as Window & {
      api?: { settings?: { get: (k: string) => Promise<{ data?: unknown }> } }
    }
    return (await w.api?.settings?.get('ui.rightPanelCollapsed'))?.data
  })
}

/** Put the right panel in the given USER state through the UI (persists the preference). */
export async function setRightPanelOpen(page: Page, open: boolean): Promise<void> {
  const panel = page.getByTestId('right-panel')
  const rail = page.getByTestId('right-panel-rail')
  if (open) {
    if (await panel.isVisible().catch(() => false)) return
    await page.getByTestId('right-panel-rail-variables').click()
    await expect(panel).toBeVisible({ timeout: 5_000 })
  } else {
    if (await rail.isVisible().catch(() => false)) return
    await page.getByTestId('right-panel-collapse').click()
    await expect(rail).toBeVisible({ timeout: 5_000 })
  }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`no bounding box for ${testId}`)
  return box
}

/** True when two boxes overlap by more than `tolerance` px in both axes. */
export function overlaps(a: Box, b: Box, tolerance = 1): boolean {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return ox > tolerance && oy > tolerance
}
