/**
 * Documentation screenshots — see fixture.ts. Each test drives one screen of
 * the seeded "Acme Orders" project and writes
 * website/public/docs/screenshots/<page>-<topic>.png. Every test builds the
 * state its frame needs, so `-g <title>` re-shoots a single frame.
 *
 *   npm run build
 *   node scripts/ensure-native-abi.js electron
 *   TESTNIZER_DOCS_SHOTS=1 npx playwright test --project=docs-screenshots --reporter=list
 */
import type { ElectronApplication, Page } from '@playwright/test'
import {
  docsTest as test,
  expect,
  ipc,
  shot,
  closeTabs,
  openMock,
  openRequest,
  setResponseShare,
} from './fixture'

async function send(page: Page, status: RegExp = /200/): Promise<void> {
  await page.getByTestId('send-btn').click()
  await expect(page.getByTestId('response-status')).toContainText(status, { timeout: 20_000 })
}

async function newTab(page: Page, label: RegExp): Promise<void> {
  await page.getByTestId('nav-apis').click()
  await page.getByTestId('new-dropdown-btn').click()
  const menu = page.getByTestId('new-dropdown-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: label }).first().click()
}

/**
 * Put `text` into the Monaco editor inside `testId` with a real paste (system
 * clipboard + Mod+V). Typing it instead lets Monaco auto-indent and auto-close
 * brackets, which garbles multi-line JSON / GraphQL in the frame.
 *
 * Side effect: this goes through the machine's real system clipboard, not the
 * throwaway profile. The previous text is put back right after the paste, but
 * anything else reading the clipboard during that moment sees `text`.
 */
async function pasteMonaco(
  app: ElectronApplication,
  page: Page,
  testId: string,
  text: string,
): Promise<void> {
  const previous = await app.evaluate(({ clipboard }, t) => {
    const before = clipboard.readText()
    clipboard.writeText(t)
    return before
  }, text)
  const editor = page.getByTestId(testId).locator('.monaco-editor').first()
  try {
    await editor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+KeyA`)
    await page.keyboard.press(`${mod}+KeyV`)
  } finally {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), previous)
  }
  await expect
    .poll(async () =>
      (await editor.locator('.view-lines').first().innerText()).replace(/\u00a0/g, ' '),
    )
    .toContain(text.split('\n')[0].trim())
}

async function connectMcp(page: Page, url: string): Promise<void> {
  await newTab(page, /^MCP/)
  await page.getByTestId('mcp-url').fill(url)
  await page.getByTestId('mcp-connect').click()
  await expect(page.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, { timeout: 15_000 })
  await expect(page.getByTestId('mcp-tool-search_orders')).toBeVisible({ timeout: 10_000 })
}

test.beforeEach(async ({ window: page, seed }) => {
  void seed
  await closeTabs(page)
})

// ── Getting started / HTTP ──────────────────────────────────────────────────

test('getting-started-main-window', async ({ window: page }) => {
  await openRequest(page, 'List orders')
  await send(page)
  await expect(page.getByTestId('res-tab-testResults')).toContainText(/3\s*\/\s*3/)
  await setResponseShare(page, 0.58)
  await shot(page, 'getting-started-main-window')
})

test('http-request-body', async ({ window: page }) => {
  await openRequest(page, 'Create order')
  await page.getByTestId('req-tab-body').click()
  await send(page, /201/)
  await setResponseShare(page, 0.45)
  await shot(page, 'http-request-body')
})

test('http-tests-results', async ({ window: page }) => {
  await openRequest(page, 'List orders')
  await page.getByTestId('req-tab-scripts').click()
  await page.getByTestId('scripts-post').click()
  await send(page)
  await page.getByTestId('res-tab-testResults').click()
  await expect(page.getByTestId('test-results-panel')).toBeVisible()
  await expect(page.getByTestId('res-tab-testResults')).toContainText(/3\s*\/\s*3/)
  await setResponseShare(page, 0.4)
  await shot(page, 'http-tests-results')
})

test('scripts-pre-request', async ({ window: page }) => {
  await openRequest(page, 'Create order')
  await page.getByTestId('req-tab-scripts').click()
  await page.getByTestId('scripts-pre').click()
  await send(page, /201/)
  await expect(page.getByTestId('res-tab-testResults')).toContainText(/2\s*\/\s*2/)
  await page.getByTestId('res-tab-testResults').click()
  await setResponseShare(page, 0.4)
  await shot(page, 'scripts-pre-request')
})

// ── Environments / variables ────────────────────────────────────────────────

test('environments-editor', async ({ window: page }) => {
  await openRequest(page, 'Get order')
  await page.getByTestId('footer-env').click()
  const modal = page.getByTestId('environment-modal')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Staging', exact: true }).click()
  await expect(page.getByTestId('env-var-row'))
    .toHaveCount(5, { timeout: 5_000 })
    .catch(() => {})
  await shot(page, 'environments-editor')
  await page.keyboard.press('Escape')
})

test('variables-right-panel', async ({ window: page }) => {
  await openRequest(page, 'Create order')
  await page.getByTestId('req-tab-body').click()
  const panel = page.getByTestId('right-panel')
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByTestId('right-panel-rail-variables').click()
  }
  await expect(panel).toBeVisible()
  await panel.getByTitle(/^Variables$/).click()
  await expect(panel).toContainText('baseUrl')
  await shot(page, 'variables-right-panel')
  await page.getByTestId('right-panel-collapse').click()
})

// ── MCP ─────────────────────────────────────────────────────────────────────

test('mcp-tool-call', async ({ window: page, seed }) => {
  await connectMcp(page, seed.mcpUrl)
  await page.getByTestId('mcp-tool-search_orders').click()
  await page.getByTestId('mcp-args-view-json').click()
  await page
    .getByTestId('mcp-tool-args')
    .fill(JSON.stringify({ status: 'open', customerId: 'cus_311', limit: 10 }, null, 2))
  await page.getByTestId('mcp-invoke').click()
  await expect(page.getByTestId('mcp-result')).toContainText('ord_1042', { timeout: 10_000 })
  await shot(page, 'mcp-tool-call')
})

test('mcp-security-scan', async ({ window: page, seed }) => {
  await connectMcp(page, seed.mcpUrl)
  await page.getByTestId('mcp-section-security').click()
  await expect(page.getByTestId('mcp-security-tab')).toBeVisible()
  await page.getByTestId('mcp-security-scan').click()
  await expect(page.getByTestId('mcp-security-summary')).toBeVisible({ timeout: 90_000 })
  await shot(page, 'mcp-security-scan')
})

// ── AI Chat ─────────────────────────────────────────────────────────────────

test('ai-chat-tool-approval', async ({ window: page, seed }) => {
  await openMock(page, 'Support assistant LLM')
  await page.getByTestId('mock-open-in-ai-chat').click()
  await expect(page.getByTestId('ai-chat-editor')).toBeVisible({ timeout: 10_000 })
  const tools = page.getByTestId('ai-tools-toggle')
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await page.getByTestId('ai-tools-add-adhoc').click()
  await page.getByTestId('ai-tool-server-url').fill(seed.mcpUrl)
  await page.getByTestId('ai-tool-server').getByPlaceholder('Name').fill('Acme Orders MCP')
  // Fold the settings and tools blocks so the conversation gets the frame.
  for (const id of ['ai-settings-toggle', 'ai-tools-toggle']) {
    const t = page.getByTestId(id)
    if ((await t.getAttribute('aria-expanded')) === 'true') await t.click()
  }
  const ask = page.getByPlaceholder(/Ask anything/i)
  await ask.fill('Can you check that the order tools are reachable?')
  await ask.press('Enter')
  const approval = page.getByTestId('ai-tool-approval')
  await expect(approval).toBeVisible({ timeout: 20_000 })
  await shot(page, 'ai-chat-tool-approval')
  await approval.getByTestId('ai-approve-once').click()
  await expect(page.getByText(/Tool said:/).first()).toBeVisible({ timeout: 20_000 })
  const call = page.getByTestId('ai-tool-call').first()
  await expect(call).toHaveAttribute('data-status', 'done')
  await shot(page, 'ai-chat-reply')
})

// ── Realtime protocols ──────────────────────────────────────────────────────

test('sse-event-log', async ({ window: page }) => {
  await openMock(page, 'Order events')
  await page.getByTestId('mock-open-in-sse').click()
  await expect(page.getByTestId('sse-url')).toBeVisible({ timeout: 10_000 })
  const connect = page.getByTestId('sse-connect')
  if (await connect.isVisible().catch(() => false)) await connect.click()
  await expect(page.getByTestId('sse-event-row')).toHaveCount(5, { timeout: 20_000 })
  await page.getByTestId('sse-event-row').nth(1).click()
  await shot(page, 'sse-event-log')
})

test('websocket-message-log', async ({ app, window: page, demo }) => {
  await newTab(page, /WebSocket/i)
  await page.getByTestId('ws-url').fill(demo.wsUrl)
  await page.getByTestId('ws-connect').click()
  await expect(page.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
  await pasteMonaco(
    app,
    page,
    'ws-composer',
    JSON.stringify({ action: 'subscribe', channel: 'orders' }, null, 2),
  )
  await expect(page.getByTestId('ws-send')).toBeEnabled()
  await page.getByTestId('ws-send').click()
  await expect(page.getByText(/order\.created/).first()).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(500)
  await shot(page, 'websocket-message-log')
  await page.getByTestId('ws-disconnect').click()
})

test('graphql-query', async ({ app, window: page, demo }) => {
  await newTab(page, /GraphQL/i)
  await page.getByTestId('graphql-url').fill(demo.graphqlUrl)
  await pasteMonaco(
    app,
    page,
    'graphql-query-editor',
    [
      'query OpenOrders {',
      '  orders(status: "open", limit: 5) {',
      '    id',
      '    status',
      '    total',
      '    customer { name tier }',
      '    items { sku quantity }',
      '  }',
      '}',
    ].join('\n'),
  )
  await page.getByTestId('graphql-run').click()
  await expect(page.getByTestId('graphql-response-body')).toContainText('Jordan Rivera', {
    timeout: 15_000,
  })
  await shot(page, 'graphql-query')
})

test('mqtt-message-log', async ({ app, window: page, demo }) => {
  await newTab(page, /MQTT/)
  await page.getByTestId('mqtt-url').fill(demo.mqttUrl)
  await page.getByTestId('mqtt-version').selectOption('4')
  await page.getByTestId('mqtt-tab-topics').click()
  await page.getByTestId('mqtt-topic-add').click()
  await page.getByTestId('mqtt-topic-name').last().fill('acme/orders/#')
  await page.getByTestId('mqtt-connect').click()
  await expect(page.getByTestId('mqtt-status')).toHaveAttribute('data-state', 'connected', {
    timeout: 15_000,
  })
  await page.getByTestId('mqtt-tab-message').click()
  const messages: Array<[string, unknown]> = [
    ['acme/orders/ord_1042/status', { status: 'paid', at: '2026-11-02T09:44:03Z' }],
    ['acme/orders/ord_1042/status', { status: 'packed', at: '2026-11-02T10:12:40Z' }],
    ['acme/orders/ord_1043/created', { total: 42.5, currency: 'USD' }],
  ]
  for (const [topic, payload] of messages) {
    await page.getByTestId('mqtt-publish-topic').fill(topic)
    await pasteMonaco(app, page, 'mqtt-composer', JSON.stringify(payload))
    await page.getByTestId('mqtt-publish').click()
    await page.waitForTimeout(300)
  }
  await expect(page.getByTestId('mqtt-log')).toContainText('ord_1043', { timeout: 10_000 })
  await shot(page, 'mqtt-message-log')
  await page.getByTestId('mqtt-connect').click()
})

// ── Mock servers ────────────────────────────────────────────────────────────

test('mock-server-new-menu', async ({ window: page }) => {
  await page.getByTestId('nav-mocks').click()
  await page.getByTestId('mock-new').click()
  await expect(page.getByTestId('mock-new-menu')).toBeVisible()
  await shot(page, 'mock-server-new-menu')
  await page.keyboard.press('Escape')
})

test('mock-server-http-editor', async ({ window: page }) => {
  await openMock(page, 'Acme Orders mock')
  await page.getByTestId('mock-tab-endpoints').click()
  await page
    .getByText('/orders', { exact: true })
    .first()
    .click()
    .catch(() => {})
  await shot(page, 'mock-server-http-editor')
})

test('mock-server-live-log', async ({ window: page, seed }) => {
  // Earlier frames also hit this mock; start from an empty log so the frame
  // shows exactly the six requests below, in a full run and a `-g` re-shoot.
  await ipc(page, 'mock.logs.clear', seed.mockServerId)
  // Traffic for the log: six requests through the app's own HTTP engine.
  for (const name of [
    'List orders',
    'Get order',
    'Create order',
    'List customers',
    'Update stock',
    'Health check',
  ]) {
    await openRequest(page, name)
    await send(page, /20[01]/)
  }
  await closeTabs(page)
  await openMock(page, 'Acme Orders mock')
  await page.getByTestId('mock-tab-logs').click()
  const rows = page.getByTestId('mock-log-row')
  await expect(rows).toHaveCount(6, { timeout: 10_000 })
  await rows.filter({ hasText: 'POST' }).first().click()
  await shot(page, 'mock-server-live-log')
})

test('mock-server-sse-editor', async ({ window: page }) => {
  await openMock(page, 'Order events')
  await expect(page.getByTestId('mock-open-in-sse')).toBeVisible()
  await shot(page, 'mock-server-sse-editor')
})

test('mock-server-ai-editor', async ({ window: page }) => {
  await openMock(page, 'Support assistant LLM')
  await expect(page.getByTestId('mock-open-in-ai-chat')).toBeVisible()
  await shot(page, 'mock-server-ai-editor')
})

test('mock-server-mcp-tools', async ({ window: page }) => {
  await openMock(page, 'Acme Orders MCP')
  await expect(page.getByTestId('mock-mcp-editor')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('mock-mcp-tab-tools').click()
  await shot(page, 'mock-server-mcp-tools')
})

// ── Runner / history / import ───────────────────────────────────────────────

test('runner-results', async ({ window: page }) => {
  await page.getByTestId('nav-apis').click()
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+KeyK`)
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page.getByRole('option', { name: /Open collection runner/i }).click()
  const wb = page.getByTestId('workbench')
  await expect(wb.getByText('Run Sequence')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('runner-start').click()
  await expect(page.getByTestId('runner-results-title')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('runner-filter-passed')).toBeVisible()
  await shot(page, 'runner-results')
})

test('history-list', async ({ window: page }) => {
  for (const name of ['Get customer', 'List products', 'Update order']) {
    await openRequest(page, name)
    await send(page)
  }
  await page.getByTestId('nav-history').click()
  await expect(page.getByTestId('history-entry').first()).toBeVisible()
  await shot(page, 'history-list')
})

test('import-formats-dialog', async ({ window: page }) => {
  await page.getByTestId('nav-apis').click()
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+KeyO`)
  await expect(page.getByTestId('import-modal')).toBeVisible({ timeout: 8_000 })
  await shot(page, 'import-formats-dialog')
  await page.keyboard.press('Escape')
})
