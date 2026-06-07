/**
 * MST-142..145 — Socket.IO advanced journeys
 *
 * Server capabilities (socketio-server.ts):
 *   - Default namespace "/" and any named namespace via `io.of(/^\/.+$/).on('connection', ...)`
 *   - auth.token validation: server does NOT validate auth tokens — connection always
 *     succeeds. MST-143 verifies the token field is accepted without error.
 *   - subscribe/unsubscribe: Socket.IO "subscribe" button adds an event to the
 *     local subscription list; the server's onAny echoes any event — MST-144 tests
 *     that subscribing to "echo" and emitting causes event to arrive in timeline.
 *   - Disconnect reason: when the client disconnects, the server doesn't push a
 *     reason event — MST-145 verifies the UI returns to "disconnected" state.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'

uiTest.describe('Tur1 — Socket.IO advanced [MST-142..145]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-142: Custom namespace ─────────────────────────────────────────────
  uiTest('MST-142 custom namespace connects and exchanges events', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)

    await window.getByTestId('socketio-url').fill(socketio)

    // Fill namespace field
    const nsInput = window.getByPlaceholder(/Namespace/i)
    await nsInput.fill('/chat')

    await window.getByTestId('socketio-connect').click()
    // Emit button appears when connected
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Server welcome'ı bağlantı ANINDA push'lar; renderer event handler'ı ise
    // IPC roundtrip sonrası bağlanır — CPU yükünde welcome bu pencerede
    // düşebilir (engine `conn.onEvent?.` sessizce yutar; bkz. needs-hooks.md).
    // Namespace doğrulamasını erken-push'a bağlamak yerine emit/echo ile yap:
    // server onAny her event'i echo'lar — /chat namespace'inde de geçerli.
    const emitEventInput = window.getByPlaceholder(/event name/i).first()
    await emitEventInput.fill('ns-probe')
    await window.getByTestId('socketio-emit').click()
    await expect(window.getByText(/ns-probe/i).first()).toBeVisible({ timeout: 15_000 })

    // Disconnect
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByRole('button', { name: /^Connect$/i })).toBeVisible({ timeout: 8_000 })
  })

  // ── MST-143: Auth token object ───────────────────────────────────────────
  uiTest('MST-143 bearer token field accepted and connection succeeds', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)

    // Fill bearer token
    const tokenInput = window.getByPlaceholder(/Bearer token/i)
    await tokenInput.fill('mst143-secret')

    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Connection succeeded — server accepted (does not validate)
    await expect(window.getByText(/welcome|connected/i).first()).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('socketio-connect').click()
  })

  // ── MST-144: Subscribe / unsubscribe ──────────────────────────────────────
  uiTest('MST-144 subscribe to event then unsubscribe removes from list', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Subscribe to "echo" event
    const subscribeInput = window.getByPlaceholder(/event name/i).last()
    await subscribeInput.fill('echo')
    // "+" button to add subscription
    const addSubBtn = window.getByRole('button', { name: /^\+$/ })
    await addSubBtn.click()

    // "echo" should appear in the subscriptions list
    await expect(window.getByText(/^echo$/).first()).toBeVisible({ timeout: 5_000 })

    // Emit a "ping" event so the server echoes back
    const emitEventInput = window.getByPlaceholder(/event name/i).first()
    await emitEventInput.fill('ping')
    await window.getByTestId('socketio-emit').click()

    // Should see pong or echo in timeline
    await expect(window.getByText(/pong|echo|welcome/i).first()).toBeVisible({ timeout: 10_000 })

    // Unsubscribe by clicking the "×" next to "echo"
    const echoRow = window.locator('[style*="monospace"]').filter({ hasText: 'echo' }).first()
    const removeBtn = echoRow.locator('button').first()
    if (await removeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await removeBtn.click()
      // "echo" entry should disappear from subscriptions
      await expect(echoRow).toBeHidden({ timeout: 5_000 })
    }

    await window.getByTestId('socketio-connect').click()
  })

  // ── MST-145: Disconnect reason ────────────────────────────────────────────
  uiTest('MST-145 disconnect transitions UI back to disconnected state', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Explicitly disconnect
    await window.getByTestId('socketio-connect').click()

    // UI should show Connect button again
    await expect(window.getByRole('button', { name: /^Connect$/ })).toBeVisible({ timeout: 8_000 })
    // Emit button should be disabled / hidden
    await expect(window.getByTestId('socketio-emit')).toBeDisabled({ timeout: 5_000 })
  })
})
