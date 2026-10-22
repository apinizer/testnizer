/**
 * SSE mock servers through the real UI (issue #221, Faz 1b).
 *
 *  1. Ticker: New mock server → SSE → Ticker (port suggestion in the 3200
 *     band) → the row lands in the SSE sidebar section with its SSE badge →
 *     the editor's "Start & open in SSE tab" starts the server and opens a
 *     clean (not dirty) SSE tab on GET <mock>/events → Connect receives
 *     `tick` events with JSON data n = 1, 2.
 *  2. Finite replay: 5 events, then the stream ends. The SSE client's own
 *     reconnect carries Last-Event-ID 5 and is refused with 204 (the mock's
 *     Logs show 200 + 204; the event count stays 5, so nothing replays) and
 *     the tab leaves Connected with "The server closed the stream (HTTP 204)";
 *     a manual Connect with Last-Event-ID 5 shows the refusal in the SSE tab.
 *  3. Stream row: Loop on → Resume disabled with its reason; an interval
 *     above the 600000 ms limit is clamped by the number box on commit.
 *
 * Every test creates its own server on a `randomMockPort()` port (the
 * per-worker 31000+ band, never the 3200 suggestion) and removes it in
 * afterEach: disconnect the SSE tab first (a stopped ticker would leave the
 * client retrying), then stop + delete the server, then Force Close All Tabs.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import { randomMockPort } from '../../helpers/ui/mock-flow'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

/** Servers created by the running test — removed in afterEach. */
let created: { id: string; name: string }[] = []

function sseRow(page: Page, name: string): Locator {
  return page
    .getByTestId('mock-sse-section')
    .locator('[data-testid^="mock-sse-row-"]')
    .filter({ hasText: name })
}

function activeTab(page: Page): Locator {
  return page.locator('[data-testid="endpoint-tab"][data-active="true"]')
}

/** One received event row in the SSE tab's log, by its SSE `id:`. */
function eventRow(page: Page, id: number): Locator {
  return page.locator(`[data-testid="sse-event-row"][data-event-id="${id}"]`)
}

/**
 * Create an SSE mock server through the "New mock server" dialog and return
 * its id. Leaves its editor tab open (the dialog opens it).
 */
async function createSseServer(
  page: Page,
  opts: { preset: 'ticker' | 'replay'; name: string; port: number },
): Promise<string> {
  await navigateSidebar(page, 'mocks')
  await page.getByTestId('mock-new').click()
  const dialog = page.getByTestId('mock-new-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })

  await dialog.getByTestId('mock-new-type-sse').click()
  await expect(dialog.getByTestId('mock-new-type-sse')).toHaveAttribute('aria-checked', 'true')
  // SSE's default preset is Ticker; pick the requested one explicitly anyway.
  await dialog.getByTestId(`mock-new-preset-${opts.preset}`).click()
  await expect(dialog.getByTestId(`mock-new-preset-${opts.preset}`)).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // Port suggestions for SSE start at 3200 (HTTP 3001, MCP 3100).
  await expect(dialog.getByTestId('mock-new-port')).toHaveValue(/^32\d{2}$/)

  await dialog.getByTestId('mock-new-name').fill(opts.name)
  await dialog.getByTestId('mock-new-port').fill(String(opts.port))
  await dialog.getByTestId('mock-new-create').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })

  const row = sseRow(page, opts.name)
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  const testId = await row.getAttribute('data-testid')
  const id = testId?.replace(/^mock-sse-row-/, '') ?? ''
  expect(id).not.toBe('')
  created.push({ id, name: opts.name })
  return id
}

/** Click the editor header's "Start & open in SSE tab" and return the SSE URL it opened. */
async function startAndOpenInSse(page: Page, name: string, port: number): Promise<string> {
  const open = page.getByTestId('mock-open-in-sse')
  await expect(open).toHaveText(/Start & open in SSE tab/, { timeout: 10_000 })
  // Disabled until the endpoint list has loaded (it needs a GET target).
  await expect(open).toBeEnabled({ timeout: 10_000 })
  await open.click()

  const url = `http://127.0.0.1:${port}/events`
  await expect(page.getByTestId('sse-url')).toHaveValue(url, { timeout: 10_000 })
  // The client tab is not titled like the editor tab (PM review #20).
  await expect(activeTab(page)).toHaveAttribute('data-tab-name', `${name} · client`)
  await expect(sseRow(page, name).getByTestId('mock-sse-row-status')).toHaveText(/running/i, {
    timeout: 10_000,
  })
  return url
}

