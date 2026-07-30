import { expect, type Page } from '@playwright/test'
import { closeAllTabs, openCommandPalette } from './bootstrap'

/**
 * "Collection runner" is a RUNNER TAB, not a modal, since the v1.5.0 QA round.
 *
 * The Command Palette used to open `CollectionRunnerModal`, whose run path
 * dropped seven payload fields (setup/teardown phases, hook scripts, iteration
 * data, `stopOnError`, `persistResponses`) — a run started from the palette
 * silently behaved differently from the same run started from the tab. The
 * palette now opens the maintained tab via `openOrReuseRunnerTab()`.
 *
 * These helpers keep their names and their contract ("open the collection
 * runner", "start the run", "wait for results") so every calling spec is
 * unaffected; only what they point at changed. `runner-start`,
 * `runner-results-title` and the filter test-ids are shared by both surfaces,
 * so the scoping wrapper is all that had to move.
 */

/** The runner surface the palette opens — scoped to the workbench, not a modal. */
function runnerSurface(page: Page) {
  return page.getByTestId('workbench')
}

export async function openCollectionRunner(page: Page): Promise<void> {
  await openCommandPalette(page)
  await page
    .getByRole('option', { name: /Open collection runner|Koleksiyon çalıştırıcısını aç/i })
    .click()
  // The tab lands on the config screen; "Run Sequence" is its stable heading.
  await expect(runnerSurface(page).getByText('Run Sequence')).toBeVisible({ timeout: 20_000 })
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
  const surface = runnerSurface(page)
  await surface.getByRole('button', { name: /Deselect All/i }).click()
  const matches = surface
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
  const start = runnerSurface(page).getByTestId('runner-start')
  await expect(start).toBeEnabled({ timeout: 30_000 })
  await start.click()
}

export async function waitCollectionRunComplete(page: Page, timeoutMs = 90_000): Promise<void> {
  const surface = runnerSurface(page)
  await expect(
    surface
      .getByTestId('runner-results-title')
      .or(surface.getByText(/Run results/i))
      .first(),
  ).toBeVisible({ timeout: timeoutMs })
}

export async function readCollectionRunSummary(
  page: Page,
): Promise<{ passed: number; failed: number }> {
  const surface = runnerSurface(page)
  const passedBtn = surface.getByTestId('runner-filter-passed')
  if (await passedBtn.isVisible().catch(() => false)) {
    const passedText = (await passedBtn.textContent()) ?? ''
    const failedText = (await surface.getByTestId('runner-filter-failed').textContent()) ?? ''
    return {
      passed: Number(passedText.match(/(\d+)/)?.[1] ?? 0),
      failed: Number(failedText.match(/(\d+)/)?.[1] ?? 0),
    }
  }
  const text = (await surface.textContent()) ?? ''
  return {
    passed: Number(text.match(/Passed\s*(\d+)/i)?.[1] ?? 0),
    failed: Number(text.match(/Failed\s*(\d+)/i)?.[1] ?? 0),
  }
}

/**
 * Close the runner. A tab is closed, not dismissed — Escape does nothing to it,
 * and leaving it open leaks state into the next spec in the shared Electron
 * instance (CLAUDE.md: state accumulation in `--project=ui`).
 */
export async function closeCollectionRunner(page: Page): Promise<void> {
  // Every caller uses this as the last cleanup step, so closing the whole tab
  // strip is both sufficient and safer: `--project=ui` shares one Electron
  // instance, and a runner tab left open is exactly the state accumulation
  // that makes the NEXT spec fail somewhere unrelated.
  await closeAllTabs(page)
  await expect(runnerSurface(page).getByText('Run Sequence')).toBeHidden({ timeout: 8_000 })
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
