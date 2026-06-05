import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const E2E_PROJECT_NAME = 'E2E Test Project'

/** Wait until preload IPC bridge is ready. */
export async function waitForApiBridge(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as Window & { api?: unknown }).api?.eula, {
    timeout: 30_000,
  })
}

/** Accept EULA gate via UI (checkbox + Accept). */
export async function acceptEula(page: Page): Promise<void> {
  const gate = page.getByTestId('eula-gate')
  const visible = await gate.isVisible().catch(() => false)
  if (!visible) return

  await page.getByTestId('eula-accept-checkbox').check()
  await page.getByTestId('eula-accept-btn').click()
  await expect(gate).toBeHidden({ timeout: 15_000 })
}

/** First-launch welcome screen — continue without password. */
export async function loginAsGuest(page: Page): Promise<void> {
  const guestBtn = page.getByTestId('login-continue-anonymous')
  const quickTest = page.getByRole('button', { name: /Quick Test/i })

  if (await guestBtn.isVisible().catch(() => false)) {
    await guestBtn.click()
  } else if (await quickTest.isVisible().catch(() => false)) {
    await quickTest.click()
  }

  await page.waitForFunction(
    () => {
      const body = document.body.innerText
      return (
        body.includes('New Project') ||
        body.includes('Create New Project') ||
        body.includes('APIs') ||
        body.includes('Send')
      )
    },
    { timeout: 20_000 },
  )
}

/** Create and open a local HTTP project from Project Home. */
export async function createAndOpenProject(
  page: Page,
  name = E2E_PROJECT_NAME,
): Promise<void> {
  const existing = page.getByTestId('project-card').filter({ hasText: name })
  if (await existing.first().isVisible().catch(() => false)) {
    await existing.first().click()
    await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
    return
  }

  await page.getByTestId('home-new-project').click()
  await expect(page.getByTestId('new-project-modal')).toBeVisible()

  // Step 1 — source defaults to "Create New"
  await page.getByTestId('new-project-next').click()

  // Step 2 — names required
  await page.getByTestId('new-project-display-name').fill(name)
  await page.getByTestId('new-project-name').fill(name.replace(/\s+/g, '-').toLowerCase())
  await page.getByTestId('new-project-next').click()

  // Step 3 — create
  await page.getByTestId('new-project-create').click()
  await expect(page.getByTestId('new-project-modal')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
}

/** Full cold-start bootstrap: EULA → guest → project workbench. */
export async function bootstrapWorkbench(page: Page): Promise<void> {
  await waitForApiBridge(page)
  await acceptEula(page)
  await loginAsGuest(page)
  await createAndOpenProject(page)
}

/** Dismiss stacked modals / palette. */
export async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

/** Open command palette (Cmd/Ctrl+K). */
export async function openCommandPalette(page: Page): Promise<void> {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+KeyK`)
  await page.waitForTimeout(200)
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 })
}

/** Command palette search input — scoped to avoid matching tree-search. */
export function commandPaletteInput(page: Page) {
  return page.getByTestId('command-palette').locator('[cmdk-input]')
}

export async function fillCommandPalette(page: Page, query: string): Promise<void> {
  await commandPaletteInput(page).fill(query)
}

/** Navigate icon sidebar page. */
export async function navigateSidebar(
  page: Page,
  pageId: 'apis' | 'tests' | 'mocks' | 'history' | 'tools' | 'settings',
): Promise<void> {
  await page.getByTestId(`nav-${pageId}`).click()
}

/** Open a new HTTP request tab from the (+) dropdown. */
export async function openHttpRequestTab(page: Page): Promise<void> {
  await page.getByTestId('new-dropdown-btn').click()
  await expect(page.getByTestId('new-dropdown-menu')).toBeVisible()
  await page.getByTestId('new-dropdown-menu').getByRole('button', { name: /^HTTP$/i }).click()
}

/** Open New (+) dropdown and pick an item by visible label. */
export async function openNewDropdownItem(page: Page, label: RegExp | string): Promise<void> {
  await page.getByTestId('new-dropdown-btn').click()
  const menu = page.getByTestId('new-dropdown-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: label }).click()
}
