/**
 * MST-142..145 — Socket.IO advanced journeys
 *
 * Server capabilities (socketio-server.ts):
 *   - Default namespace "/" and any named namespace via `io.of(/^\/.+$/).on('connection', ...)`
 *   - Connect-time push: the server emits `welcome` the instant a socket connects.
 *     MST-142 asserts this arrives — it stresses the engine's connect-time event
 *     buffer (events pushed before the renderer wires its callback are buffered and
 *     flushed, not dropped; see socketio.engine.ts pendingEvents/dispatchEvent).
 *   - auth.token validation: server does NOT validate auth tokens — connection always
 *     succeeds. MST-143 verifies the token field is accepted without error.
 *   - listen / stop listening (issue #283 Events tab): a new request shows only
 *     listened events (Postman); MST-142/143 turn on "Listen to all events",
 *     MST-144 listens to "echo" only and checks `welcome` stays hidden.
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
    // Issue #283: a new request listens to no event (Postman) — show them all.
    await window.getByTestId('socketio-listen-all-inline').click()

    await window.getByTestId('socketio-connect').click()
    // Emit button appears when connected
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Server pushes `welcome` the instant the socket connects, i.e. before the
    // renderer's `socketio:connect` IPC roundtrip wires the event callback. The
    // engine now buffers connect-time pushes and flushes them once the callback
    // is set (see socketio.engine.ts dispatchEvent/pendingEvents), so `welcome`
    // is reliably visible even under CPU load — the previous `conn.onEvent?.`
    // drop is fixed. Assert it on /chat too. 20s: see MST-143 note on
    // workers=4 timeline-render lag.
    await expect(window.getByText(/welcome/i).first()).toBeVisible({ timeout: 20_000 })

    // Also exercise the round-trip emit/echo path on the named namespace: the
    // server onAny echoes every event back, including under /chat.
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
    // Issue #283: a new request listens to no event (Postman) — show them all.
    await window.getByTestId('socketio-listen-all-inline').click()

    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Connection succeeded — server accepted (does not validate). Generous
    // timeout: under workers=4 CPU load the buffered welcome event's timeline
    // render can trail the connect roundtrip by >10s (one-off fails observed
    // in this family at 10s/15s while always passing isolated).
    await expect(window.getByText(/welcome|connected/i).first()).toBeVisible({ timeout: 20_000 })

    await window.getByTestId('socketio-connect').click()
  })

  // ── MST-144: Listen / stop listening (issue #283 Events tab) ────────────
  uiTest('MST-144 listen to an event then remove it from the list', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })

    // Listen to "echo" (the Events tab; the old subscribe box).
    await window.getByTestId('socketio-tab-events').click()
    await window.getByTestId('socketio-listener-input').fill('echo')
    await window.getByTestId('socketio-listener-add').click()
    const listener = window.getByTestId('socketio-listener')
    await expect(listener).toHaveCount(1)
    await expect(listener.getByTestId('socketio-listener-name')).toHaveValue('echo')

    // Emit an event the server echoes back as `echo`: it reaches the timeline.
    await window.getByTestId('socketio-tab-message').click()
    await window
      .getByPlaceholder(/event name/i)
      .first()
      .fill('mst144')
    await window.getByTestId('socketio-emit').click()
    await expect(
      window
        .getByTestId('socketio-event')
        .filter({ hasText: /mst144/ })
        .filter({ hasText: /echo/ }),
    ).toHaveCount(1, { timeout: 10_000 })
    // `welcome` was not listened to, so it never shows.
    await expect(window.getByTestId('socketio-event').filter({ hasText: /welcome/ })).toHaveCount(0)

    // Remove the listener: it leaves the list.
    await window.getByTestId('socketio-tab-events').click()
    await listener.getByTestId('socketio-listener-remove').click()
    await expect(listener).toHaveCount(0, { timeout: 5_000 })

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
