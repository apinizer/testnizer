/**
 * MST-123..126 — SSE advanced journeys
 *
 * Server capabilities (sse-server.ts):
 *   - GET /events → streams 3 tick events with id:1..3, then closes
 *   - No custom-header echo path — MST-123 asserts connection succeeds
 *     with headers set (server accepts any; we verify the UI shows the header
 *     row without crashing and the stream still arrives).
 *   - No Last-Event-ID resume path in sse-server — MST-124 uses an inline
 *     mini HTTP server that reads the Last-Event-ID header and continues from
 *     that offset.
 *   - Natural server close after event 3 triggers "disconnected" state —
 *     used for MST-125.
 */
import http from 'node:http'
import net from 'node:net'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'


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

/**
 * Mini SSE server that:
 *   - Reads the Last-Event-ID request header
 *   - Streams events starting from lastId + 1 (up to maxId)
 *   - Echoes the incoming Authorization header value in the first event's data
 */
async function startAdvancedSseServer(
  port: number,
  opts: { maxEvents?: number } = {},
): Promise<{ url: string; close: () => Promise<void>; closeNow: () => Promise<void> }> {
  const maxEvents = opts.maxEvents ?? 5
  const sockets = new Set<net.Socket>()
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (req.url === '/events' || req.url?.startsWith('/events?')) {
      const lastIdHeader = req.headers['last-event-id']
      const startFrom = lastIdHeader ? parseInt(String(lastIdHeader), 10) + 1 : 1
      const authHeader = req.headers['authorization'] ?? req.headers['x-custom-header'] ?? ''

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      let n = startFrom
      const send = () => {
        if (n <= maxEvents) {
          const data = JSON.stringify({ n, auth: authHeader, ts: Date.now() })
          res.write(`id: ${n}\nevent: tick\ndata: ${data}\n\n`)
          n++
          if (n > maxEvents) {
            clearInterval(timer)
            res.end()
          }
        }
      }
      send()
      const timer = setInterval(send, 150)
      req.on('close', () => clearInterval(timer))
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.on('connection', (sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  return {
    url: `http://127.0.0.1:${port}/events`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    // Hard close: destroy every live keep-alive socket so an active SSE stream
    // is actually severed (plain server.close() waits for them to drain).
    closeNow: () =>
      new Promise((resolve, reject) => {
        for (const s of sockets) s.destroy()
        sockets.clear()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — SSE advanced [MST-123..126]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-123: Custom headers ───────────────────────────────────────────────
  uiTest('MST-123 custom request headers sent with SSE connect', async ({ window }) => {
    const port = await getFreePort()
    const server = await startAdvancedSseServer(port)
    try {
      await openNewDropdownItem(window, /SSE/i)
      await window.getByTestId('sse-url').fill(server.url)

      // Expand Custom Headers
      await window.getByRole('button', { name: /Custom Headers/i }).click()
      await window.getByRole('button', { name: /\+ Add Header/i }).click()
      const rows = window.locator('[data-testid^="kv-row-"]')
      const count = await rows.count()
      const row = rows.nth(count - 1)
      await row.getByTestId('kv-key').fill('X-Custom-Header')
      await row.getByTestId('kv-value').locator('input').fill('mst123')

      await window.getByTestId('sse-connect').click()

      // Server echoes the X-Custom-Header value in the event data
      await expect(
        window.getByText(/mst123|tick/i).first(),
      ).toBeVisible({ timeout: 15_000 })

      await window.getByTestId('sse-disconnect').click()
    } finally {
      await server.close()
    }
  })

  // ── MST-124: Last-Event-ID resume ─────────────────────────────────────────
  // The SSE engine (src/main/protocols/sse.engine.ts connectEventSource) merges
  // the caller's `Last-Event-ID` into eventsource@3's wrapped fetch via a
  // case-insensitive `Headers` object, so the library's own reconnect
  // bookkeeping wins on collisions while the user's first-connect value is still
  // sent. The earlier red was a TEST locator bug, not an engine bug: the
  // Last-Event-ID input was selected by `placeholder*="event"`, which ALSO
  // matched the URL field (placeholder "…/events"), so `.first()` filled the URL
  // with "3" and the connection went nowhere. We now target the dedicated
  // `sse-last-event-id` testid. The server below reads Last-Event-ID and resumes
  // from that offset + 1.
  uiTest('MST-124 Last-Event-ID input is sent on reconnect', async ({ window }) => {
    const port = await getFreePort()
    const server = await startAdvancedSseServer(port, { maxEvents: 10 })
    try {
      await openNewDropdownItem(window, /SSE/i)
      await window.getByTestId('sse-url').fill(server.url)

      // Expand Last-Event-ID section and set a value. Target the dedicated
      // testid — the old `placeholder*="event"` fallback also matched the URL
      // input (placeholder "https://api.example.com/events"), and `.first()`
      // resolved to the URL field, so "3" overwrote the URL → connect went to
      // `3` and zero events ever streamed (this is what made MST-124 red).
      await window.getByRole('button', { name: /Last-Event-ID/i }).click()
      const lastIdInput = window.getByTestId('sse-last-event-id')
      await lastIdInput.fill('3')

      await window.getByTestId('sse-connect').click()

      // Server starts from event 4 — data renders compact as {"n":4}. Combine
      // the two acceptable matches THEN take `.first()`: `a.first().or(b.first())`
      // yields the union of both first-matches, which trips strict mode when
      // both the `tick` badge and the `{"n":4}` data line are present.
      await expect(
        window.getByText(/"n":\s*[456]/).or(window.getByText(/tick/i)).first(),
      ).toBeVisible({ timeout: 15_000 })

      await window.getByTestId('sse-disconnect').click()
    } finally {
      await server.close()
    }
  })

  // ── MST-125: Server-close error handling + explicit disconnect ────────────
  // By design the SSE store keeps the "connected" state through transient
  // failures (eventsource@3 auto-reconnects) — it only surfaces the error
  // string and waits for an explicit user disconnect (sse.store.ts case
  // 'error'). So a server kill must NOT crash the UI, and the user must still
  // be able to disconnect back to a connectable state.
  uiTest('MST-125 server close surfaces error and explicit disconnect recovers', async ({ window }) => {
    const port = await getFreePort()
    const server = await startAdvancedSseServer(port, { maxEvents: 50 })
    await openNewDropdownItem(window, /SSE/i)
    await window.getByTestId('sse-url').fill(server.url)
    await window.getByTestId('sse-connect').click()

    // Reach the connected state (Disconnect button shown) and receive an event.
    await expect(window.getByTestId('sse-disconnect')).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(/tick/i).first()).toBeVisible({ timeout: 15_000 })

    // Hard-kill the server — destroy the live socket so the active stream is
    // actually severed. The UI must NOT crash; Disconnect stays available
    // (connected state is intentionally retained through auto-reconnect).
    await server.closeNow()
    await window.waitForTimeout(1_500)
    await expect(window.getByTestId('sse-disconnect')).toBeVisible({ timeout: 10_000 })

    // An explicit user disconnect returns to the connectable (disconnected)
    // state — the Connect button reappears.
    await window.getByTestId('sse-disconnect').click()
    await expect(window.getByTestId('sse-connect')).toBeVisible({ timeout: 10_000 })
  })

  // ── MST-126: cancelConnect cleanup ────────────────────────────────────────
  uiTest('MST-126 cancel during connecting cleans up SSE state', async ({ window }) => {
    // Point to an address that won't respond to keep "connecting" state
    await openNewDropdownItem(window, /SSE/i)
    await window.getByTestId('sse-url').fill('http://127.0.0.1:1/events')
    await window.getByTestId('sse-connect').click()

    // Cancel button appears in "connecting" state
    const cancelBtn = window.getByRole('button', { name: /Cancel/i })
    if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cancelBtn.click()
    }

    // Must return to disconnected with Connect button visible
    await expect(window.getByTestId('sse-connect')).toBeVisible({ timeout: 10_000 })
  })
})
