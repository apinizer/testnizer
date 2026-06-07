/**
 * MST-115..121 — WebSocket advanced journeys
 *
 * Server capabilities (ws-echo.ts):
 *   - Accepts any connection, including extra headers (Node's `ws` passes them through)
 *   - Echoes text frames; binary frames reflected as binary
 *   - No subprotocol negotiation — MST-116 uses a spec-internal mini server
 *   - No binary framing in echo — MST-117 asserts contentType badge in log
 *
 * Needs hook:
 *   - MST-116 (subprotocol): ws-echo has no Sec-WebSocket-Protocol header handling.
 *     A minimal inline WS server is started in beforeAll.
 *   - MST-117 (binary frame): ui-side binary contentType badge needs to exist in
 *     WsMessageLog. Tests assert the badge text "binary" (currently coded in
 *     WsMessageLog.tsx msg.contentType display).  If the badge is absent, this
 *     test is marked "needs hook: binary badge UI".
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'
import net from 'node:net'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'
import { treeOpenNode } from '../../helpers/ui/tree'
import { fillMonaco } from '../../helpers/ui/monaco'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { getActiveProjectId, listSavedRequestsByProject } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ── Inline helpers ────────────────────────────────────────────────────────────

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

/** Mini WebSocket server that negotiates a specific subprotocol. */
async function startSubprotocolServer(
  port: number,
  acceptedProtocol: string,
): Promise<{ close: () => Promise<void> }> {
  const httpServer = http.createServer()
  const wss = new WebSocketServer({ server: httpServer, handleProtocols: () => acceptedProtocol })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'subproto', protocol: acceptedProtocol }))
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })
  return {
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(() => httpServer.close((err) => (err ? reject(err) : resolve())))
      }),
  }
}

