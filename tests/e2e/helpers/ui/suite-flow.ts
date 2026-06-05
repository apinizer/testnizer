import { expect, type Page } from '@playwright/test'
import { dismissOverlays } from './bootstrap'
import {
  startRunnerTabRun,
  waitRunnerTabComplete,
  readRunnerTabSummary,
  waitRunnerConfigReady,
} from './runner-flow'

async function clickSuiteMenuItem(page: Page, label: RegExp | string): Promise<void> {
  await page.locator('div.fixed').last().getByRole('button', { name: label }).click()
}

export async function navigateToTestsPanel(page: Page): Promise<void> {
  await page.getByTestId('nav-tests').click()
}

export async function createTestSuite(page: Page, name: string): Promise<void> {
  await navigateToTestsPanel(page)
  const createBtn = page.getByRole('button', { name: /Create.*suite|suite.*create/i })
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click()
  } else {
    await page.getByTitle(/New Test Suite|Yeni Test Paketi/i).click()
  }
  const input = page.getByPlaceholder(/Test suite name|Test paketi adı/i)
  await input.fill(name)
  await input.press('Enter')
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
}

export async function openSuiteContextMenu(page: Page, suiteName: string): Promise<void> {
  const row = page.getByText(suiteName, { exact: true }).first()
  await row.click({ button: 'right' })
}

/** Persist active test-suite item snapshot (UrlBar save on Tests page). */
export async function saveActiveSuiteItem(page: Page): Promise<void> {
  await navigateToTestsPanel(page)
  await page.getByTestId('url-input').click()
  await page.getByTestId('save-btn').click()
  await page.waitForTimeout(600)
}

export async function addSuiteItem(page: Page, suiteName: string): Promise<void> {
  await navigateToTestsPanel(page)
  await page.getByText(suiteName, { exact: true }).first().click()
  await openSuiteContextMenu(page, suiteName)
  await clickSuiteMenuItem(page, /New Request|new request/i)
  // Suite-item tabs live on the Tests page — switching to APIs activates a
  // different tab and fillUrl/save would target the wrong request state.
  const suiteTab = page.locator('[data-testid="endpoint-tab"]').last()
  await expect(suiteTab).toBeVisible({ timeout: 15_000 })
  await suiteTab.click()
  // Fresh suite items open on the welcome surface (no UrlBar) until a protocol
  // tile is picked — same guard as Workbench `isNewEmptyTab`.
  const httpTile = page.getByText(/^HTTP$/).first()
  if (await httpTile.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await httpTile.click()
  }
  await expect(page.getByTestId('url-input')).toBeVisible({ timeout: 20_000 })
}

export async function runSuiteFromContextMenu(page: Page, suiteName: string): Promise<void> {
  await dismissOverlays(page)
  await navigateToTestsPanel(page)
  await openSuiteContextMenu(page, suiteName)
  await clickSuiteMenuItem(page, /Run suite|Run Suite/i)
  await expect(page.getByTestId('runner-start')).toBeVisible({ timeout: 15_000 })
}

export async function runSuiteAndAssert(
  page: Page,
  suiteName: string,
  expected: { minPassed: number; maxFailed?: number },
): Promise<void> {
  await runSuiteFromContextMenu(page, suiteName)
  await waitRunnerConfigReady(page)
  await startRunnerTabRun(page)
  await waitRunnerTabComplete(page, 120_000)
  const summary = await readRunnerTabSummary(page)
  expect(summary.passed).toBeGreaterThanOrEqual(expected.minPassed)
  if (expected.maxFailed !== undefined) {
    expect(summary.failed).toBeLessThanOrEqual(expected.maxFailed)
  }
}
