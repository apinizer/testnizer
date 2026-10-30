/**
 * Issues #275 / #282 / #283 — WebSocket and Socket.IO Postman parity, end to
 * end against the local servers (`tests/e2e/servers/{socketio-server,ws-echo}.ts`):
 *
 *   Socket.IO
 *   - #275: the server kicks the client (`kick`) → the editor notices: Connect
 *     comes back, a "Disconnected" row names the reason, Emit is disabled;
 *   - handshake headers reach the server (welcome echoes `x-e2e`);
 *   - binary argument (hex) out and binary back, shown as a hexdump; an Ack
 *     emit gets its acknowledgement row; Postman listen semantics;
 *   - save → close → reopen keeps listeners, settings and saved messages;
 *   - client v2 (Settings): EIO=3 handshake, header, token in the query, ack;
 *     v3 uses the v4 client (EIO=4, token in the auth packet).
 *   WebSocket
 *   - a Binary · Hex message is sent as a real binary frame (the echo server
 *     decodes the bytes back to "Hi");
 *   - an unexpected server close reconnects when Settings allow it;
 *   - saved messages + log search / filter.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'
import { fillMonaco } from '../helpers/ui/monaco'
import { pressModShortcut } from '../helpers/ui/keyboard'
import { treeOpenNode } from '../helpers/ui/tree'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function openSocketIO(window: Page): Promise<void> {
  const { socketio } = getTestServerUrls()
  await openNewDropdownItem(window, /Socket\.IO/i)
  await window.getByTestId('socketio-url').fill(socketio)
}

async function connectSocketIO(window: Page): Promise<void> {
  await window.getByTestId('socketio-connect').click()
  await expect(window.getByTestId('socketio-emit')).toBeEnabled({ timeout: 15_000 })
}

async function emit(window: Page, event: string): Promise<void> {
  await window.getByTestId('socketio-event-name').fill(event)
  await window.getByTestId('socketio-emit').click()
}

const sioRow = (window: Page, text: RegExp) =>
  window.getByTestId('socketio-event').filter({ hasText: text })

uiTest.describe('Realtime parity — Socket.IO (#275, #283)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('#275 a server-initiated disconnect is noticed', async ({ window }) => {
    await openSocketIO(window)
    await connectSocketIO(window)
    await emit(window, 'kick')

    await expect(window.getByTestId('socketio-connect')).toHaveText(/Connect/, {
      timeout: 10_000,
    })
    await expect(window.getByTestId('socketio-emit')).toBeDisabled()
    await expect(
      sioRow(window, /Disconnected/).filter({ hasText: /io server disconnect/ }),
    ).toHaveCount(1)
  })

  uiTest('headers are sent; listened events only; binary + ack', async ({ window }) => {
    const marker = `hdr-${uid()}`
    await openSocketIO(window)
    await window.getByTestId('socketio-tab-headers').click()
    const rows = window.locator('[data-testid^="kv-row-"]')
    const row = rows.nth((await rows.count()) - 1)
    await row.getByTestId('kv-key').fill('X-E2E')
    await row.getByTestId('kv-value').locator('input').fill(marker)

    // Listen to welcome + bin-echo only (Postman semantics).
    await window.getByTestId('socketio-tab-events').click()
    for (const name of ['welcome', 'bin-echo']) {
      await window.getByTestId('socketio-listener-input').fill(name)
      await window.getByTestId('socketio-listener-add').click()
    }
    await window.getByTestId('socketio-tab-message').click()
    await connectSocketIO(window)
    await expect(sioRow(window, /welcome/).filter({ hasText: marker })).toHaveCount(1, {
      timeout: 15_000,
    })

    // Binary: one hex argument out, binary back as a hexdump.
    await window.getByTestId('socketio-payload').fill('01 02 ff')
    await window.getByTestId('socketio-arg-format').first().selectOption('hex')
    await emit(window, 'bin')
    const echo = sioRow(window, /bin-echo/)
    await expect(echo).toHaveCount(1, { timeout: 10_000 })
    await echo.click()
    await expect(window.getByTestId('socketio-view-body').first()).toContainText('01 02 ff')

    // Ack: the acknowledgement row arrives even though `echo` is not listened to.
    await window.getByTestId('socketio-arg-format').first().selectOption('json')
    await window.getByTestId('socketio-payload').fill('{"n":1}')
    await window.getByTestId('socketio-ack').check()
    await emit(window, 'ack-me')
    await expect(sioRow(window, /Ack · ack-me/)).toHaveCount(1, { timeout: 10_000 })
    await expect(sioRow(window, /echo.*ack-me/)).toHaveCount(0)

    await window.getByTestId('socketio-connect').click()
  })

  for (const [version, eio, tokenIn] of [
    ['2', 3, 'query'],
    ['3', 4, 'auth'],
  ] as const) {
    uiTest(
      `client v${version}: EIO=${eio}, header + token arrive, ack works`,
      async ({ window }) => {
        const marker = `hdr-v${version}-${uid()}`
        await openSocketIO(window)
        await window.getByTestId('socketio-bearer-token').fill(`tok-${uid()}`)
        await window.getByTestId('socketio-tab-headers').click()
        const rows = window.locator('[data-testid^="kv-row-"]')
        const row = rows.nth((await rows.count()) - 1)
        await row.getByTestId('kv-key').fill('X-E2E')
        await row.getByTestId('kv-value').locator('input').fill(marker)
        await window.getByTestId('socketio-tab-events').click()
        await window.getByTestId('socketio-listen-all').check()
        await window.getByTestId('socketio-tab-settings').click()
        await window.getByTestId('socketio-settings-version').selectOption(version)
        await expect(window.getByTestId('socketio-settings-version-hint')).toContainText(
          version === '2' ? 'query parameter' : 'same client',
        )
        await window.getByTestId('socketio-tab-message').click()
        await connectSocketIO(window)

        const welcome = sioRow(window, /welcome/).filter({ hasText: marker })
        await expect(welcome).toHaveCount(1, { timeout: 15_000 })
        await expect(welcome).toContainText(new RegExp(`"eio":\\s?${eio}`))
        await expect(welcome).toContainText(new RegExp(`"tokenIn":\\s?"${tokenIn}"`))

        await window.getByTestId('socketio-payload').fill('{"n":1}')
        await window.getByTestId('socketio-ack').check()
        await emit(window, 'ack-me')
        await expect(sioRow(window, /Ack · ack-me/)).toHaveCount(1, { timeout: 10_000 })

        await window.getByTestId('socketio-connect').click()
        await expect(window.getByTestId('socketio-connect')).toHaveText(/Connect/, {
          timeout: 10_000,
        })
      },
    )
  }

  uiTest('save → reopen keeps listeners, settings and saved messages', async ({ window }) => {
    const name = `SIO-Parity-${uid()}`
    await openSocketIO(window)
    await window.getByTestId('socketio-tab-events').click()
    await window.getByTestId('socketio-listener-input').fill('news')
    await window.getByTestId('socketio-listener-add').click()
    await window.getByTestId('socketio-tab-settings').click()
    await window.getByTestId('socketio-settings-retry-count').fill('3')
    await window.getByTestId('socketio-settings-retry-count').press('Enter')
    await window.getByTestId('socketio-tab-message').click()
    await window.getByTestId('socketio-event-name').fill('join')
    await window.getByTestId('socketio-save-message').click()
    await expect(window.getByTestId('socketio-saved-item')).toHaveCount(1)

    await pressModShortcut(window, 's')
    const modal = window.getByTestId('endpoint-save-modal')
    await expect(modal).toBeVisible({ timeout: 5_000 })
    await modal.locator('input').first().fill(name)
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modal).toBeHidden({ timeout: 10_000 })

    const tab = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
    await tab.hover()
    await tab.getByTestId('tab-close').click()
    await expect(window.getByTestId('endpoint-tab').filter({ hasText: name })).toHaveCount(0, {
      timeout: 8_000,
    })

    await treeOpenNode(window, name)
    await expect(window.getByTestId('socketio-saved-item')).toHaveCount(1, { timeout: 10_000 })
    await window.getByTestId('socketio-tab-events').click()
    await expect(window.getByTestId('socketio-listener-name')).toHaveValue('news')
    await window.getByTestId('socketio-tab-settings').click()
    await expect(window.getByTestId('socketio-settings-retry-count')).toHaveValue('3')
  })
})

uiTest.describe('Realtime parity — WebSocket (#282)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  async function openWs(window: Page): Promise<void> {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
  }

  uiTest('a Binary · Hex message goes out as a binary frame', async ({ window }) => {
    await openWs(window)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
    await window.getByTestId('ws-format').selectOption('hex')
    await fillMonaco(window, 'ws-composer', '48 69')
    await window.getByTestId('ws-send').click()
    // The echo server decodes the frame's bytes as UTF-8: "Hi".
    await expect(window.getByTestId('ws-message').filter({ hasText: /"data":"Hi"/ })).toHaveCount(
      1,
      { timeout: 10_000 },
    )
    await expect(
      window
        .locator('[data-testid="ws-message"][data-direction="sent"]')
        .filter({ hasText: 'binary' }),
    ).toHaveCount(1)
    await window.getByTestId('ws-disconnect').click()
  })

  uiTest('an unexpected close reconnects when Settings allow it', async ({ window }) => {
    await openWs(window)
    await window.getByTestId('ws-tab-settings').click()
    await window.getByTestId('ws-settings-retry-count').fill('2')
    await window.getByTestId('ws-settings-retry-count').press('Enter')
    await window.getByTestId('ws-settings-retry-delay').fill('100')
    await window.getByTestId('ws-settings-retry-delay').press('Enter')
    await window.getByTestId('ws-tab-message').click()
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    await window.getByTestId('ws-format').selectOption('text')
    await fillMonaco(window, 'ws-composer', 'kick')
    await window.getByTestId('ws-send').click()
    await expect(window.getByTestId('ws-system').filter({ hasText: 'Reconnected' })).toHaveCount(
      1,
      {
        timeout: 10_000,
      },
    )
    await expect(window.getByTestId('ws-disconnect')).toBeVisible()
    await window.getByTestId('ws-disconnect').click()
  })

  uiTest('saved messages and log search / filter', async ({ window }) => {
    await openWs(window)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
    await fillMonaco(window, 'ws-composer', '{"note":"parity-282"}')
    await window.getByTestId('ws-save-message').click()
    await expect(window.getByTestId('ws-saved-item')).toHaveCount(1)
    await window.getByTestId('ws-send').click()
    await expect(window.getByTestId('ws-message').filter({ hasText: 'parity-282' })).toHaveCount(
      2,
      {
        timeout: 10_000,
      },
    )

    await window.getByTestId('ws-log-filter-sent').click()
    await expect(window.getByTestId('ws-message')).toHaveCount(1)
    await window.getByTestId('ws-log-filter-all').click()
    await window.getByTestId('ws-log-search').fill('welcome')
    await expect(window.getByTestId('ws-message')).toHaveCount(1)
    await window.getByTestId('ws-log-search-clear').click()

    // Load the saved message back after editing the composer.
    await fillMonaco(window, 'ws-composer', 'scratch')
    await window.getByTestId('ws-saved-load').click()
    await expect(window.getByTestId('ws-composer')).toContainText('parity-282')
    await window.getByTestId('ws-disconnect').click()
  })
})