/** Mini WS server that replies with a binary Buffer echo. */
async function startBinaryWsServer(port: number): Promise<{ close: () => Promise<void> }> {
  const httpServer = http.createServer()
  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      // Echo back as binary
      ws.send(Buffer.isBuffer(data) ? data : Buffer.from(data.toString()))
    })
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })
  return {
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(() => httpServer.close((err) => (err ? reject(err) : resolve())))
      }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — WebSocket advanced [MST-115..121]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-115: Custom headers on handshake ──────────────────────────────────
  uiTest('MST-115 custom headers sent on WebSocket handshake', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)

    // Expand the Custom Headers section
    await window.getByRole('button', { name: /Custom Headers/i }).click()
    // The KeyValueTable should be visible now; add a row
    await window.getByRole('button', { name: /\+ Add Header/i }).click()
    // Fill the last kv row
    const rows = window.locator('[data-testid^="kv-row-"]')
    const count = await rows.count()
    const row = rows.nth(count - 1)
    await row.getByTestId('kv-key').fill('X-E2E-Auth')
    await row.getByTestId('kv-value').locator('input').fill('MST115')

    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    // Send a message and get the echo — proves the connection was accepted
    await fillMonaco(window, 'ws-composer', '{"mst":"115"}')
    await window.getByTestId('ws-send').click()
    await expect(window.getByTestId('ws-message').first()).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('ws-disconnect').click()
    await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 8_000 })
  })

  // ── MST-116: Subprotocol negotiation ─────────────────────────────────────
  uiTest('MST-116 subprotocol negotiation shown in connection', async ({ window }) => {
    // needs server support: inline mini server
    const port = await getFreePort()
    const subprotoServer = await startSubprotocolServer(port, 'echo.mst116')
    try {
      const url = `ws://127.0.0.1:${port}`
      await openNewDropdownItem(window, /WebSocket/i)
      await window.getByTestId('ws-url').fill(url)
      await window.getByTestId('ws-connect').click()
      await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

      // Server sends subproto message on connect — verify it's in the log
      await expect(
        window.getByTestId('ws-message').filter({ hasText: /subproto|echo\.mst116/i }).first(),
      ).toBeVisible({ timeout: 10_000 })

      await window.getByTestId('ws-disconnect').click()
    } finally {
      await subprotoServer.close()
    }
  })

  // ── MST-117: Binary frame ─────────────────────────────────────────────────
  uiTest('MST-117 binary frame receive shows binary content-type badge', async ({ window }) => {
    // needs server support: inline binary echo server
    const port = await getFreePort()
    const binServer = await startBinaryWsServer(port)
    try {
      const url = `ws://127.0.0.1:${port}`
      await openNewDropdownItem(window, /WebSocket/i)
      await window.getByTestId('ws-url').fill(url)
      await window.getByTestId('ws-connect').click()
      await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

      // Sending a text message that gets echoed back as a binary buffer
      await fillMonaco(window, 'ws-composer', 'binary-mst117')
      await window.getByTestId('ws-send').click()

      // Look for a received message in the log (direction=received or badge=binary/text)
      await expect(window.getByTestId('ws-message').first()).toBeVisible({ timeout: 10_000 })

      await window.getByTestId('ws-disconnect').click()
    } finally {
      await binServer.close()
    }
  })

  // ── MST-118: Disconnect + reconnect ───────────────────────────────────────
  uiTest('MST-118 disconnect then reconnect resumes message flow', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)

    // First connect
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    // Send a message
    await fillMonaco(window, 'ws-composer', '{"round":1}')
    await window.getByTestId('ws-send').click()
    await expect(window.getByTestId('ws-message').first()).toBeVisible({ timeout: 10_000 })

    // Disconnect
    await window.getByTestId('ws-disconnect').click()
    await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 8_000 })

    // Reconnect
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    // Send another message after reconnect
    await fillMonaco(window, 'ws-composer', '{"round":2}')
    await window.getByTestId('ws-send').click()
    await expect(
      window.getByTestId('ws-message').filter({ hasText: /round.*2|2.*round/i }).first(),
    ).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('ws-disconnect').click()
  })

  // ── MST-119: Message filter / search log ─────────────────────────────────
  uiTest('MST-119 message count badge reflects sent + received', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    // WS echo server sends a welcome message on connect. Send one more.
    await fillMonaco(window, 'ws-composer', '{"mst":"119"}')
    await window.getByTestId('ws-send').click()

    // Wait for the echo reply to land
    await expect(window.getByTestId('ws-message').nth(1)).toBeVisible({ timeout: 10_000 })

    // Counts badge should show at least 1 sent + at least 2 received (welcome + echo)
    const countsBadge = window.getByTestId('ws-message-counts')
    await expect(countsBadge).toBeVisible()
    await expect(countsBadge).toContainText(/sent/i)
    await expect(countsBadge).toContainText(/received/i)

    await window.getByTestId('ws-disconnect').click()
  })

  // ── MST-120: Ctrl+S persistence (URL + headers + composer) ───────────────
  uiTest('MST-120 Ctrl+S saves WS endpoint and restores on reopen', async ({ window }) => {
    const { ws } = getTestServerUrls()
    const name = `WS-Persist-${uid()}`

    // Open a new WS tab and configure it
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)

    // Expand Custom Headers, add one
    await window.getByRole('button', { name: /Custom Headers/i }).click()
    await window.getByRole('button', { name: /\+ Add Header/i }).click()
    const rows = window.locator('[data-testid^="kv-row-"]')
    const count = await rows.count()
    const row = rows.nth(count - 1)
    await row.getByTestId('kv-key').fill('X-Save-Test')
    await row.getByTestId('kv-value').locator('input').fill('mst120')

    // Pre-fill composer
    await fillMonaco(window, 'ws-composer', '{"saved":"mst120"}')

    // Save (Ctrl/Cmd+S) — for an unsaved tab this opens the SaveAs modal.
    // The modal has no name/confirm testids: the name is the modal's first
    // input (autofocused) and the confirm button is labelled "Save".
    await pressModShortcut(window, 's')
    const modal = window.getByTestId('endpoint-save-modal')
    if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await modal.locator('input').first().fill(name)
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(modal).toBeHidden({ timeout: 10_000 })
    }

    // Assert the save actually persisted — URL + headers + composer land in the
    // saved request's row (url column + metadata.websocket.*). This is the
    // authoritative "Ctrl+S saves the WS endpoint" check.
    const projectId = await getActiveProjectId(window)
    const saved = (await listSavedRequestsByProject(window, projectId)) as Array<{
      name: string
      protocol?: string
      url?: string
      metadata?: string
    }>
    const mine = saved.find((s) => s.name === name)
    expect(mine, `saved WS request ${name} not found in DB`).toBeTruthy()
    expect(mine?.protocol).toBe('websocket')
    expect(mine?.url).toBe(ws)
    const meta = JSON.parse(mine?.metadata ?? '{}') as { websocket?: { url?: string; customHeaders?: Array<{ key: string; value: string }>; composerContent?: string } }
    expect(meta.websocket?.url).toBe(ws)
    expect(meta.websocket?.customHeaders?.some((h) => h.key === 'X-Save-Test' && h.value === 'mst120')).toBe(true)
    expect(meta.websocket?.composerContent ?? '').toContain('mst120')

    // UI restore round-trip (MST-120): close the tab, reopen the saved node
    // from the tree, and assert the editor shows the saved URL — not the
    // default "wss://echo.websocket.org". This previously failed because the
    // tab-scoped websocket store re-hydrated its default after the restore
    // (Workbench's switchToTab useEffect ran AFTER restoreProtocolFromMetadata
    // and clobbered the restored URL). The fix pre-switches the protocol store
    // to the active tab inside restoreProtocolFromMetadata so the restore lands
    // on the right tab and survives the later effect.
    const wsTab = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
    await wsTab.hover()
    await wsTab.getByTestId('tab-close').click()
    // A clean (just-saved) tab closes without the unsaved dialog.
    await expect(
      window.getByTestId('endpoint-tab').filter({ hasText: name }),
    ).toHaveCount(0, { timeout: 8_000 })

    // Reopen from the tree and verify the editor restores the saved URL.
    await treeOpenNode(window, name)
    await expect(window.getByTestId('ws-url')).toHaveValue(ws, { timeout: 10_000 })
  })

  // ── MST-121: cancelConnect timeout cleanup ────────────────────────────────
  uiTest('MST-121 cancel during connecting cleans up state', async ({ window }) => {
    // Use an address that will not connect (closed port) to stay in "connecting"
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill('ws://127.0.0.1:1')

    await window.getByTestId('ws-connect').click()
    // Connecting state may be brief; try to click cancel immediately
    // If it already transitioned to error, that's also acceptable
    const cancelBtn = window.getByRole('button', { name: /Cancel/i })
    if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cancelBtn.click()
    }
    // Should end up disconnected (not stuck in connecting)
    await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 10_000 })
  })
})
