import { expect, type Page } from '@playwright/test'
import { openCommandPalette } from './bootstrap'

export async function openCollectionRunner(page: Page): Promise<void> {
  await openCommandPalette(page)
  await page.getByRole('option', { name: /Open collection runner/i }).click()
  await expect(page.getByTestId('collection-runner-modal')).toBeVisible({ timeout: 8_000 })
}

/** Deselect every runner row except the one whose label contains `name`.
 * NOT: satır satır dolaşmak (O(n)×3 roundtrip) worker koleksiyonu yüzlerce
 * isteğe ulaştığında test timeout'unu yiyor — "Deselect All" tek tık, sonra
 * yalnızca hedef satır(lar) işaretlenir. */
export async function selectOnlyRunnerEndpoint(page: Page, name: string): Promise<void> {
  await selectOnlyRunnerEndpoints(page, name)
}

/** Keep selected every runner row whose label contains `substr`; deselect the rest. */
export async function selectOnlyRunnerEndpoints(page: Page, substr: string): Promise<void> {
  const modal = page.getByTestId('collection-runner-modal')
  await modal.getByRole('button', { name: /Deselect All/i }).click()
  const matches = modal
    .locator('div.border-b')
    .filter({ has: page.locator('input[type="checkbox"]') })
    .filter({ hasText: substr })
  const count = await matches.count()
  expect(count, `runner row containing "${substr}" not found`).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const row = matches.nth(i)
    await row.scrollIntoViewIfNeeded()
    const cb = row.locator('input[type="checkbox"]')
    if (!(await cb.isChecked())) await cb.click()
  }
}

export async function startCollectionRun(page: Page): Promise<void> {
  const start = page.getByTestId('collection-runner-modal').getByTestId('runner-start')
  await expect(start).toBeEnabled({ timeout: 30_000 })
  await start.click()
}

export async function waitCollectionRunComplete(page: Page, timeoutMs = 90_000): Promise<void> {
  const modal = page.getByTestId('collection-runner-modal')
  await expect(modal.getByTestId('runner-results-title').or(modal.getByText(/Run results/i)).first()).toBeVisible({
    timeout: timeoutMs,
  })
}

export async function readCollectionRunSummary(page: Page): Promise<{ passed: number; failed: number }> {
  const modal = page.getByTestId('collection-runner-modal')
  const passedBtn = modal.getByTestId('runner-filter-passed')
  if (await passedBtn.isVisible().catch(() => false)) {
    const passedText = (await passedBtn.textContent()) ?? ''
    const failedText = (await modal.getByTestId('runner-filter-failed').textContent()) ?? ''
    return {
      passed: Number(passedText.match(/(\d+)/)?.[1] ?? 0),
      failed: Number(failedText.match(/(\d+)/)?.[1] ?? 0),
    }
  }
  const text = (await modal.textContent()) ?? ''
  return {
    passed: Number(text.match(/Passed\s*(\d+)/i)?.[1] ?? 0),
    failed: Number(text.match(/Failed\s*(\d+)/i)?.[1] ?? 0),
  }
}

export async function closeCollectionRunner(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('collection-runner-modal')).toBeHidden({ timeout: 5_000 })
}

/** Open the Scheduled Tasks list from the Tests sidebar quick-nav. */
export async function openScheduledTasksView(page: Page): Promise<void> {
  await page.getByTestId('nav-tests').click()
  await page
    .getByTestId('left-panel')
    .getByRole('button', { name: /^Scheduled Tasks$/i })
    .click()
  await expect(
    page.getByTestId('scheduled-task-row').or(page.getByText(/No scheduled tasks yet/i)).first(),
  ).toBeVisible({ timeout: 10_000 })
}

/** Runner tab (Tests sidebar) — Start run button in embedded RunnerConfig. */
export async function startRunnerTabRun(page: Page): Promise<void> {
  await page.getByTestId('runner-start').click()
}

export async function waitRunnerConfigReady(page: Page, urlHint?: string): Promise<void> {
  const wb = page.getByTestId('workbench')
  await expect(wb.getByText('Run Sequence')).toBeVisible({ timeout: 20_000 })
  if (urlHint) {
    await expect(wb.getByText(urlHint, { exact: false }).first()).toBeVisible({ timeout: 20_000 })
  } else {
    await expect(wb.getByText(/GET|POST|PUT|PATCH|DELETE/i).first()).toBeVisible({ timeout: 20_000 })
  }
}

export async function waitRunnerTabComplete(page: Page, timeoutMs = 90_000): Promise<void> {
  await expect(page.getByTestId('runner-results-title')).toBeVisible({ timeout: timeoutMs })
  await expect(page.getByTestId('runner-filter-passed')).toBeVisible({ timeout: 5_000 })
}

export async function readRunnerTabSummary(page: Page): Promise<{ passed: number; failed: number }> {
  const passedText = (await page.getByTestId('runner-filter-passed').textContent()) ?? ''
  const failedText = (await page.getByTestId('runner-filter-failed').textContent()) ?? ''
  return {
    passed: Number(passedText.match(/(\d+)/)?.[1] ?? 0),
    failed: Number(failedText.match(/(\d+)/)?.[1] ?? 0),
  }
}
