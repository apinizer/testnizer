/**
 * Tester finding 12 — with Iterations = 3 the same request produces three
 * result rows. Clicking the third row showed the FIRST run in the detail pane,
 * and the clicked row lit up in every iteration at once.
 *
 * Selection was keyed by `endpointId`, which all three rows share. The unit
 * test (`tests/renderer/runner-iteration-selection.test.tsx`) pins the row key;
 * this walks it through the real app against a local server that answers each
 * call with a different label, so the detail pane can only show the right one
 * if it opened the right run. The same check runs on the run reopened from All
 * Runs, which reads the rows back from `runner_history.results_json`.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import {
  openCollectionRunner,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'

const uid = (): string => String(Date.now()).slice(-7)

/** Label the server sends back on its n-th call (1-based). */
const label = (stamp: string, n: number): string => `run-${n}-${stamp}`

let server: http.Server
let baseUrl = ''
let hits = 0
let stamp = ''

async function expectOnlyRowSelected(window: Page, index: number): Promise<void> {
  const rows = window.getByTestId('runner-results-list').getByTestId('runner-result-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(index)).toHaveAttribute('data-selected', 'true')
  await expect(
    window
      .getByTestId('runner-results-list')
      .locator('[data-testid="runner-result-row"][data-selected="true"]'),
  ).toHaveCount(1)
}

async function expectDetailShowsRun(window: Page, n: number): Promise<void> {
  const detail = window.getByTestId('runner-result-detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByTestId('runner-result-detail-iteration')).toHaveText(`Iteration ${n}`)
  await expect(detail).toContainText(label(stamp, n))
  for (const other of [1, 2, 3].filter((k) => k !== n)) {
    await expect(detail).not.toContainText(label(stamp, other))
  }
}

uiTest.describe('runner — selecting one iteration of a request (finding 12)', () => {
  uiTest.beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits += 1
      res.writeHead(200, {
        'content-type': 'application/json',
        // Neutral names on purpose: a header or body field named like a
        // credential (`token`, `key`, …) is masked before the row is stored,
        // and the check below would then fail for a reason unrelated to the
        // selection.
        'x-hit-label': label(stamp, hits),
      })
      res.end(JSON.stringify({ hit: hits, label: label(stamp, hits) }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  uiTest.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('the third row opens the third run, and only that row is selected', async ({ window }) => {
    stamp = uid()
    const name = `Counter ${stamp}`

    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${baseUrl}/hit?s=${stamp}`)
    await saveRequestToTree(window, name)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, stamp)
    await window.getByTestId('runner-iterations').fill('3')
    await window.getByTestId('runner-iterations').blur()

    hits = 0
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window)
    expect(hits, 'the request ran once per iteration').toBe(3)
    await window.screenshot({ path: 'test-results/screens/73-run-finished.png' })

    const rows = window.getByTestId('runner-results-list').getByTestId('runner-result-row')
    await expect(rows).toHaveCount(3)

    // 1. The third row → the third run. Before the fix: the first run's label,
    //    and all three rows highlighted.
    await rows.nth(2).click()
    await expectOnlyRowSelected(window, 2)
    await expectDetailShowsRun(window, 3)
    await window.screenshot({ path: 'test-results/screens/73-third-row-selected.png' })

    // 2. Back to the first row: the selection moves, it does not add up.
    await rows.nth(0).click()
    await expectOnlyRowSelected(window, 0)
    await expectDetailShowsRun(window, 1)
    await window.screenshot({ path: 'test-results/screens/73-first-row-selected.png' })

    // 3. The same run reopened from All Runs (rows read back from
    //    runner_history) — the sibling path that renders the same list.
    await window.getByRole('button', { name: /View all runs/i }).click()
    const historyRow = window.getByTestId('runner-history-row').first()
    await expect(historyRow).toBeVisible({ timeout: 20_000 })
    await historyRow.click()
    await expect(rows).toHaveCount(3, { timeout: 20_000 })
    await expect(window.getByTestId('runner-result-detail')).toHaveCount(0)

    await rows.nth(2).click()
    await expectOnlyRowSelected(window, 2)
    await expectDetailShowsRun(window, 3)
    await window.screenshot({ path: 'test-results/screens/73-history-third-row-selected.png' })
  })
})