async function expectSseTabClean(page: Page): Promise<void> {
  await expect(activeTab(page)).toHaveAttribute('data-dirty', 'false')
  await expect(activeTab(page).getByTestId('tab-dirty')).toHaveCount(0)
  // A late markDirty (an effect after the prefill) would show up here.
  await page.waitForTimeout(1_500)
  await expect(activeTab(page)).toHaveAttribute('data-dirty', 'false')
}

async function ipcStopAndDelete(page: Page, id: string): Promise<void> {
  await page
    .evaluate(async (sid) => {
      const w = window as Window & {
        api?: {
          mock?: {
            server?: {
              stop: (id: string) => Promise<unknown>
              delete: (id: string) => Promise<unknown>
            }
          }
        }
      }
      await w.api?.mock?.server?.stop(sid)
      await w.api?.mock?.server?.delete(sid)
    }, id)
    .catch(() => {})
}

uiTest.describe('Tur1 — SSE mock servers [issue #221]', () => {
  uiTest.beforeEach(async ({ window }) => {
    created = []
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest.afterEach(async ({ window }) => {
    // 1. Leave no live SSE client behind (it would retry against a stopped port).
    const disconnect = window.getByTestId('sse-disconnect')
    if (await disconnect.isVisible().catch(() => false)) {
      await disconnect.click().catch(() => {})
    }
    // 2. Stop + delete through the sidebar, so the store and the DB agree.
    await navigateSidebar(window, 'mocks').catch(() => {})
    for (const s of created) {
      const row = sseRow(window, s.name)
      try {
        if (await row.getByTestId('mock-sse-stop').isVisible()) {
          await row.getByTestId('mock-sse-stop').click()
          await expect(row.getByTestId('mock-sse-start')).toBeVisible({ timeout: 10_000 })
        }
        await row.getByTestId('mock-sse-delete').click()
        await window.getByTestId('delete-confirm-btn').click()
        await expect(row).toHaveCount(0, { timeout: 10_000 })
      } catch {
        await ipcStopAndDelete(window, s.id)
      }
    }
    created = []
    // 3. Editor + SSE tabs.
    await closeAllTabs(window)
  })

  uiTest(
    'Ticker: create, sidebar badge, Start & open in SSE tab, tick events',
    async ({ window }) => {
      const name = `Tick-${uid()}`
      const port = randomMockPort()
      await createSseServer(window, { preset: 'ticker', name, port })

      // Sidebar: in the SSE section with the SSE badge, not in the HTTP one.
      const row = sseRow(window, name)
      await expect(row.getByTestId('mock-sse-badge')).toHaveText('SSE')
      await expect(
        window.getByTestId('mock-http-section').locator('[data-testid^="mock-http-row-"]').filter({
          hasText: name,
        }),
      ).toHaveCount(0)

      // Editor header: SSE badge + the stopped-state label of the open button.
      await expect(window.getByTestId('mock-kind-badge')).toHaveText('SSE')
      await expect(window.getByTestId('mock-status')).toHaveText(/stopped/i)

      await startAndOpenInSse(window, name, port)

      // The SSE tab: GET, the mock's URL, nothing typed → not dirty.
      await expect(window.getByTestId('sse-method')).toHaveValue('GET')
      await expectSseTabClean(window)

      // Open connects at once (PM review #20) — no Connect click.
      await expect(window.getByTestId('sse-disconnect')).toBeVisible({ timeout: 15_000 })

      for (const n of [1, 2]) {
        const ev = eventRow(window, n)
        await expect(ev).toHaveCount(1, { timeout: 10_000 })
        await expect(ev).toContainText(/tick/i)
        await expect(ev).toContainText(new RegExp(`"n":\\s*${n},`))
      }

      await window.getByTestId('sse-disconnect').click()
      await expect(window.getByTestId('sse-connect')).toBeVisible({ timeout: 10_000 })
    },
  )

  uiTest(
    'Finite replay: 5 events, the stream ends, the reconnect is refused with 204',
    async ({ window }) => {
      const name = `Replay-${uid()}`
      const port = randomMockPort()
      const serverId = await createSseServer(window, { preset: 'replay', name, port })
      await startAndOpenInSse(window, name, port)
      await expectSseTabClean(window)

      // Open connected the tab already (PM review #20). 5 events at 500 ms each.
      const count = window.getByTestId('sse-event-count')
      await expect(count).toHaveText('5 events', { timeout: 15_000 })
      for (const n of [1, 2, 3, 4, 5]) {
        await expect(eventRow(window, n)).toHaveCount(1)
        await expect(eventRow(window, n)).toContainText(`Event ${n} of 5`)
      }

      // The client reconnects `retry: 3000` ms after the end, with Last-Event-ID 5.
      // A replayed list would double the count; a resumed-past-the-end one is 204.
      await window.waitForTimeout(5_000)
      await expect(count).toHaveText('5 events')
      // The 204 means "stop reconnecting": the tab leaves Connected and says why.
      await expect(window.getByTestId('sse-status')).toHaveAttribute('data-state', 'disconnected')
      await expect(window.getByTestId('sse-message')).toHaveText(
        'The server closed the stream (HTTP 204)',
      )
      await expect(window.getByTestId('sse-connect')).toBeVisible()
      await expect(window.getByTestId('sse-disconnect')).toHaveCount(0)

      // The mock's Logs: the first GET streamed (200), the reconnect got 204.
      await window
        .locator('[data-testid="endpoint-tab"][data-active="false"]')
        .filter({ hasText: name })
        .click()
      await expect(window.getByTestId('mock-kind-badge')).toHaveText('SSE', { timeout: 10_000 })
      await window.getByTestId('mock-tab-logs').click()
      // Status is the 4th cell (Time | Method | Path | Status | Latency); newest
      // first. The stream is ONE row (its "closed" entry replaces the "open"
      // one, issue #226), then the reconnect's 204.
      const statusCells = window
        .locator('tr')
        .filter({ hasText: '/events' })
        .locator('td:nth-child(4)')
      await expect
        .poll(async () => (await statusCells.allTextContents()).map((s) => s.trim()), {
          timeout: 10_000,
        })
        .toEqual(['204', '200'])
      // The refused request is the client's resume after the last id.
      const refused = await window.evaluate(async (id) => {
        interface LogEntry {
          statusCode: number
          request: { headers: Record<string, string> }
        }
        const w = window as Window & {
          api?: {
            mock?: {
              logs?: { get: (id: string) => Promise<{ success: boolean; data?: LogEntry[] }> }
            }
          }
        }
        const res = await w.api?.mock?.logs?.get(id)
        return (res?.data ?? [])
          .filter((e) => e.statusCode === 204)
          .map((e) => e.request.headers['last-event-id'])
      }, serverId)
      expect(refused).toEqual(['5'])

      // In the SSE tab: a fresh Connect resuming after the last id is refused visibly.
      await window
        .locator('[data-testid="endpoint-tab"][data-active="false"]')
        .filter({ hasText: name })
        .click()
      await expect(window.getByTestId('sse-url')).toBeVisible({ timeout: 10_000 })
      // The close survived the tab switch (owner-tab routing).
      await expect(window.getByTestId('sse-message')).toHaveText(/HTTP 204/)
      await expect(window.getByTestId('sse-connect')).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: /Last-Event-ID/ }).click()
      await window.getByTestId('sse-last-event-id').fill('5')
      await window.getByTestId('sse-connect').click()
      await expect(window.getByTestId('sse-status')).toHaveAttribute('data-state', 'error', {
        timeout: 15_000,
      })
      await expect(window.getByTestId('sse-message')).toHaveText(/HTTP 204/)
      await expect(window.getByTestId('sse-disconnect')).toHaveCount(0)
    },
  )

  uiTest(
    'Stream row: Loop disables Resume with its reason; interval is clamped to the limit',
    async ({ window }) => {
      const name = `Stream-${uid()}`
      await createSseServer(window, { preset: 'replay', name, port: randomMockPort() })

      // The first endpoint is selected, its response editor shows the Stream row.
      const options = window.getByTestId('mock-sse-options')
      await expect(options).toBeVisible({ timeout: 10_000 })
      const loop = options.getByTestId('mock-stream-loop')
      const resume = options.getByTestId('mock-stream-resume')
      await expect(loop).not.toBeChecked()
      await expect(resume).toBeEnabled()
      await expect(resume).toBeChecked()
      await expect(options.getByTestId('mock-sse-resume-reason')).toHaveCount(0)

      await loop.check()
      await expect(loop).toBeChecked()
      await expect(resume).toBeDisabled()
      const reason = options.getByTestId('mock-sse-resume-reason')
      await expect(reason).toBeVisible()
      await expect(reason).toHaveText(/Loop is on/)
      await expect(resume).toHaveAttribute('aria-describedby', /.+/)

      await loop.uncheck()
      await expect(resume).toBeEnabled()
      await expect(options.getByTestId('mock-sse-resume-reason')).toHaveCount(0)

      // Above SSE_MAX_INTERVAL_MS: the number box keeps the text while typing
      // and clamps on commit, so the save never carries an invalid value and
      // the main process has nothing to reject (no inline error).
      const interval = options.getByTestId('mock-stream-interval')
      await interval.fill('700000')
      await interval.press('Tab')
      await expect(interval).toHaveValue('600000')
      await expect(options.getByTestId('mock-sse-error')).toHaveCount(0)
      await expect(options.getByRole('alert')).toHaveCount(0)
    },
  )
})
