import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { fillCommandPalette, navigateSidebar, openCommandPalette } from './bootstrap'

/** The locale the store last persisted (`ui.store.setLocale` → `ui.locale`). */
export async function persistedLocale(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const w = window as unknown as Window & {
      api?: { settings?: { get: (k: string) => Promise<{ data?: unknown }> } }
    }
    return (await w.api?.settings?.get('ui.locale'))?.data
  })
}

/**
 * Put the shared ui-project window back on English, with no overlay open and
 * the APIs page showing.
 *
 * The ui project runs one Electron instance per worker with no global cleanup,
 * so a spec that switches to Turkish and stops halfway leaves every later spec
 * in that worker on TR — and helpers like `getByPlaceholder('Environment name')`
 * (env.ts) match English. Call this from a `finally` in any spec that changes
 * the language.
 *
 * Fast and deterministic on purpose (issue #248 follow-up): no fixed waits, the
 * palette is opened only when it is not already open, and the switch is skipped
 * entirely when the persisted locale is already English (never set = English).
 * Goes through the command palette (store `setLocale('en')`) rather than the
 * settings modal, so it works whatever state the settings form was left in.
 */
export async function restoreEnglishLocale(page: Page): Promise<void> {
  const palette = page.getByTestId('command-palette')
  const current = await persistedLocale(page)
  if (current !== undefined && current !== null && current !== 'en') {
    if (!(await palette.isVisible())) await openCommandPalette(page)
    await fillCommandPalette(page, 'English')
    // Both locales' labels contain "English" ("Change language: English" / "Dil: English").
    await palette
      .getByRole('option', { name: /Change language: English|Dil: English/ })
      .first()
      .click()
    await expect.poll(() => persistedLocale(page), { timeout: 5_000 }).toBe('en')
  }

  // Close whatever is still open (palette, settings modal, dropdown) — one
  // Escape per visible layer, bounded, instead of a blind sleep loop.
  const overlays = page.locator('[role="dialog"]:visible, [data-testid="command-palette"]:visible')
  for (let i = 0; i < 4 && (await overlays.count()) > 0; i++) {
    await page.keyboard.press('Escape')
  }
  await expect(overlays).toHaveCount(0, { timeout: 3_000 })

  // Leave the next spec on the APIs page, where most of them start.
  await navigateSidebar(page, 'apis')
  await expect(page.getByTestId('new-dropdown-btn')).toBeVisible({ timeout: 5_000 })
}
