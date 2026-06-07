import { expect, type Page } from '@playwright/test'
import { navigateSidebar } from './bootstrap'

/**
 * Pick a high port for an ephemeral mock server that won't collide across
 * parallel workers. Each worker owns a disjoint 1000-port band keyed off its
 * Playwright index (TEST_PARALLEL_INDEX / TEST_WORKER_INDEX), so two workers
 * starting mock servers concurrently can never land on the same port. Within a
 * band the choice is still random to dodge a port left in TIME_WAIT by an
 * earlier test in the same worker.
 */
export function randomMockPort(): number {
  const idx = Number(
    process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? '0',
  )
  const band = 31000 + (Number.isFinite(idx) ? idx : 0) * 1000
  return band + Math.floor(Math.random() * 1000)
}

/** Create a mock server from the Mocks panel and open its editor. */
export async function createMockServer(page: Page, name: string, port: number): Promise<void> {
  await navigateSidebar(page, 'mocks')
  await page.getByTitle(/New mock server|Yeni mock sunucu/i).click()
  await page.getByPlaceholder(/Server name|Sunucu adı/i).fill(name)
  await page.getByPlaceholder('3001').fill(String(port))
  await page.getByRole('button', { name: /^Create$|^Oluştur$/i }).click()
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 })
  await page.getByText(name).first().click()
  await expect(page.getByTestId('workbench')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('mock-add-endpoint')).toBeVisible({ timeout: 10_000 })
}

/** Add an endpoint (defaults to GET /new-endpoint) and set its method/path. */
export async function addMockEndpoint(
  page: Page,
  opts: { path: string; method?: string },
): Promise<void> {
  await page.getByTestId('mock-add-endpoint').click()
  await expect(page.getByTestId('mock-endpoint-path')).toBeVisible({ timeout: 10_000 })
  if (opts.method) await page.getByTestId('mock-endpoint-method').selectOption(opts.method)
  await page.getByTestId('mock-endpoint-path').fill(opts.path)
}

/** Add a response and optionally set its status code. Default body is {"ok":true}. */
export async function addMockResponse(page: Page, opts: { status?: number } = {}): Promise<void> {
  await page.getByTestId('mock-add-response').click()
  await expect(page.getByTestId('mock-response-status')).toBeVisible({ timeout: 10_000 })
  if (opts.status !== undefined) {
    await page.getByTestId('mock-response-status').fill(String(opts.status))
  }
  // Let the per-keystroke updateEndpoint/updateResponse IPC writes settle so
  // the live server reads the latest definition when it starts.
  await page.waitForTimeout(500)
}

/**
 * Fill the condition JSON of the most-recently-added response.
 *
 * The condition <textarea> is NOT the last textarea on the page — the response
 * editor renders other textareas and `textarea.last()` lands on an unrelated
 * one. Every condition textarea defaults to a JSON object containing `"type"`,
 * so we scope to the textareas whose live value contains `"type"` and take the
 * last (newest response).
 */
export async function fillLastResponseCondition(page: Page, condition: object): Promise<void> {
  const all = page.locator('textarea')
  const count = await all.count()
  let target: ReturnType<Page['locator']> | null = null
  for (let i = count - 1; i >= 0; i--) {
    const val = await all.nth(i).inputValue().catch(() => '')
    if (val.includes('"type"')) {
      target = all.nth(i)
      break
    }
  }
  if (!target) throw new Error('condition textarea (value containing "type") not found')
  await target.fill(JSON.stringify(condition))
  await target.blur()
  await page.waitForTimeout(400)
}

export async function startMockServer(page: Page): Promise<void> {
  await page.getByTestId('mock-start').click()
  await expect(page.getByTestId('mock-status')).toContainText(/running/i, { timeout: 15_000 })
}

export async function stopMockServer(page: Page): Promise<void> {
  await page
    .getByTestId('mock-stop')
    .click()
    .catch(() => {})
}

/** Resolve the full URL (http://host:port/basePath/path) for the active endpoint. */
export async function getMockEndpointUrl(page: Page): Promise<string> {
  const url = (await page.getByTestId('mock-endpoint-url').textContent())?.trim()
  if (!url) throw new Error('mock endpoint URL not rendered')
  return url
}
