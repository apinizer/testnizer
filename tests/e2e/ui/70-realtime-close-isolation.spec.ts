/**
 * Tester finding 13 (critical): a WebSocket tab took another tab's messages.
 *
 * Steps the tester took (`npx wscat --listen 8080`): tab A connects, A's
 * server goes away (A: Disconnected 1005), tab B connects to another server
 * and sends a message, back to A — B's rows were in A's log. A's listener
 * filtered on the id in A's slice, which the close had cleared, and was never
 * removed. Fixed by pinning each listener to its connection id
 * (`src/renderer/lib/pinned-events.ts`); unit test
 * `tests/renderer/realtime-close-isolation.test.ts`.
 *
 * Two local `ws` servers, no external network: A only accepts and then hangs
 * up (no close code → the client sees 1005, like wscat's Ctrl+C), B echoes.
 */
import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { fillMonaco } from '../helpers/ui/monaco'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const SCREENS = 'test-results/screens'

interface LocalWs {
  url: string
  /** The server goes away: open clients get a close frame without a code (1005). */
  hangUp: () => Promise<void>
  close: () => Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function startWs(echo: boolean): Promise<LocalWs> {
  const port = await freePort()
  const httpServer = http.createServer()
  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (socket) => {
    if (echo) socket.on('message', (data) => socket.send(data.toString()))
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })
  let stopped = false
  const stop = (graceful: boolean): Promise<void> =>
    new Promise((resolve) => {
      if (stopped) return resolve()
      stopped = true
      // `wss.close()` does not hang up connected clients: do it here, or the
      // worker keeps a live handle (see tur1/ws-advanced.spec.ts).
      for (const client of wss.clients) {
        try {
          if (graceful) client.close()
          else client.terminate()
        } catch {
          /* already gone */
        }
      }
      wss.close(() => {
        httpServer.closeAllConnections?.()
        httpServer.close(() => resolve())
      })
    })
  return {
    url: `ws://127.0.0.1:${port}`,
    hangUp: () => stop(true),
    close: () => stop(false),
  }
}

const tabs = (window: Page) => window.locator('[data-testid="endpoint-tab"]')
const systemRows = (window: Page) => window.getByTestId('ws-system')
const messageRows = (window: Page) => window.getByTestId('ws-message')

async function openWsTab(window: Page, url: string): Promise<number> {
  const before = await tabs(window).count()
  await openNewDropdownItem(window, /WebSocket/i)
  await expect(tabs(window)).toHaveCount(before + 1, { timeout: 10_000 })
  await window.getByTestId('ws-url').fill(url)
  return before
}

async function focusTab(window: Page, index: number): Promise<void> {
  await tabs(window).nth(index).click()
  await expect(tabs(window).nth(index)).toHaveAttribute('data-active', 'true')
}

uiTest.describe('Realtime close isolation (tester finding 13)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'a tab closed by its server keeps only its own rows when another tab talks',
    async ({ window }) => {
      const serverA = await startWs(false)
      const serverB = await startWs(true)
      const marker = `from-B-${uid()}`
      try {
        // A connects, then its server goes away.
        const tabA = await openWsTab(window, serverA.url)
        await window.getByTestId('ws-connect').click()
        await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
        // The row's title and preview are adjacent text ("Connectedws://…"):
        // match the first row's text, not a word-bounded regex over the row.
        await expect(window.getByTestId('ws-status')).toHaveAttribute('data-state', 'connected')
        await expect(systemRows(window)).toHaveCount(1)
        await expect(systemRows(window).first()).toContainText('Connected')

        await serverA.hangUp()
        await expect(window.getByTestId('ws-status')).toHaveAttribute(
          'data-state',
          'disconnected',
          { timeout: 10_000 },
        )
        await expect(systemRows(window).filter({ hasText: 'Disconnected' })).toContainText('1005')
        await window.screenshot({ path: `${SCREENS}/70-a-closed-by-server.png` })

        // B connects to another server and really exchanges a message.
        const tabB = await openWsTab(window, serverB.url)
        await window.getByTestId('ws-connect').click()
        await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
        await window.getByTestId('ws-format').selectOption('text')
        await fillMonaco(window, 'ws-composer', marker)
        await window.getByTestId('ws-send').click()
        await expect(messageRows(window).filter({ hasText: marker })).toHaveCount(2, {
          timeout: 10_000,
        })
        await window.screenshot({ path: `${SCREENS}/70-b-exchanged.png` })

        // Back to A: only A's own rows, still disconnected.
        await focusTab(window, tabA)
        await expect(window.getByTestId('ws-status')).toHaveAttribute('data-state', 'disconnected')
        await expect(window.getByTestId('ws-connect')).toBeVisible()
        await expect(messageRows(window)).toHaveCount(0)
        await expect(systemRows(window).filter({ hasText: marker })).toHaveCount(0)
        await expect(systemRows(window)).toHaveCount(2)
        await expect(systemRows(window).nth(0)).toContainText('Connected')
        await expect(systemRows(window).nth(1)).toContainText('Disconnected')
        await window.screenshot({ path: `${SCREENS}/70-a-after-b.png` })

        // B kept its own exchange.
        await focusTab(window, tabB)
        await expect(messageRows(window).filter({ hasText: marker })).toHaveCount(2)
        await window.getByTestId('ws-disconnect').click()
        await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 10_000 })

        // After B's disconnect, A is still untouched.
        await focusTab(window, tabA)
        await expect(systemRows(window)).toHaveCount(2)
        await expect(messageRows(window)).toHaveCount(0)
        await window.screenshot({ path: `${SCREENS}/70-a-final.png` })
      } finally {
        await serverA.close()
        await serverB.close()
      }
    },
  )
})
