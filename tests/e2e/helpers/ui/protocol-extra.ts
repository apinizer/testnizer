/**
 * Helpers shared across the tur1 advanced-protocol specs (WS, SSE, GraphQL,
 * gRPC, Socket.IO, MCP).  Kept separate from existing helpers to avoid
 * modifying files the task forbids touching.
 */
import type { Page } from '@playwright/test'

/**
 * Expand a collapsible section by its visible button label.
 * Uses getByRole('button', { name }) so it works for both text-only and
 * icon+text buttons (chevron + label pattern used in WebSocketEditor,
 * SseEditor, GrpcRequestPane, etc.).
 */
export async function expandSection(page: Page, label: RegExp | string): Promise<void> {
  const btn = page.getByRole('button', { name: label }).first()
  await btn.click({ timeout: 3_000 })
  await page.waitForTimeout(150)
}

/**
 * Add a key-value row in the most-recently expanded KeyValueTable.
 * Clicks "+ Add Header" / "+ Add Metadata" / "+ Add …" in the visible area.
 */
export async function addKvRow(
  page: Page,
  key: string,
  value: string,
  addLabel: RegExp | string = /\+ Add/i,
): Promise<void> {
  await page.getByRole('button', { name: addLabel }).first().click()
  const rows = page.locator('[data-testid^="kv-row-"]')
  const count = await rows.count()
  if (count === 0) throw new Error(`addKvRow: no key/value row after clicking ${String(addLabel)}`)
  const row = rows.nth(count - 1)
  await row.getByTestId('kv-key').locator('input').fill(key)
  await row.getByTestId('kv-value').locator('input').fill(value)
}

/**
 * Select a transport option in the MCP editor's transport <select>.
 * Matches by option label text.
 */
export async function selectMcpTransport(
  page: Page,
  labelPattern: RegExp | string,
): Promise<void> {
  const sel = page.locator('select').first()
  await sel.selectOption(
    typeof labelPattern === 'string'
      ? { label: labelPattern }
      : { label: (await sel.locator('option').allTextContents()).find((t) =>
          labelPattern.test(t),
        ) ?? '',
        },
  )
}

/**
 * Wait for the gRPC proto to finish loading by polling until the
 * grpc-method-select is visible (indicating proto is loaded).
 */
export async function waitForGrpcProtoLoad(page: Page, timeout = 20_000): Promise<void> {
  await page.getByTestId('grpc-method-select').waitFor({ state: 'visible', timeout })
}

/**
 * Disconnect any active WS / SSE / Socket.IO / MCP connection by clicking
 * the visible Disconnect button, if present.
 */
export async function disconnectIfConnected(page: Page): Promise<void> {
  for (const testId of ['ws-disconnect', 'sse-disconnect']) {
    const btn = page.getByTestId(testId)
    // optional: cleanup helper — only disconnects connections that are open.
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(300)
    }
  }
  // socketio and mcp use the same button with changing text
  const disconnectBtns = page.getByRole('button', { name: /^Disconnect$/i })
  const count = await disconnectBtns.count()
  for (let i = 0; i < count; i++) {
    // optional: cleanup helper — skips buttons that are not on screen.
    if (await disconnectBtns.nth(i).isVisible().catch(() => false)) {
      await disconnectBtns.nth(i).click()
      await page.waitForTimeout(300)
    }
  }
}
